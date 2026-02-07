import { NextRequest, NextResponse } from 'next/server';
import { getProviderEndpoint, trackUsage } from '@/lib/ai-gateway';

const PROVIDER_ENDPOINTS: Record<string, { url: string; authHeader: string }> = {
  anthropic: {
    url: getProviderEndpoint('anthropic'),
    authHeader: 'x-api-key',
  },
  openai: {
    url: getProviderEndpoint('openai'),
    authHeader: 'Authorization',
  },
  qwen: {
    url: getProviderEndpoint('qwen'),
    authHeader: 'Authorization',
  },
};

// System prompt for INVEST mode (DeFi yield strategies)
const INVEST_SYSTEM_PROMPT = `You are Makora, an autonomous DeFi agent managing a Solana portfolio.
Trades are executed as Jupiter swaps. You can BUY (SOL→token) and SELL (token→SOL).

VALID ACTIONS AND TOKENS:
- stake: SOL->mSOL (Marinade ~7% APY), SOL->JUPSOL (Jupiter staking), SOL->JitoSOL (Jito staking)
- lend: SOL->USDC (stable yield), SOL->mSOL (collateral), SOL->JUPSOL
- lp: SOL->JLP (Jupiter perps LP, ~20-40% APY)
- swap: SOL->USDC, SOL->WBTC, SOL->WETH, SOL->BONK, etc.
- sell: EXIT a position back to SOL (e.g. sell mSOL->SOL, sell USDC->SOL, sell JLP->SOL)
- hold: keep current allocation (use empty allocation array)

IMPORTANT — REBALANCING:
- Look at CURRENT POSITIONS. If you hold tokens that no longer fit your strategy, use "sell" to exit them.
- "sell" means swap that token BACK to SOL. The "token" field is the token you are SELLING.
- "percentOfPortfolio" for sells = what % of your POSITION in that token to sell (e.g. 100 = sell all, 50 = sell half)
- In bearish markets: SELL risky positions back to SOL or stables.
- You MUST actively rebalance — do not just hold losing positions.

Output ONLY valid JSON with this exact schema:
{
  "marketAssessment": {
    "sentiment": "bullish" | "neutral" | "bearish",
    "confidence": <0-100>,
    "reasoning": "<1-3 sentence market thesis>",
    "keyFactors": ["<factor>", ...]
  },
  "allocation": [
    {
      "protocol": "<Jupiter|Marinade|Raydium|Kamino>",
      "action": "<stake|lend|swap|hold|lp|sell>",
      "token": "<USDC|mSOL|JUPSOL|JitoSOL|JLP|WBTC|WETH|BONK>",
      "percentOfPortfolio": <0-100>,
      "rationale": "<why>"
    }
  ],
  "riskAssessment": { "overallRisk": <0-100>, "warnings": ["..."] },
  "riskParams": {
    "maxPositionPct": <5-40>,
    "maxSlippageBps": <10-500>,
    "dailyLossLimitPct": <1-15>,
    "stopLossPct": <2-20>
  },
  "explanation": "<2-4 sentence summary>"
}

RULES:
1. "token" must be ONE symbol (e.g. "USDC", "mSOL", "JLP") — NOT arrow notation
2. If target matches current positions within 3% drift, set action to "hold" with empty allocation
3. Never exceed max position size per slot (check RISK LIMITS section)
4. Keep minimum SOL reserve (at least 0.1 SOL) for gas fees
5. In bearish markets: favor mSOL (yield) + USDC (hedge), SELL risky positions first
6. In bullish markets: favor SOL exposure + mSOL/JUPSOL staking + JLP
7. Max 5 allocations, sum ≤ 100%
8. ALWAYS output riskParams tuned to market conditions`;

// System prompt for PERPS mode (perpetual futures trading)
const PERPS_SYSTEM_PROMPT = `You are Makora, an autonomous perpetual futures trader on Jupiter Perps (Solana).
You trade perpetual futures contracts with leverage. This is FAST TRADING mode with 20-second cycles.

AVAILABLE MARKETS:
- SOL-PERP: Solana perpetual futures
- ETH-PERP: Ethereum perpetual futures
- BTC-PERP: Bitcoin perpetual futures

VALID ACTIONS (ONLY THESE):
- "long": Open a LONG position (profit when price goes UP)
- "short": Open a SHORT position (profit when price goes DOWN)
- "close": Close an existing perpetual position

DO NOT USE: stake, lend, lp, swap, sell. These are INVEST mode actions, NOT allowed in PERPS mode.

Output ONLY valid JSON with this exact schema:
{
  "marketAssessment": {
    "sentiment": "bullish" | "neutral" | "bearish",
    "confidence": <0-100>,
    "reasoning": "<1-3 sentence market thesis>",
    "keyFactors": ["<factor>", ...]
  },
  "allocation": [
    {
      "protocol": "Jupiter Perps",
      "action": "<long|short|close>",
      "token": "<SOL-PERP|ETH-PERP|BTC-PERP>",
      "percentOfPortfolio": <5-30>,
      "leverage": <2-20>,
      "rationale": "<why this trade>"
    }
  ],
  "riskAssessment": { "overallRisk": <0-100>, "warnings": ["..."] },
  "riskParams": {
    "maxPositionPct": <5-30>,
    "maxSlippageBps": <50-200>,
    "dailyLossLimitPct": <2-10>,
    "stopLossPct": <3-15>
  },
  "explanation": "<2-4 sentence summary>"
}

LEVERAGE GUIDELINES:
- 2-5x: Conservative, for uncertain markets
- 5-10x: Moderate, for clear trends with medium confidence
- 10-20x: Aggressive, for high-conviction directional bets
- Never exceed 20x (liquidation risk too high)

PERPS TRADING RULES:
1. Bullish sentiment → go LONG, bearish → go SHORT
2. ALWAYS specify "leverage" (2-20x based on conviction)
3. percentOfPortfolio = collateral amount (5-30% max per position)
4. Max 3 positions at once
5. Higher confidence (>75%) → can use higher leverage (10-15x)
6. Lower confidence (<60%) → use conservative leverage (2-5x)
7. React FAST to Polymarket signals and price momentum
8. Volatile markets → reduce leverage and position size

EXAMPLE BEARISH OUTPUT WITH LEVERAGE:
{
  "marketAssessment": { "sentiment": "bearish", "confidence": 80, "reasoning": "SOL showing weakness, Polymarket strongly bearish", "keyFactors": ["price decline", "high bearish conviction"] },
  "allocation": [
    { "protocol": "Jupiter Perps", "action": "short", "token": "SOL-PERP", "percentOfPortfolio": 15, "leverage": 10, "rationale": "Short SOL 10x on strong bearish momentum" }
  ],
  "riskAssessment": { "overallRisk": 65, "warnings": ["High leverage position"] },
  "riskParams": { "maxPositionPct": 20, "maxSlippageBps": 100, "dailyLossLimitPct": 5, "stopLossPct": 8 },
  "explanation": "Opening 10x short on SOL-PERP with 15% collateral due to strong bearish signals."
}`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, model, temperature = 0.3, context, tradingMode, userId } = body;

    if (!provider || !model || !context) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: 'Missing API key' }, { status: 400 });
    }

    const endpoint = PROVIDER_ENDPOINTS[provider];
    if (!endpoint) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
    }

    // Select system prompt based on trading mode
    // Also detect from context if not explicitly passed
    const isPerpsMode = tradingMode === 'perps' || context.includes('TRADING MODE: PERPS');
    const SYSTEM_PROMPT = isPerpsMode ? PERPS_SYSTEM_PROMPT : INVEST_SYSTEM_PROMPT;

    const fetchUrl = endpoint.url;

    let fetchBody: string;
    let headers: Record<string, string>;

    if (provider === 'anthropic') {
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };
      fetchBody = JSON.stringify({
        model,
        max_tokens: 4096,
        temperature,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Analyze:\n\n${context}` }],
      });
    } else {
      // OpenAI / Qwen (OpenAI-compatible)
      headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };
      fetchBody = JSON.stringify({
        model,
        max_tokens: 4096,
        temperature,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Analyze:\n\n${context}` },
        ],
      });
    }

    const start = Date.now();
    const res = await fetch(fetchUrl, {
      method: 'POST',
      headers,
      body: fetchBody,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Provider error ${res.status}: ${errText.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    const latencyMs = Date.now() - start;

    // Extract content based on provider
    let content: string;
    let inputTokens = 0;
    let outputTokens = 0;

    if (provider === 'anthropic') {
      content = data.content?.map((b: { type: string; text?: string }) => b.type === 'text' ? b.text : '').join('') ?? '';
      inputTokens = data.usage?.input_tokens ?? 0;
      outputTokens = data.usage?.output_tokens ?? 0;
    } else {
      content = data.choices?.[0]?.message?.content ?? '';
      inputTokens = data.usage?.prompt_tokens ?? 0;
      outputTokens = data.usage?.completion_tokens ?? 0;
    }

    // Parse the LLM's JSON response
    let analysis;
    try {
      let jsonStr = content.trim();
      const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match) jsonStr = match[1].trim();
      analysis = JSON.parse(jsonStr);
    } catch {
      analysis = {
        marketAssessment: { sentiment: 'neutral', confidence: 30, reasoning: 'Failed to parse LLM response', keyFactors: ['parse_error'] },
        allocation: [],
        riskAssessment: { overallRisk: 70, warnings: ['Response parse failed'] },
        explanation: content.slice(0, 200),
      };
    }

    // Track usage per user if userId provided
    if (userId) {
      trackUsage(userId, inputTokens, outputTokens);
    }

    return NextResponse.json({
      analysis,
      model: data.model ?? model,
      inputTokens,
      outputTokens,
      latencyMs,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';

function normalizeUrl(raw: string | undefined): string {
  let u = (raw || 'http://localhost:18789').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

// System prompt for INVEST mode (DeFi yield strategies)
const INVEST_SYSTEM_PROMPT = `You are Makora, an autonomous DeFi agent managing a Solana portfolio.
All trades are executed as Jupiter swaps from SOL to the target token.

VALID ACTIONS AND TOKENS:
- stake: SOL->mSOL (Marinade ~7% APY), SOL->JUPSOL (Jupiter staking), SOL->JitoSOL (Jito staking)
- lend: SOL->USDC (stable yield), SOL->mSOL (collateral), SOL->JUPSOL
- lp: SOL->JLP (Jupiter perps LP, ~20-40% APY)
- swap: SOL->USDC, SOL->WBTC, SOL->WETH, SOL->BONK, etc.
- sell: EXIT a position back to SOL
- hold: keep current allocation (use empty allocation array)

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
2. Max 5 allocations, sum ≤ 100%
3. In bearish markets: favor mSOL (yield) + USDC (hedge)
4. In bullish markets: favor SOL exposure + mSOL/JUPSOL staking + JLP
5. ALWAYS output riskParams tuned to market conditions`;

// System prompt for PERPS mode (perpetual futures trading)
const PERPS_SYSTEM_PROMPT = `You are Makora, an autonomous perpetual futures trader on Jupiter Perps (Solana).
You trade perpetual futures contracts with leverage. This is FAST TRADING mode.

AVAILABLE MARKETS: SOL-PERP, ETH-PERP, BTC-PERP

VALID ACTIONS (ONLY THESE):
- "long": Open a LONG position (profit when price goes UP)
- "short": Open a SHORT position (profit when price goes DOWN)
- "close": Close an existing perpetual position

DO NOT USE: stake, lend, lp, swap. These are INVEST mode actions.

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

LEVERAGE RULES:
- 2-5x: Conservative (uncertain markets)
- 5-10x: Moderate (clear trends)
- 10-20x: Aggressive (high conviction)
- ALWAYS include "leverage" field

PERPS TRADING RULES:
1. Bullish → LONG, Bearish → SHORT
2. High confidence (>75%) → higher leverage (10-15x)
3. Low confidence (<60%) → lower leverage (2-5x)
4. Max 3 positions, 5-30% collateral each`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { context, gatewayUrl, token, sessionId } = body;

    if (!context) {
      return NextResponse.json({ error: 'Missing context' }, { status: 400 });
    }

    // Detect trading mode from context
    const isPerpsMode = context.includes('TRADING MODE: PERPS');
    const SYSTEM_PROMPT = isPerpsMode ? PERPS_SYSTEM_PROMPT : INVEST_SYSTEM_PROMPT;

    const url = `${normalizeUrl(gatewayUrl)}/v1/chat/completions`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-openclaw-agent-id': 'makora',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const start = Date.now();
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        messages: [
          { role: 'system', content: SYSTEM_PROMPT + '\n\nIMPORTANT: Output ONLY the JSON object, no markdown fences, no extra text.' },
          { role: 'user', content: `Analyze:\n\n${context}` },
        ],
        stream: false,
        user: sessionId || 'makora-anon',
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Gateway error ${res.status}: ${errText.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = await res.json();
    const latencyMs = Date.now() - start;

    const content = data.choices?.[0]?.message?.content ?? '';

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

    return NextResponse.json({
      analysis,
      model: data.model ?? 'local',
      latencyMs,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

import { NextRequest, NextResponse } from 'next/server';

const PROVIDER_ENDPOINTS: Record<string, { url: string; authHeader: string }> = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    authHeader: 'x-api-key',
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    authHeader: 'Authorization',
  },
  qwen: {
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    authHeader: 'Authorization',
  },
};

const SYSTEM_PROMPT = `You are Makora, an autonomous DeFi agent operating on Solana.
Analyze the market data and output ONLY valid JSON with this exact schema:
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
      "action": "<stake|lend|swap|hold|lp>",
      "token": "<SOL|USDC|mSOL|JitoSOL|JLP>",
      "percentOfPortfolio": <0-100>,
      "rationale": "<why>"
    }
  ],
  "riskAssessment": { "overallRisk": <0-100>, "warnings": ["..."] },
  "explanation": "<2-4 sentence summary>"
}
Rules: max 5 allocations, sum ≤ 100%. Use Polymarket as sentiment signals, not direct trades.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, model, temperature = 0.3, context } = body;

    if (!provider || !apiKey || !model || !context) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const endpoint = PROVIDER_ENDPOINTS[provider];
    if (!endpoint) {
      return NextResponse.json({ error: `Unknown provider: ${provider}` }, { status: 400 });
    }

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
    const res = await fetch(endpoint.url, {
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

import { NextRequest } from 'next/server';

const SYSTEM_PROMPT = `You are Makora, an autonomous DeFi agent on Solana. Analyze market data and output valid JSON with: marketAssessment (sentiment, confidence, reasoning, keyFactors), allocation (protocol, action, token, percentOfPortfolio, rationale — max 5, sum ≤100%), riskAssessment (overallRisk, warnings), explanation.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, model, temperature = 0.3, context } = body;

    if (!provider || !apiKey || !model || !context) {
      return new Response(JSON.stringify({ error: 'Missing fields' }), { status: 400 });
    }

    let url: string;
    let headers: Record<string, string>;
    let fetchBody: string;

    if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
      fetchBody = JSON.stringify({
        model, max_tokens: 4096, temperature, stream: true,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: `Analyze:\n\n${context}` }],
      });
    } else {
      url = provider === 'qwen'
        ? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
      fetchBody = JSON.stringify({
        model, max_tokens: 4096, temperature, stream: true,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Analyze:\n\n${context}` },
        ],
      });
    }

    const res = await fetch(url, { method: 'POST', headers, body: fetchBody });

    if (!res.ok || !res.body) {
      const errText = await res.text().catch(() => '');
      return new Response(JSON.stringify({ error: `${res.status}: ${errText.slice(0, 200)}` }), { status: 502 });
    }

    // Pass through the SSE stream
    return new Response(res.body, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown' }), { status: 500 });
  }
}

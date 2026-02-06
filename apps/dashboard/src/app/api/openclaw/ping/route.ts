import { NextRequest, NextResponse } from 'next/server';

function normalizeUrl(raw: string | undefined): string {
  let u = (raw || 'http://localhost:18789').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

// Quick check if cloud API key works
async function checkCloudKey(provider: string, apiKey: string): Promise<boolean> {
  try {
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } else if (provider === 'openai') {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } else if (provider === 'qwen') {
      const res = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'qwen-plus',
          max_tokens: 5,
          messages: [{ role: 'user', content: 'hi' }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    }
    return false;
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { gatewayUrl, token, llmKeys } = body;

    const start = Date.now();

    // Check if we have a real local gateway configured
    const hasLocalGateway = gatewayUrl &&
      gatewayUrl.length > 0 &&
      !gatewayUrl.includes('localhost:1234') &&
      !gatewayUrl.includes('localhost:18789');

    // ── Try local gateway first (if configured) ──────────────────────────────
    if (hasLocalGateway) {
      const base = normalizeUrl(gatewayUrl);
      const headers: Record<string, string> = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      for (const path of ['/health', '/v1/models']) {
        try {
          const res = await fetch(`${base}${path}`, {
            method: 'GET',
            headers,
            signal: AbortSignal.timeout(8000),
          });
          if (res.ok) {
            return NextResponse.json({ ok: true, provider: 'local', latencyMs: Date.now() - start });
          }
        } catch {
          // try next path
        }
      }
    }

    // ── Check cloud LLM keys (actually test them) ──
    if (llmKeys && typeof llmKeys === 'object') {
      const providerOrder = ['anthropic', 'openai', 'qwen'];

      for (const provider of providerOrder) {
        const key = llmKeys[provider];
        if (!key || key.length < 10) continue;

        const valid = await checkCloudKey(provider, key);
        if (valid) {
          return NextResponse.json({
            ok: true,
            provider,
            latencyMs: Date.now() - start,
          });
        }
      }

      // Keys exist but all failed validation
      const tried = providerOrder.filter(p => llmKeys[p]?.length > 0);
      if (tried.length > 0) {
        return NextResponse.json({
          ok: false,
          error: `API key(s) invalid for: ${tried.join(', ')}. Check your keys.`,
          latencyMs: Date.now() - start,
        });
      }
    }

    // ── Nothing worked ───────────────────────────────────────────────────────
    const latencyMs = Date.now() - start;
    return NextResponse.json({ ok: false, error: 'No LLM available (gateway unreachable, no cloud keys)', latencyMs });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

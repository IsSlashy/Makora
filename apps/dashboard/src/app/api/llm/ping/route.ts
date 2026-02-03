import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { provider, apiKey, model } = body;

    if (!provider || !apiKey || !model) {
      return NextResponse.json({ ok: false, error: 'Missing fields' }, { status: 400 });
    }

    let url: string;
    let headers: Record<string, string>;
    let fetchBody: string;

    if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers = { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
      fetchBody = JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'Reply "ok".' }] });
    } else {
      url = provider === 'qwen'
        ? 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
        : 'https://api.openai.com/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
      fetchBody = JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'Reply "ok".' }] });
    }

    const start = Date.now();
    const res = await fetch(url, { method: 'POST', headers, body: fetchBody });
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json({ ok: false, error: `${res.status}: ${errText.slice(0, 100)}`, latencyMs });
    }

    return NextResponse.json({ ok: true, model, latencyMs });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Unknown error' });
  }
}

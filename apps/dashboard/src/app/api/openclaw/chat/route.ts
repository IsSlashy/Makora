import { NextRequest, NextResponse } from 'next/server';

function normalizeUrl(raw: string | undefined): string {
  let u = (raw || 'http://localhost:18789').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

const MAKORA_SYSTEM_PROMPT = `You are MoltBot, an aggressive autonomous trading agent managing a Solana portfolio.
Built for the Solana Agent Hackathon. You run a continuous OODA loop (Observe → Orient → Decide → Act) to trade perpetual futures and DeFi protocols.

TRADING MODES:
- PERPS MODE (default): Ultra-fast perpetual futures trading on Jupiter Perps. Cycles every 3 SECONDS. You scalp SOL-PERP, ETH-PERP, BTC-PERP with leverage (2-5x). Open positions, take quick profits, cut losses fast.
- INVEST MODE: Slower DeFi yield (stake, lend, LP). Cycles every 5 minutes.

Your capabilities:
- Jupiter Perps: open/close LONG and SHORT positions with leverage (simulated for demo)
- Jupiter: swap any Solana tokens
- Portfolio tracking: read wallet balances and positions
- Real-time market observation: SOL, ETH, BTC prices and momentum every cycle

VAULT vs WALLET: You ONLY trade the Vault balance. When the user says "trade my vault", you trade 100% of the vault amount. NEVER touch the wallet balance.

TRADING BEHAVIOR:
- In PERPS mode, you are AGGRESSIVE. You open positions immediately when you see opportunity.
- You don't "wait and observe" — you ACT. Every 3 seconds is a new decision.
- Take profits quickly: if position is profitable > fees, CLOSE IT.
- Cut losses: if position goes against you, close and re-enter at better price.
- The user wants RESULTS, not explanations about what you "will do later".

When user asks to trade:
- Confirm the session is starting
- Say: "Trading NOW. Cycle time: 3s. Watch the Activity feed and Execution panel."
- Do NOT say "I'll wait for the next cycle" — you ARE executing continuously.

CRITICAL RULES:
- Be CONCISE and ACTION-ORIENTED. No long explanations.
- Reference real data from context (prices, positions, P&L).
- When you have open positions, mention them and their P&L.
- Never say "I cannot execute trades" — you DO execute via the OODA loop.
- Never fabricate data. Use only injected context.`;

// ─── Cloud LLM API URLs ──────────────────────────────────────────────────────

const CLOUD_ENDPOINTS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
};

const CLOUD_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o-mini',
  qwen: 'qwen-plus',
};

// ─── Cloud LLM Call ──────────────────────────────────────────────────────────

async function callCloudLLM(
  provider: string,
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
): Promise<{ content: string; model: string } | null> {
  const model = CLOUD_MODELS[provider];
  if (!model) return null;

  try {
    if (provider === 'anthropic') {
      // Anthropic has different API format
      const systemMsg = messages.find(m => m.role === 'system');
      const nonSystemMsgs = messages.filter(m => m.role !== 'system');

      const res = await fetch(CLOUD_ENDPOINTS.anthropic, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          system: systemMsg?.content || MAKORA_SYSTEM_PROMPT,
          messages: nonSystemMsgs.map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`[Cloud LLM] anthropic error ${res.status}: ${errText.slice(0, 200)}`);
        return null;
      }
      const data = await res.json();
      return { content: data.content?.[0]?.text ?? '', model };
    } else {
      // OpenAI-compatible (OpenAI, Qwen)
      const res = await fetch(CLOUD_ENDPOINTS[provider], {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          messages,
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        console.error(`[Cloud LLM] ${provider} error ${res.status}: ${errText.slice(0, 200)}`);
        return null;
      }
      const data = await res.json();
      return { content: data.choices?.[0]?.message?.content ?? '', model };
    }
  } catch (e) {
    console.error(`[Cloud LLM] ${provider} exception:`, e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, gatewayUrl, token, sessionId, llmKeys } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Missing messages' }, { status: 400 });
    }

    // Ensure Makora system prompt is always first
    const hasSystemPrompt = messages[0]?.role === 'system';
    const finalMessages = hasSystemPrompt
      ? [{ role: 'system', content: `${MAKORA_SYSTEM_PROMPT}\n\n${messages[0].content}` }, ...messages.slice(1)]
      : [{ role: 'system', content: MAKORA_SYSTEM_PROMPT }, ...messages];

    // Check if we have a real local gateway configured (not the default localhost:1234)
    const hasLocalGateway = gatewayUrl &&
      gatewayUrl.length > 0 &&
      !gatewayUrl.includes('localhost:1234') &&
      !gatewayUrl.includes('localhost:18789');

    // ── Try local gateway first (if configured) ──────────────────────────────
    if (hasLocalGateway) {
      try {
        const url = `${normalizeUrl(gatewayUrl)}/v1/chat/completions`;

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-openclaw-agent-id': 'makora',
        };
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);

        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            messages: finalMessages,
            stream: false,
            max_tokens: 2048,
            user: sessionId || 'makora-anon',
          }),
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (res.ok) {
          const data = await res.json();
          const content = data.choices?.[0]?.message?.content ?? '';
          return NextResponse.json({ content, model: data.model ?? 'local' });
        }
      } catch {
        // Local gateway failed, try cloud
      }
    }

    // ── Fallback: try cloud LLM keys ─────────────────────────────────────────
    if (llmKeys && typeof llmKeys === 'object') {
      const providerOrder = ['anthropic', 'openai', 'qwen'];

      for (const provider of providerOrder) {
        const key = llmKeys[provider];
        if (!key || key.length === 0) continue;

        const result = await callCloudLLM(provider, key, finalMessages);
        if (result) {
          return NextResponse.json({
            content: result.content,
            model: result.model,
            provider,
          });
        }
      }
    }

    // ── No LLM available ─────────────────────────────────────────────────────
    const triedProviders = llmKeys ? Object.keys(llmKeys).filter((k: string) => llmKeys[k]?.length > 0) : [];
    return NextResponse.json(
      { error: `No LLM available. Tried providers: [${triedProviders.join(', ') || 'none'}]. Check your API keys in Settings.` },
      { status: 502 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

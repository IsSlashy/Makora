/**
 * LLM integration with tool-use loop for the Telegram bot.
 * Supports Anthropic and OpenAI with automatic tool execution.
 */

import { Connection, LAMPORTS_PER_SOL, type Keypair } from '@solana/web3.js';
import { fetchTokenPrices, getMarketConditions } from './price-feed.js';
import { analyzeSentiment } from './sentiment.js';
import { fetchCryptoNews, formatNewsForLLMContext } from './social-feed.js';
import { formatSimulatedPositionsForLLM, setRealPrices } from './simulated-perps.js';
import { formatVaultForLLM, getVaultOnChainBalance } from './shielded-vault.js';
import { ANTHROPIC_TOOLS, OPENAI_TOOLS, executeTool, type ToolResult, type ToolExecutionContext } from './tools.js';
import type { SessionData } from './session.js';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface ChatMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

interface OpenAIToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface LLMResponse {
  content: string;
  toolResults: ToolResult[];
  model: string;
  provider: string;
}

// ─── Configuration ────────────────────────────────────────────────────────────

export interface LLMConfig {
  provider: 'anthropic' | 'openai' | 'qwen';
  apiKey: string;
  model?: string;
}

const CLOUD_ENDPOINTS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
};

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o-mini',
  qwen: 'qwen-plus',
};

// ─── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Makora, an autonomous DeFi trading agent on Solana with a ZK-shielded vault, accessible via Telegram.

CAPABILITIES:
- ZK Shielded Vault: users can shield/unshield SOL for private trading
- Open/close perpetual futures positions (SOL-PERP, ETH-PERP, BTC-PERP) with leverage
- Spot buy/invest in tokens via Jupiter swap (real on-chain execution)
- Check wallet + vault balance and open positions
- Real-time market data (prices, trends, sentiment)

CRITICAL — SPOT vs PERPS:
- "invest", "buy", "classic invest", "purchase", "DCA" → use swap_tokens (spot buy). This is a real on-chain swap.
- "long", "short", "leverage", "perp", "futures" → use open_position (leveraged perps). These are simulated.
- NEVER open a leveraged perp when the user asks to "invest" or "buy" — use swap_tokens instead.

ZK SHIELDED VAULT:
- Users must first shield SOL into their vault before trading.
- ALL trading (perps + swaps) uses the shielded vault balance, NEVER the main wallet.
- The main wallet is only used for shield/unshield operations.
- Always check vault balance before trading. If vault is empty, tell user to shield first.

RULES:
- Be CONCISE. Telegram messages should be short and actionable.
- Use Markdown formatting (bold, code, etc).
- ALWAYS use tools when the user asks for trades, positions, portfolio, or swaps.
- Reference real data from context (prices, balances, P&L). Never fabricate numbers.
- When asked to trade without specifying direction, default to SHORT in neutral markets.
- Take profits quickly: close positions when PnL > fees.
- When you have open positions, always mention their current P&L.

TRADING:
- Perps are simulated (demo) but use real market prices from Jupiter.
- Swaps are REAL on-chain transactions via Jupiter — use vault balance.
- Always confirm swap details before executing.
- Max leverage: 50x. Default: 5x. Default allocation: 25% of vault.`;

// ─── Context Builder ──────────────────────────────────────────────────────────

async function buildContext(
  connection: Connection,
  wallet: Keypair,
  session: SessionData,
): Promise<string> {
  const parts: string[] = [];

  // Wallet + vault balances (real on-chain)
  try {
    const lamports = await connection.getBalance(wallet.publicKey);
    const walletBal = lamports / LAMPORTS_PER_SOL;
    const vaultBal = await getVaultOnChainBalance(connection, wallet);
    const total = walletBal + vaultBal;
    parts.push(`WALLET: ${walletBal.toFixed(4)} SOL | ZK Vault: ${vaultBal.toFixed(4)} SOL | Total: ${total.toFixed(4)} SOL (${wallet.publicKey.toBase58().slice(0, 8)}...)`);
  } catch {
    parts.push('WALLET: Unable to fetch balance');
  }

  // Live prices
  try {
    const prices = await fetchTokenPrices(['SOL', 'WETH', 'WBTC']);
    parts.push(`PRICES: SOL=$${prices.SOL?.toFixed(2) ?? '?'}, ETH=$${prices.WETH?.toFixed(2) ?? '?'}, BTC=$${prices.WBTC?.toFixed(0) ?? '?'}`);

    // Update simulated position prices
    const priceUpdate: Record<string, number> = {};
    if (prices.SOL) priceUpdate.SOL = prices.SOL;
    if (prices.WETH) priceUpdate.ETH = prices.WETH;
    if (prices.WBTC) priceUpdate.BTC = prices.WBTC;
    setRealPrices(priceUpdate);
  } catch {
    parts.push('PRICES: Unable to fetch');
  }

  // Market conditions
  const conditions = getMarketConditions();
  if (conditions) {
    parts.push(`MARKET: ${conditions.overallDirection} | SOL trend: ${conditions.solTrend} (${conditions.sol30mChangePct > 0 ? '+' : ''}${conditions.sol30mChangePct}% 30m) | Volatility: ${conditions.volatility}`);
  }

  // Sentiment analysis
  const report = await analyzeSentiment().catch(() => null);
  if (report) {
    parts.push(`SENTIMENT: ${report.direction} (Score: ${report.overallScore}, Conf: ${report.confidence}%)`);
    for (const rec of report.recommendations) {
      parts.push(`  ${rec.token}: ${rec.action} (${rec.confidence}%) — ${rec.reasons[0] ?? ''}`);
    }
  }

  // News sentiment
  try {
    const newsFeed = await fetchCryptoNews();
    if (newsFeed.articles.length > 0) {
      parts.push(formatNewsForLLMContext(newsFeed));
    }
  } catch {
    // Skip news if unavailable
  }

  // ZK Vault status
  try {
    const prices = await fetchTokenPrices(['SOL']);
    const solPrice = prices.SOL || 77;
    parts.push(formatVaultForLLM(solPrice));
  } catch {
    parts.push('ZK VAULT: Unable to fetch status');
  }

  // Open positions
  const positionsCtx = formatSimulatedPositionsForLLM();
  parts.push(positionsCtx);

  // Trading mode
  parts.push(`MODE: ${session.tradingMode.toUpperCase()}`);

  // Active session
  if (session.activeSession) {
    const s = session.activeSession;
    parts.push(`SESSION: ${s.strategy} | Budget: ${s.budgetSol} SOL | Spent: ${s.spentSol.toFixed(4)} SOL | Trades: ${s.tradesExecuted}`);
  }

  return parts.join('\n');
}

// ─── Anthropic Call with Tools ──────────────────────────────────────────────

async function callAnthropicWithTools(
  config: LLMConfig,
  messages: ChatMessage[],
  toolCtx: ToolExecutionContext,
): Promise<LLMResponse | null> {
  const model = config.model || DEFAULT_MODELS.anthropic;

  try {
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystemMsgs = messages.filter((m) => m.role !== 'system');

    const formattedMsgs = nonSystemMsgs.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const res = await fetch(CLOUD_ENDPOINTS.anthropic, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: (systemMsg?.content as string) || SYSTEM_PROMPT,
        messages: formattedMsgs,
        tools: ANTHROPIC_TOOLS,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[LLM] Anthropic ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const toolResults: ToolResult[] = [];

    // Check if the model wants to use tools
    if (data.stop_reason === 'tool_use') {
      const contentBlocks: AnthropicContentBlock[] = data.content || [];
      const toolUseBlocks = contentBlocks.filter(
        (b: AnthropicContentBlock) => b.type === 'tool_use',
      );

      if (toolUseBlocks.length > 0) {
        const toolResultContents: AnthropicContentBlock[] = [];

        for (const toolBlock of toolUseBlocks) {
          const toolName = toolBlock.name || '';
          const toolInput = (toolBlock.input || {}) as Record<string, unknown>;

          const result = await executeTool(toolName, toolInput, toolCtx);

          toolResults.push({ tool: toolName, result });
          toolResultContents.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id || '',
            content: result,
          });
        }

        // Send tool results back to the model for a final text response
        const continuationMsgs = [
          ...formattedMsgs,
          { role: 'assistant' as const, content: contentBlocks },
          { role: 'user' as const, content: toolResultContents },
        ];

        const continueRes = await fetch(CLOUD_ENDPOINTS.anthropic, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 1024,
            system: (systemMsg?.content as string) || SYSTEM_PROMPT,
            messages: continuationMsgs,
            tools: ANTHROPIC_TOOLS,
          }),
        });

        if (!continueRes.ok) {
          // Fallback: construct response from tool results
          const summary = toolResults
            .map((tr) => `[${tr.tool}] ${tr.result}`)
            .join('\n');
          return { content: summary, toolResults, model, provider: 'anthropic' };
        }

        const continueData = await continueRes.json();
        const textBlocks = (continueData.content || []).filter(
          (b: AnthropicContentBlock) => b.type === 'text',
        );
        const finalText =
          textBlocks.map((b: AnthropicContentBlock) => b.text || '').join('') ||
          toolResults.map((tr) => `[${tr.tool}] ${tr.result}`).join('\n');

        return { content: finalText, toolResults, model, provider: 'anthropic' };
      }
    }

    // No tool use — extract text from content blocks
    const textContent = (data.content || [])
      .filter((b: AnthropicContentBlock) => b.type === 'text')
      .map((b: AnthropicContentBlock) => b.text || '')
      .join('');

    return { content: textContent, toolResults: [], model, provider: 'anthropic' };
  } catch (e) {
    console.error('[LLM] Anthropic exception:', e);
    return null;
  }
}

// ─── OpenAI Call with Tools ─────────────────────────────────────────────────

async function callOpenAIWithTools(
  config: LLMConfig,
  messages: ChatMessage[],
  toolCtx: ToolExecutionContext,
): Promise<LLMResponse | null> {
  const model = config.model || DEFAULT_MODELS[config.provider] || 'gpt-4o-mini';

  try {
    const formattedMsgs: OpenAIMessage[] = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const useTools = config.provider === 'openai'; // Qwen doesn't support tools well

    const requestBody: Record<string, unknown> = {
      model,
      max_tokens: 1024,
      messages: formattedMsgs,
    };

    if (useTools) {
      requestBody.tools = OPENAI_TOOLS;
    }

    const endpoint = CLOUD_ENDPOINTS[config.provider];
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[LLM] ${config.provider} ${res.status}: ${errText.slice(0, 200)}`);
      return null;
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) return null;

    const toolResults: ToolResult[] = [];

    // Check for tool calls (OpenAI format)
    if (choice.finish_reason === 'tool_calls' && choice.message?.tool_calls) {
      const toolCalls: OpenAIToolCall[] = choice.message.tool_calls;
      const toolMessages: OpenAIMessage[] = [];

      toolMessages.push({
        role: 'assistant',
        content: choice.message.content || null,
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        let toolInput: Record<string, unknown> = {};
        try {
          toolInput = JSON.parse(tc.function.arguments);
        } catch {
          toolInput = {};
        }

        const result = await executeTool(tc.function.name, toolInput, toolCtx);

        toolResults.push({ tool: tc.function.name, result });
        toolMessages.push({
          role: 'tool',
          content: result,
          tool_call_id: tc.id,
        });
      }

      // Send tool results back for final response
      const continuationMsgs: OpenAIMessage[] = [
        ...formattedMsgs,
        ...toolMessages,
      ];

      const continueRes = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          messages: continuationMsgs,
          tools: OPENAI_TOOLS,
        }),
      });

      if (!continueRes.ok) {
        const summary = toolResults
          .map((tr) => `[${tr.tool}] ${tr.result}`)
          .join('\n');
        return { content: summary, toolResults, model, provider: config.provider };
      }

      const continueData = await continueRes.json();
      const finalText =
        continueData.choices?.[0]?.message?.content ||
        toolResults.map((tr) => `[${tr.tool}] ${tr.result}`).join('\n');

      return { content: finalText, toolResults, model, provider: config.provider };
    }

    // No tool use — return text directly
    return {
      content: choice.message?.content ?? '',
      toolResults: [],
      model,
      provider: config.provider,
    };
  } catch (e) {
    console.error(`[LLM] ${config.provider} exception:`, e);
    return null;
  }
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Call LLM with tools for a Telegram message.
 * Builds context, formats chat history, executes tool loop.
 */
export async function callLLMWithTools(
  config: LLMConfig,
  userMessage: string,
  session: SessionData,
  connection: Connection,
  wallet: Keypair,
): Promise<LLMResponse | null> {
  // Build dynamic context
  const context = await buildContext(connection, wallet, session);

  // Get wallet balance for tool execution
  let walletSolBalance = 0;
  try {
    const lamports = await connection.getBalance(wallet.publicKey);
    walletSolBalance = lamports / LAMPORTS_PER_SOL;
  } catch {
    // will be 0
  }

  const toolCtx: ToolExecutionContext = {
    connection,
    wallet,
    walletSolBalance,
  };

  // Build messages: system + context, chat history, user message
  const messages: ChatMessage[] = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n--- LIVE CONTEXT ---\n${context}` },
    ...session.chatHistory.map((h) => ({
      role: h.role,
      content: h.content,
    })),
    { role: 'user', content: userMessage },
  ];

  // Call the appropriate provider
  if (config.provider === 'anthropic') {
    return callAnthropicWithTools(config, messages, toolCtx);
  }

  // OpenAI and Qwen use the same format
  return callOpenAIWithTools(config, messages, toolCtx);
}

export { SYSTEM_PROMPT };

import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js';
import {
  openSimulatedPosition,
  closeSimulatedPosition,
  getSimulatedPositions,
  clearAllSimulatedPositions,
  setRealPrices,
} from '@/lib/simulated-perps';
import { fetchTokenPrices } from '@/lib/price-feed';
import { getProviderEndpoint, trackUsage } from '@/lib/ai-gateway';
import { hasCredits, deductCredits, estimateCost } from '@/lib/credits';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface ToolResult {
  tool: string;
  result: string;
}

interface ClientAction {
  type: string;
  strategy?: string;
}

interface ChatResponse {
  content: string;
  model: string;
  provider?: string;
  actions?: ClientAction[];
  toolResults?: ToolResult[];
  error?: string;
}

// ─── URL Helpers ──────────────────────────────────────────────────────────────

function normalizeUrl(raw: string | undefined): string {
  let u = (raw || 'http://localhost:18789').trim().replace(/\/$/, '');
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u;
}

// ─── System Prompt ────────────────────────────────────────────────────────────

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
- Never fabricate data. Use only injected context.

You have access to trading tools. When the user asks you to trade, USE THE TOOLS to actually execute. Do not just describe what you would do — call the tools to open positions, close positions, or check your portfolio. Act decisively.

DIRECTION SELECTION:
When the user asks you to trade without specifying long/short:
1. FIRST call get_positions to check existing positions
2. THEN analyze the user's message context for any market bias clues
3. If no clear direction is given, DEFAULT TO SHORT in uncertain/neutral markets (capital preservation)
4. Only go LONG if you have clear bullish signal or user explicitly asks for it
5. NEVER just default to LONG — always consider both directions

PROFIT-TAKING:
- When the user says "close when profitable" or "take profit", that means close as soon as PnL > 0.1%
- The OODA loop handles continuous monitoring — you open the position, the loop closes it when profitable
- Tell the user the OODA loop will auto-manage the position`;

// ─── Cloud LLM API URLs ──────────────────────────────────────────────────────

// Cloud endpoints — OpenAI routes through AI Gateway when configured
const CLOUD_ENDPOINTS: Record<string, string> = {
  anthropic: getProviderEndpoint('anthropic'),
  openai: getProviderEndpoint('openai'),
  qwen: getProviderEndpoint('qwen'),
};

const CLOUD_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o-mini',
  qwen: 'qwen-plus',
};

// ─── Tool Definitions ─────────────────────────────────────────────────────────

const SUPPORTED_MARKETS = ['SOL-PERP', 'ETH-PERP', 'BTC-PERP'] as const;
type PerpMarket = (typeof SUPPORTED_MARKETS)[number];

// Map perp market to the token symbol used for price lookups
const MARKET_TO_SYMBOL: Record<PerpMarket, string> = {
  'SOL-PERP': 'SOL',
  'ETH-PERP': 'WETH',
  'BTC-PERP': 'WBTC',
};

// Anthropic tool definitions
const ANTHROPIC_TOOLS = [
  {
    name: 'open_position',
    description:
      'Opens a simulated perpetual futures position. Use this when the user wants to go long or short on SOL, ETH, or BTC.',
    input_schema: {
      type: 'object' as const,
      properties: {
        market: {
          type: 'string' as const,
          enum: ['SOL-PERP', 'ETH-PERP', 'BTC-PERP'],
          description: 'The perpetual futures market to trade.',
        },
        side: {
          type: 'string' as const,
          enum: ['long', 'short'],
          description: 'Whether to go long (buy) or short (sell).',
        },
        leverage: {
          type: 'number' as const,
          description: 'Leverage multiplier (1-50). Default 5.',
        },
        percent_of_vault: {
          type: 'number' as const,
          description:
            'Percentage of vault balance to use as collateral (1-100). Default 25.',
        },
      },
      required: ['market', 'side'],
    },
  },
  {
    name: 'close_position',
    description:
      'Closes an open simulated perpetual futures position in a specific market.',
    input_schema: {
      type: 'object' as const,
      properties: {
        market: {
          type: 'string' as const,
          enum: ['SOL-PERP', 'ETH-PERP', 'BTC-PERP'],
          description: 'The perpetual futures market to close.',
        },
      },
      required: ['market'],
    },
  },
  {
    name: 'close_all_positions',
    description: 'Closes ALL open simulated perpetual futures positions at once.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'get_positions',
    description:
      'Returns all currently open simulated perp positions with their P&L.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: 'get_portfolio',
    description:
      'Returns the wallet SOL balance, vault balance, and a summary of open positions.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [] as string[],
    },
  },
];

// OpenAI tool definitions (function calling format)
const OPENAI_TOOLS = ANTHROPIC_TOOLS.map((tool) => ({
  type: 'function' as const,
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.input_schema,
  },
}));

// ─── Tool Execution ───────────────────────────────────────────────────────────

async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  walletPublicKey: string | undefined,
  vaultBalance: number | undefined,
): Promise<string> {
  try {
    switch (toolName) {
      case 'open_position': {
        const market = toolInput.market as PerpMarket;
        const side = toolInput.side as 'long' | 'short';
        const leverage = Math.min(Math.max(Number(toolInput.leverage) || 5, 1), 50);
        const percentOfVault = Math.min(
          Math.max(Number(toolInput.percent_of_vault) || 25, 1),
          100,
        );

        if (!SUPPORTED_MARKETS.includes(market)) {
          return `Error: Invalid market "${market}". Supported: ${SUPPORTED_MARKETS.join(', ')}`;
        }

        // Fetch current price for the underlying asset
        const priceSymbol = MARKET_TO_SYMBOL[market];
        const prices = await fetchTokenPrices([priceSymbol, 'SOL']);
        const entryPrice = prices[priceSymbol] || 0;
        const solPrice = prices.SOL || 77;

        // Feed real prices to simulated positions
        const priceUpdate: Record<string, number> = {};
        if (prices.SOL) priceUpdate.SOL = prices.SOL;
        if (prices.WETH) priceUpdate.ETH = prices.WETH;
        if (prices.WBTC) priceUpdate.BTC = prices.WBTC;
        setRealPrices(priceUpdate);

        if (entryPrice <= 0) {
          return `Error: Could not fetch price for ${priceSymbol}. Try again.`;
        }

        // Calculate collateral from vault balance
        const effectiveVaultSol = vaultBalance ?? 0;
        const collateralUsd = (percentOfVault / 100) * effectiveVaultSol * solPrice;

        if (collateralUsd < 0.01) {
          return `Error: Vault balance too low. Vault: ${effectiveVaultSol.toFixed(4)} SOL ($${(effectiveVaultSol * solPrice).toFixed(2)}). Cannot open position with $${collateralUsd.toFixed(2)} collateral.`;
        }

        // Check for existing position in this market
        const existing = getSimulatedPositions().find((p) => p.market === market);
        if (existing) {
          return `Error: Already have an open ${existing.side.toUpperCase()} ${market} position ($${existing.collateralUsd.toFixed(2)} at ${existing.leverage}x). Close it first or pick a different market.`;
        }

        const position = openSimulatedPosition({
          market,
          side,
          collateralUsd,
          leverage,
          entryPrice,
        });

        const notionalUsd = collateralUsd * leverage;
        return `Opened ${side.toUpperCase()} ${market} position:
- Collateral: $${collateralUsd.toFixed(2)} (${percentOfVault}% of vault)
- Leverage: ${leverage}x
- Notional: $${notionalUsd.toFixed(2)}
- Entry price: $${entryPrice.toFixed(2)}
- Position ID: ${position.id}`;
      }

      case 'close_position': {
        const market = toolInput.market as PerpMarket;

        if (!SUPPORTED_MARKETS.includes(market)) {
          return `Error: Invalid market "${market}". Supported: ${SUPPORTED_MARKETS.join(', ')}`;
        }

        const closed = closeSimulatedPosition(market, 100);
        if (!closed) {
          return `No open position found in ${market}. Nothing to close.`;
        }

        const pnlSign = (closed.unrealizedPnlPct ?? 0) >= 0 ? '+' : '';
        return `Closed ${closed.side.toUpperCase()} ${market} position:
- Collateral was: $${closed.collateralUsd.toFixed(2)} at ${closed.leverage}x
- Entry price: $${closed.entryPrice.toFixed(2)}
- P&L: ${pnlSign}${(closed.unrealizedPnlPct ?? 0).toFixed(2)}% ($${pnlSign}${(closed.unrealizedPnl ?? 0).toFixed(2)})`;
      }

      case 'close_all_positions': {
        const positions = getSimulatedPositions();
        if (positions.length === 0) {
          return 'No open positions to close.';
        }

        const count = positions.length;
        const totalPnl = positions.reduce(
          (sum, p) => sum + (p.unrealizedPnl ?? 0),
          0,
        );
        clearAllSimulatedPositions();

        const pnlSign = totalPnl >= 0 ? '+' : '';
        return `Closed all ${count} position(s). Total realized P&L: ${pnlSign}$${totalPnl.toFixed(2)}`;
      }

      case 'get_positions': {
        const positions = getSimulatedPositions();
        if (positions.length === 0) {
          return 'No open perp positions.';
        }

        const lines = [`Open positions (${positions.length}):`];
        for (const p of positions) {
          const pnlSign = (p.unrealizedPnlPct ?? 0) >= 0 ? '+' : '';
          const hoursOpen = (
            (Date.now() - p.openedAt) /
            (1000 * 60 * 60)
          ).toFixed(1);
          lines.push(
            `- ${p.side.toUpperCase()} ${p.market} ${p.leverage}x: $${p.collateralUsd.toFixed(2)} collateral, Entry $${p.entryPrice.toFixed(2)}, Current $${(p.currentPrice ?? 0).toFixed(2)}, P&L ${pnlSign}${(p.unrealizedPnlPct ?? 0).toFixed(2)}% (${hoursOpen}h)`,
          );
        }
        return lines.join('\n');
      }

      case 'get_portfolio': {
        let solBalance = 0;
        if (walletPublicKey) {
          try {
            const rpcUrl =
              process.env.NEXT_PUBLIC_RPC_URL || clusterApiUrl('devnet');
            const connection = new Connection(rpcUrl, 'confirmed');
            const balance = await connection.getBalance(
              new PublicKey(walletPublicKey),
            );
            solBalance = balance / LAMPORTS_PER_SOL;
          } catch {
            // Could not fetch balance
          }
        }

        const prices = await fetchTokenPrices(['SOL']);
        const solPrice = prices.SOL || 77;
        const effectiveVaultSol = vaultBalance ?? 0;

        const positions = getSimulatedPositions();
        const totalCollateral = positions.reduce(
          (sum, p) => sum + p.collateralUsd,
          0,
        );
        const totalPnl = positions.reduce(
          (sum, p) => sum + (p.unrealizedPnl ?? 0),
          0,
        );

        const lines = [
          `Portfolio Summary:`,
          `- Wallet: ${solBalance.toFixed(4)} SOL ($${(solBalance * solPrice).toFixed(2)})`,
          `- Vault: ${effectiveVaultSol.toFixed(4)} SOL ($${(effectiveVaultSol * solPrice).toFixed(2)})`,
          `- SOL Price: $${solPrice.toFixed(2)}`,
          `- Open Perp Positions: ${positions.length}`,
        ];
        if (positions.length > 0) {
          lines.push(
            `- Total Collateral Deployed: $${totalCollateral.toFixed(2)}`,
          );
          const pnlSign = totalPnl >= 0 ? '+' : '';
          lines.push(
            `- Unrealized P&L: ${pnlSign}$${totalPnl.toFixed(2)}`,
          );
        }
        return lines.join('\n');
      }

      default:
        return `Unknown tool: ${toolName}`;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Tool execution error';
    return `Error executing ${toolName}: ${msg}`;
  }
}

// ─── Anthropic Cloud LLM Call (with tool use) ─────────────────────────────────

let lastCloudError = '';

async function callAnthropicWithTools(
  apiKey: string,
  messages: ChatMessage[],
  walletPublicKey: string | undefined,
  vaultBalance: number | undefined,
): Promise<ChatResponse | null> {
  const model = CLOUD_MODELS.anthropic;

  try {
    const systemMsg = messages.find((m) => m.role === 'system');
    const nonSystemMsgs = messages.filter((m) => m.role !== 'system');

    // Format messages for Anthropic API. Each message content must be string or array of content blocks.
    const formattedMsgs = nonSystemMsgs.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

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
        system: (systemMsg?.content as string) || MAKORA_SYSTEM_PROMPT,
        messages: formattedMsgs,
        tools: ANTHROPIC_TOOLS,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      lastCloudError = `anthropic ${res.status}: ${errText.slice(0, 150)}`;
      return null;
    }

    const data = await res.json();
    const toolResults: ToolResult[] = [];
    const clientActions: ClientAction[] = [];

    // Check if the model wants to use tools
    if (data.stop_reason === 'tool_use') {
      // Extract tool_use blocks from the response content
      const contentBlocks: AnthropicContentBlock[] = data.content || [];
      const toolUseBlocks = contentBlocks.filter(
        (b: AnthropicContentBlock) => b.type === 'tool_use',
      );

      if (toolUseBlocks.length > 0) {
        // Execute each tool (in practice usually 1, but handle multiple)
        const toolResultContents: AnthropicContentBlock[] = [];

        for (const toolBlock of toolUseBlocks) {
          const toolName = toolBlock.name || '';
          const toolInput = (toolBlock.input || {}) as Record<string, unknown>;

          const result = await executeTool(
            toolName,
            toolInput,
            walletPublicKey,
            vaultBalance,
          );

          toolResults.push({ tool: toolName, result });
          toolResultContents.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id || '',
            content: result,
          });

          // Determine client-side actions based on tool call
          if (toolName === 'open_position' || toolName === 'close_position' || toolName === 'close_all_positions') {
            clientActions.push({ type: 'refresh_positions' });
          }
        }

        // Send tool results back to the model for a final text response
        // Build continuation messages: original messages + assistant response + tool results
        const continuationMsgs = [
          ...formattedMsgs,
          { role: 'assistant' as const, content: contentBlocks },
          { role: 'user' as const, content: toolResultContents },
        ];

        const continueRes = await fetch(CLOUD_ENDPOINTS.anthropic, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model,
            max_tokens: 2048,
            system: (systemMsg?.content as string) || MAKORA_SYSTEM_PROMPT,
            messages: continuationMsgs,
            tools: ANTHROPIC_TOOLS,
          }),
        });

        if (!continueRes.ok) {
          // If continuation fails, construct response from tool results
          const summary = toolResults
            .map((tr) => `[${tr.tool}] ${tr.result}`)
            .join('\n');
          return {
            content: summary,
            model,
            provider: 'anthropic',
            toolResults,
            actions: clientActions.length > 0 ? clientActions : undefined,
          };
        }

        const continueData = await continueRes.json();
        const textBlocks = (continueData.content || []).filter(
          (b: AnthropicContentBlock) => b.type === 'text',
        );
        const finalText =
          textBlocks.map((b: AnthropicContentBlock) => b.text || '').join('') ||
          toolResults.map((tr) => `[${tr.tool}] ${tr.result}`).join('\n');

        return {
          content: finalText,
          model,
          provider: 'anthropic',
          toolResults,
          actions: clientActions.length > 0 ? clientActions : undefined,
        };
      }
    }

    // No tool use — extract text from content blocks
    const textContent = (data.content || [])
      .filter((b: AnthropicContentBlock) => b.type === 'text')
      .map((b: AnthropicContentBlock) => b.text || '')
      .join('');

    return {
      content: textContent,
      model,
      provider: 'anthropic',
    };
  } catch (e) {
    console.error('[Cloud LLM] anthropic exception:', e);
    return null;
  }
}

// ─── OpenAI Cloud LLM Call (with tool use) ────────────────────────────────────

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

async function callOpenAIWithTools(
  provider: string,
  apiKey: string,
  messages: ChatMessage[],
  walletPublicKey: string | undefined,
  vaultBalance: number | undefined,
): Promise<ChatResponse | null> {
  const model = CLOUD_MODELS[provider];
  if (!model) return null;

  const endpoint = CLOUD_ENDPOINTS[provider];
  const useTools = provider === 'openai'; // Only add tools for OpenAI, not Qwen

  try {
    const formattedMsgs: OpenAIMessage[] = messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));

    const requestBody: Record<string, unknown> = {
      model,
      max_tokens: 2048,
      messages: formattedMsgs,
    };

    if (useTools) {
      requestBody.tools = OPENAI_TOOLS;
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      lastCloudError = `${provider} ${res.status}: ${errText.slice(0, 150)}`;
      return null;
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) return null;

    const toolResults: ToolResult[] = [];
    const clientActions: ClientAction[] = [];

    // Check for tool calls (OpenAI format)
    if (choice.finish_reason === 'tool_calls' && choice.message?.tool_calls) {
      const toolCalls: OpenAIToolCall[] = choice.message.tool_calls;

      // Execute each tool
      const toolMessages: OpenAIMessage[] = [];

      // Add the assistant message with tool_calls
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

        const result = await executeTool(
          tc.function.name,
          toolInput,
          walletPublicKey,
          vaultBalance,
        );

        toolResults.push({ tool: tc.function.name, result });
        toolMessages.push({
          role: 'tool',
          content: result,
          tool_call_id: tc.id,
        });

        if (
          tc.function.name === 'open_position' ||
          tc.function.name === 'close_position' ||
          tc.function.name === 'close_all_positions'
        ) {
          clientActions.push({ type: 'refresh_positions' });
        }
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
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          messages: continuationMsgs,
          tools: OPENAI_TOOLS,
        }),
      });

      if (!continueRes.ok) {
        const summary = toolResults
          .map((tr) => `[${tr.tool}] ${tr.result}`)
          .join('\n');
        return {
          content: summary,
          model,
          provider,
          toolResults,
          actions: clientActions.length > 0 ? clientActions : undefined,
        };
      }

      const continueData = await continueRes.json();
      const finalText =
        continueData.choices?.[0]?.message?.content ||
        toolResults.map((tr) => `[${tr.tool}] ${tr.result}`).join('\n');

      return {
        content: finalText,
        model,
        provider,
        toolResults,
        actions: clientActions.length > 0 ? clientActions : undefined,
      };
    }

    // No tool use — return text directly
    return {
      content: choice.message?.content ?? '',
      model,
      provider,
    };
  } catch (e) {
    console.error(`[Cloud LLM] ${provider} exception:`, e);
    return null;
  }
}

// ─── Simple Cloud LLM Call (no tools — for local gateway and Qwen) ────────────

async function callCloudLLMSimple(
  provider: string,
  apiKey: string,
  messages: ChatMessage[],
): Promise<{ content: string; model: string } | null> {
  const model = CLOUD_MODELS[provider];
  if (!model) return null;

  try {
    if (provider === 'anthropic') {
      const systemMsg = messages.find((m) => m.role === 'system');
      const nonSystemMsgs = messages.filter((m) => m.role !== 'system');

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
          system:
            typeof systemMsg?.content === 'string'
              ? systemMsg.content
              : MAKORA_SYSTEM_PROMPT,
          messages: nonSystemMsgs.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        lastCloudError = `${provider} ${res.status}: ${errText.slice(0, 150)}`;
        return null;
      }
      const data = await res.json();
      return {
        content:
          (data.content || [])
            .filter((b: AnthropicContentBlock) => b.type === 'text')
            .map((b: AnthropicContentBlock) => b.text || '')
            .join('') || '',
        model,
      };
    } else {
      // OpenAI-compatible (Qwen)
      const res = await fetch(CLOUD_ENDPOINTS[provider], {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 2048,
          messages: messages.map((m) => ({
            role: m.role,
            content:
              typeof m.content === 'string'
                ? m.content
                : JSON.stringify(m.content),
          })),
        }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        lastCloudError = `${provider} ${res.status}: ${errText.slice(0, 150)}`;
        return null;
      }
      const data = await res.json();
      return {
        content: data.choices?.[0]?.message?.content ?? '',
        model,
      };
    }
  } catch (e) {
    console.error(`[Cloud LLM] ${provider} exception:`, e);
    return null;
  }
}

// ─── Route Handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      messages,
      gatewayUrl,
      token,
      sessionId,
      llmKeys,
      walletPublicKey,
      vaultBalance,
      userId,
    } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'Missing messages' }, { status: 400 });
    }

    // Credit check — if userId provided, verify sufficient credits
    if (userId && !hasCredits(userId, estimateCost())) {
      return NextResponse.json(
        { error: 'Insufficient credits. Deposit SOL to continue using Makora.' },
        { status: 402 },
      );
    }

    // Ensure Makora system prompt is always first
    const hasSystemPrompt = messages[0]?.role === 'system';
    const finalMessages: ChatMessage[] = hasSystemPrompt
      ? [
          {
            role: 'system',
            content: `${MAKORA_SYSTEM_PROMPT}\n\n${messages[0].content}`,
          },
          ...messages.slice(1),
        ]
      : [{ role: 'system', content: MAKORA_SYSTEM_PROMPT }, ...messages];

    // Check if we have a real local gateway configured
    const hasLocalGateway =
      gatewayUrl &&
      gatewayUrl.length > 0 &&
      !gatewayUrl.includes('localhost:1234') &&
      !gatewayUrl.includes('localhost:18789');

    // ── Try local gateway first (if configured) — no tools ──────────────────
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
            messages: finalMessages.map((m) => ({
              role: m.role,
              content:
                typeof m.content === 'string'
                  ? m.content
                  : JSON.stringify(m.content),
            })),
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
          return NextResponse.json({
            content,
            model: data.model ?? 'local',
          } satisfies ChatResponse);
        }
      } catch {
        // Local gateway failed, try cloud
      }
    }

    // ── Fallback: try cloud LLM keys with tool support ──────────────────────
    if (llmKeys && typeof llmKeys === 'object') {
      const providerOrder = ['anthropic', 'openai', 'qwen'];

      for (const provider of providerOrder) {
        const key = llmKeys[provider] as string | undefined;
        if (!key || key.length === 0) continue;

        // Anthropic: use tool-enabled call
        if (provider === 'anthropic') {
          const result = await callAnthropicWithTools(
            key,
            finalMessages,
            walletPublicKey,
            vaultBalance,
          );
          if (result) {
            if (userId) {
              trackUsage(userId, 0, 0);
              deductCredits(userId, 500, 300, 'Chat (Anthropic)');
            }
            return NextResponse.json(result);
          }
          continue;
        }

        // OpenAI: use tool-enabled call
        if (provider === 'openai') {
          const result = await callOpenAIWithTools(
            provider,
            key,
            finalMessages,
            walletPublicKey,
            vaultBalance,
          );
          if (result) {
            if (userId) {
              trackUsage(userId, 0, 0);
              deductCredits(userId, 500, 300, 'Chat (OpenAI)');
            }
            return NextResponse.json(result);
          }
          continue;
        }

        // Qwen: no tool support, use simple call
        const result = await callCloudLLMSimple(provider, key, finalMessages);
        if (result) {
          if (userId) {
            trackUsage(userId, 0, 0);
            deductCredits(userId, 500, 200, 'Chat (Qwen)');
          }
          return NextResponse.json({
            content: result.content,
            model: result.model,
            provider,
          } satisfies ChatResponse);
        }
      }
    }

    // ── No LLM available ────────────────────────────────────────────────────
    const triedProviders = llmKeys
      ? Object.keys(llmKeys).filter(
          (k: string) => (llmKeys[k] as string)?.length > 0,
        )
      : [];
    return NextResponse.json(
      {
        error:
          lastCloudError ||
          `No LLM available. Tried: [${triedProviders.join(', ') || 'none'}]. Check your API keys in Settings.`,
      },
      { status: 502 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

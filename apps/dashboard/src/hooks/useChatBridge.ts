'use client';

import { useCallback, useRef } from 'react';
import { useOpenClaw, type ChatMessage } from './useOpenClaw';
import type { SessionParams } from './useTradingSession';

// ─── Intent Detection (pattern-matching, deterministic) ──────────────────────

export type BridgeIntentType =
  | 'swap'
  | 'stake'
  | 'unstake'
  | 'close_position'
  | 'open_position'
  | 'mode_auto'
  | 'mode_advisory'
  | 'stop'
  | 'portfolio'
  | 'aggressive'
  | 'conservative'
  | 'start_session'
  | 'stop_session'
  | 'reset_session'
  | 'session_status'
  | 'unknown';

export interface BridgeIntent {
  type: BridgeIntentType;
  amount?: number;
  fromToken?: string;
  toToken?: string;
  symbol?: string; // Market symbol (e.g., "SOL", "ETH", "BTC")
  side?: 'long' | 'short'; // For open_position
  leverage?: number; // For open_position
  pct?: number; // Percentage of vault to use
  sessionParams?: Partial<SessionParams>;
  raw: string;
}

// ─── Mandate parsing helpers ─────────────────────────────────────────────────

function parseDuration(value: string, unit: string): number {
  const n = parseInt(value, 10);
  const u = unit.toLowerCase();
  if (u.startsWith('h')) return n * 60 * 60 * 1000;
  if (u.startsWith('d')) return n * 24 * 60 * 60 * 1000;
  if (u.startsWith('min') || u === 'm') return n * 60 * 1000;
  return n * 60 * 60 * 1000; // default to hours
}

function parseStrategy(input: string): 'conservative' | 'balanced' | 'aggressive' {
  const lower = input.toLowerCase();
  if (/\b(conservative|safe|careful|low.?risk)\b/.test(lower)) return 'conservative';
  if (/\b(aggressive|yolo|high.?risk|degen)\b/.test(lower)) return 'aggressive';
  return 'balanced';
}

function parseFocusTokens(input: string): string[] | undefined {
  const match = input.match(/focus\s+(?:on\s+)?([A-Za-z]+(?:\s*,\s*[A-Za-z]+)*)/i);
  if (!match) return undefined;
  return match[1].split(/\s*,\s*/).map(t => t.trim().toUpperCase()).filter(Boolean);
}

function parseProfitTarget(input: string): number | undefined {
  const match = input.match(/(?:target|objective|goal|aim)?\s*(?:of\s+)?(?:a\s+)?\+?(\d+)\s*%?\s*(?:profit|gain|return|target|objective)/i)
    || input.match(/(\d+)(?:\s*-\s*\d+)?%?\s*(?:profit|gain|return)/i)
    || input.match(/\+(\d+)\s*%/);
  if (!match) return undefined;
  return parseInt(match[1], 10);
}

function detectIntent(input: string): BridgeIntent {
  const lower = input.trim().toLowerCase();

  // ── Session commands (highest priority) ────────────────────────────────────

  // Force reset: "reset", "force reset", "clear session"
  if (/\b(reset|force\s+reset|clear\s+session|reset\s+session)\b/.test(lower)) {
    return { type: 'reset_session', raw: input };
  }

  // Stop session: "stop trading", "end session", "halt trading"
  if (/\b(stop\s+trading|end\s+session|halt\s+trading|stop\s+session)\b/.test(lower)) {
    return { type: 'stop_session', raw: input };
  }

  // Session status: "session status", "how's the session", "trading status"
  if (/\b(session\s+status|how.?s\s+(?:the\s+)?session|trading\s+status|session\s+report)\b/.test(lower)) {
    return { type: 'session_status', raw: input };
  }

  // Start session mandate — multiple patterns:
  // "trade 20% of my wallet for 1 hour conservative"
  // "use 30% and day trade for 24h"
  // "trade for 2 hours with 50%"
  // "start trading 10% aggressive for 30 minutes"
  const mandatePatterns = [
    // Pattern A: "trade 20% for 1 hour"
    /(?:trade|start\s+trading|begin|run)\s+(?:with\s+)?(\d+)\s*%?\s*(?:of\s+)?(?:my\s+)?(?:wallet|vault|balance|portfolio|it)?\s*(?:balance\s+)?(?:for\s+(?:the\s+)?(?:next\s+)?(\d+)\s*(hours?|h|days?|d|minutes?|min|m))?/,
    // Pattern B: "use 30% and trade/day trade for 24h" - also matches "use 100% of my vault balance and trade"
    /(?:use|allocate|put)\s+(\d+)\s*%?\s*(?:of\s+)?(?:my\s+)?(?:wallet|vault|balance|portfolio|it)?\s*(?:balance\s+)?(?:and\s+)?(?:to\s+)?(?:day\s+)?trad(?:e|ing)?.*?(?:for\s+(?:the\s+)?(?:next\s+)?(\d+)\s*(hours?|h|days?|d|minutes?|min|m))?/,
    // Pattern C: "trade for 2 hours with 50%"
    /(?:trade|start\s+trading|day\s+trade)\s+(?:for\s+(?:the\s+)?(?:next\s+)?(\d+)\s*(hours?|h|days?|d|minutes?|min|m))\s+(?:with|using)\s+(\d+)\s*%/,
    // Pattern D: "trade perps for 24 hours" with percentage anywhere
    /(?:trade|start\s+trading)\s+(?:perps?|futures?)\s+(?:for\s+)?(\d+)\s*(hours?|h|days?|d|minutes?|min|m).*?(\d+)\s*%/,
  ];

  for (let i = 0; i < mandatePatterns.length; i++) {
    const pattern = mandatePatterns[i];
    const m = lower.match(pattern);
    if (m) {
      let walletPct: number;
      let durationMs: number;

      if (i === 2) {
        // Pattern C has swapped groups: duration first, then percentage
        walletPct = parseInt(m[3], 10);
        durationMs = parseDuration(m[1], m[2]);
      } else if (i === 3) {
        // Pattern D: "trade perps for 24 hours ... 100%"
        walletPct = parseInt(m[3], 10);
        durationMs = parseDuration(m[1], m[2]);
      } else {
        walletPct = parseInt(m[1], 10);
        durationMs = m[2] ? parseDuration(m[2], m[3]) : 60 * 60 * 1000;
      }

      // Detect if user wants to use vault only (not total portfolio)
      const useVaultOnly = /\bvault\b/i.test(input);

      return {
        type: 'start_session' as const,
        sessionParams: {
          walletPct,
          durationMs,
          strategy: parseStrategy(input),
          targetProfitPct: parseProfitTarget(input),
          focusTokens: parseFocusTokens(input),
          useVaultOnly,
        },
        raw: input,
      };
    }
  }

  // ── Legacy intents ─────────────────────────────────────────────────────────

  // Aggression / style commands
  if (/\b(be aggressive|trade aggressively|go aggressive|yolo|mode degen|degen mode|mode perp|perp mode)\b/.test(lower)) {
    return { type: 'aggressive', raw: input };
  }
  if (/\b(be conservative|play safe|be careful|go safe|mode hedge|hedge mode|mode safe|safe mode)\b/.test(lower)) {
    return { type: 'conservative', raw: input };
  }

  // Mode switches — trading modes
  if (/\b(mode invest|invest mode|switch to invest|go invest)\b/.test(lower)) {
    return { type: 'conservative', raw: input };
  }

  // Mode switches
  if (/\b(switch to auto|auto mode|enable auto|go auto)\b/.test(lower)) {
    return { type: 'mode_auto', raw: input };
  }
  if (/\b(switch to advisory|advisory mode|disable auto|manual mode)\b/.test(lower)) {
    return { type: 'mode_advisory', raw: input };
  }

  // Start trading (short commands)
  if (/\b(start|go|run|trade|execute)\b/.test(lower) && lower.length < 20) {
    return { type: 'mode_auto', raw: input };
  }

  // Stop / halt (short commands only — not "stop trading" which is session stop)
  if (/\b(stop|halt|pause|freeze)\b/.test(lower) && lower.length < 20) {
    return { type: 'stop', raw: input };
  }

  // Portfolio query
  if (/\b(show portfolio|my portfolio|positions|holdings|balance|status|what do i have|how many|how much|my funds|my wallet|what.?s in my|do i have|my tokens|my sol|check balance|portfolio value)\b/.test(lower)) {
    return { type: 'portfolio', raw: input };
  }

  // Stake command: "stake 0.1 SOL" or "stake 5 SOL"
  const stakeMatch = lower.match(/stake\s+(\d+(?:\.\d+)?)\s+(\w+)/);
  if (stakeMatch) {
    return {
      type: 'stake',
      amount: parseFloat(stakeMatch[1]),
      fromToken: stakeMatch[2].toUpperCase(),
      raw: input,
    };
  }

  // Unstake command: "unstake 0.1 mSOL"
  const unstakeMatch = lower.match(/unstake\s+(\d+(?:\.\d+)?)\s+(\w+)/);
  if (unstakeMatch) {
    return {
      type: 'unstake',
      amount: parseFloat(unstakeMatch[1]),
      fromToken: unstakeMatch[2].toUpperCase(),
      raw: input,
    };
  }

  // Open position: "long SOL 5x", "short BTC x20", "open long ETH", "prend un short sur solana x20"
  // Supports EN and FR patterns with optional leverage
  {
    // Normalize common French/English token names
    const tokenMap: Record<string, string> = {
      solana: 'SOL', sol: 'SOL', ethereum: 'ETH', eth: 'ETH',
      bitcoin: 'BTC', btc: 'BTC',
    };

    // Pattern group 1: "long SOL 5x" / "short BTC x20" / "go long ETH" / "open short SOL"
    const enMatch = lower.match(
      /(?:open|go|take|prend(?:s|re)?)\s+(?:a\s+|une?\s+)?(?:position\s+)?(?:sur\s+)?(?:(long|short)\s+(?:(?:on|sur|de)\s+)?(\w+)|(\w+)\s+(long|short))(?:\s+(?:a\s+|at\s+|with\s+)?(?:(?:x|×|levier\s*(?:x|×)?)\s*(\d+)|(\d+)\s*x))?/
    );
    // Pattern group 2: direct "long SOL" / "short ETH" at start
    const directMatch = !enMatch && lower.match(
      /^(long|short)\s+(\w+)(?:\s+(?:(?:x|×)\s*(\d+)|(\d+)\s*x))?/
    );
    // Pattern group 3: "short agressif sur solana x20" (FR)
    const frMatch = !enMatch && !directMatch && lower.match(
      /(?:position|trade|met[s]?|ouvr[ei])\s+(?:une?\s+)?(?:position\s+)?(?:(?:sur|de|en)\s+)?(?:(\w+)\s+)?(long|short)(?:\s+(?:agressif|aggressif|aggressive))?(?:\s+(?:sur|on|de)\s+(\w+))?(?:\s+(?:a\s+|(?:x|×|levier\s*(?:x|×)?)\s*)(\d+)|\s+(\d+)\s*x)?/
    );

    const m = enMatch || directMatch || (frMatch || null);
    if (m) {
      let side: 'long' | 'short';
      let rawSymbol: string;
      let rawLeverage: string | undefined;

      if (enMatch) {
        side = (enMatch[1] || enMatch[4]) as 'long' | 'short';
        rawSymbol = enMatch[2] || enMatch[3];
        rawLeverage = enMatch[5] || enMatch[6];
      } else if (directMatch) {
        side = directMatch[1] as 'long' | 'short';
        rawSymbol = directMatch[2];
        rawLeverage = directMatch[3] || directMatch[4];
      } else {
        // frMatch
        side = (m[2]) as 'long' | 'short';
        rawSymbol = m[3] || m[1] || '';
        rawLeverage = m[4] || m[5];
      }

      const symbol = tokenMap[rawSymbol.toLowerCase()] || rawSymbol.toUpperCase();
      const validSymbols = ['SOL', 'ETH', 'BTC'];
      if (validSymbols.includes(symbol)) {
        const leverage = rawLeverage ? Math.min(Math.max(parseInt(rawLeverage, 10), 1), 50) : 5;
        // Check for percentage in the message
        const pctMatch = lower.match(/(\d+)\s*%/);
        const pct = pctMatch ? parseInt(pctMatch[1], 10) : 100; // Default 100% of vault

        return {
          type: 'open_position',
          symbol,
          side,
          leverage,
          pct,
          raw: input,
        };
      }
    }
  }

  // Close position: "close position", "close SOL", "close SOL-PERP", "exit long", "sell position", "close all"
  const closeMatch = lower.match(/(?:close|exit|liquidate|sell\s+out|cut)\s+(?:(?:the|my|this)\s+)?(?:(?:long|short|perp|perps)\s+)?(?:position\s+)?(?:in\s+|on\s+)?(\w+)?(?:\s*-?\s*perp)?/);
  if (closeMatch || /\b(close\s+(?:position|all|it)|exit\s+(?:position|trade|all)|sell\s+position|cut\s+(?:loss|losses)|take\s+profit)\b/.test(lower)) {
    const sym = closeMatch?.[1]?.toUpperCase();
    // Filter out generic words that aren't market symbols
    const validSymbols = ['SOL', 'ETH', 'BTC', 'ALL'];
    const symbol = sym && validSymbols.includes(sym) ? sym : undefined;
    return {
      type: 'close_position',
      symbol,
      raw: input,
    };
  }

  // Swap command: "swap 0.5 SOL to USDC"
  const swapMatch = lower.match(/swap\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(?:to|for|into)\s+(\w+)/);
  if (swapMatch) {
    return {
      type: 'swap',
      amount: parseFloat(swapMatch[1]),
      fromToken: swapMatch[2].toUpperCase(),
      toToken: swapMatch[3].toUpperCase(),
      raw: input,
    };
  }

  return { type: 'unknown', raw: input };
}

// ─── Badge labels for detected intents ───────────────────────────────────────

export function getIntentBadge(type: BridgeIntentType): string | null {
  switch (type) {
    case 'swap': return 'SWAP';
    case 'stake': return 'STAKE';
    case 'unstake': return 'UNSTAKE';
    case 'close_position': return 'CLOSE POSITION';
    case 'open_position': return 'OPEN POSITION';
    case 'mode_auto': return 'AUTO MODE';
    case 'mode_advisory': return 'ADVISORY';
    case 'stop': return 'HALT';
    case 'portfolio': return 'PORTFOLIO';
    case 'aggressive': return 'AGGRESSIVE';
    case 'conservative': return 'CONSERVATIVE';
    case 'start_session': return 'START SESSION';
    case 'stop_session': return 'STOP SESSION';
    case 'reset_session': return 'RESET';
    case 'session_status': return 'SESSION STATUS';
    default: return null;
  }
}

// ─── Chat Bridge Hook ────────────────────────────────────────────────────────

export interface ChatBridgeCallbacks {
  onSetMode?: (mode: 'auto' | 'advisory') => Promise<void>;
  onStopLoop?: () => void;
  onSwap?: (amount: number, from: string, to: string) => Promise<void>;
  onStake?: (amount: number, token: string) => Promise<void>;
  onUnstake?: (amount: number, token: string) => Promise<void>;
  onClosePosition?: (symbol?: string) => Promise<string>;
  onOpenPosition?: (symbol: string, side: 'long' | 'short', leverage: number, pct: number) => Promise<string>;
  onSetAggressive?: () => void;
  onSetConservative?: () => void;
  onGetPortfolio?: () => string | Promise<string>;
  onStartSession?: (params: SessionParams) => Promise<string>;
  onStopSession?: () => Promise<string>;
  onResetSession?: () => void;
  onSessionStatus?: () => string;
}

export function useChatBridge(config: {
  gatewayUrl: string;
  sessionId: string;
  token?: string;
  llmKeys?: Partial<Record<string, string>>; // Cloud API keys fallback
  callbacks: ChatBridgeCallbacks;
}) {
  const openclaw = useOpenClaw({
    gatewayUrl: config.gatewayUrl,
    sessionId: config.sessionId,
    token: config.token,
    llmKeys: config.llmKeys,
  });

  const callbacksRef = useRef(config.callbacks);
  callbacksRef.current = config.callbacks;

  const lastIntentRef = useRef<BridgeIntent | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    const intent = detectIntent(content);
    lastIntentRef.current = intent;

    const cb = callbacksRef.current;

    // Handle recognized intents directly
    switch (intent.type) {
      // ── Session commands ─────────────────────────────────────────────────
      case 'start_session': {
        let ctx = '';
        if (cb.onStartSession && intent.sessionParams) {
          try {
            const params: SessionParams = {
              walletPct: intent.sessionParams.walletPct ?? 20,
              durationMs: intent.sessionParams.durationMs ?? 3600000,
              strategy: intent.sessionParams.strategy ?? 'balanced',
              targetProfitPct: intent.sessionParams.targetProfitPct,
              focusTokens: intent.sessionParams.focusTokens,
            };
            ctx = await cb.onStartSession(params);
          } catch (e) {
            ctx = `Failed to start session: ${e instanceof Error ? e.message : 'unknown error'}`;
          }
        }
        openclaw.sendMessage(content, ctx || undefined);
        return;
      }

      case 'stop_session': {
        let ctx = '';
        if (cb.onStopSession) {
          try {
            ctx = await cb.onStopSession();
          } catch (e) {
            ctx = `Failed to stop session: ${e instanceof Error ? e.message : 'unknown error'}`;
          }
        }
        openclaw.sendMessage(content, ctx || undefined);
        return;
      }

      case 'reset_session': {
        if (cb.onResetSession) {
          cb.onResetSession();
        }
        openclaw.sendMessage(content, 'Session reset. All trading stopped and session data cleared. You can start a new session now.');
        return;
      }

      case 'session_status': {
        let ctx = '';
        if (cb.onSessionStatus) {
          ctx = `Current session state:\n${cb.onSessionStatus()}`;
        }
        openclaw.sendMessage(content, ctx || undefined);
        return;
      }

      // ── Legacy intents ───────────────────────────────────────────────────
      case 'mode_auto': {
        let ctx = '';
        if (cb.onSetMode) {
          try {
            await cb.onSetMode('auto');
            ctx = 'Mode switched to AUTO. The agent will now execute trades autonomously when confidence threshold is met.';
          } catch (e) {
            ctx = `Failed to switch mode: ${e instanceof Error ? e.message : 'unknown error'}`;
          }
        }
        openclaw.sendMessage(content, ctx || undefined);
        return;
      }

      case 'mode_advisory': {
        let ctx = '';
        if (cb.onSetMode) {
          try {
            await cb.onSetMode('advisory');
            ctx = 'Mode switched to ADVISORY. The agent will only recommend trades, not execute them.';
          } catch (e) {
            ctx = `Failed to switch mode: ${e instanceof Error ? e.message : 'unknown error'}`;
          }
        }
        openclaw.sendMessage(content, ctx || undefined);
        return;
      }

      case 'stop':
        cb.onStopLoop?.();
        openclaw.sendMessage(content, 'OODA loop halted. The agent has stopped all trading activity.');
        return;

      case 'aggressive': {
        cb.onSetAggressive?.();
        // Also switch to auto + start loop
        if (cb.onSetMode) {
          try { await cb.onSetMode('auto'); } catch { /* non-critical */ }
        }
        let aggrCtx = 'Strategy bias set to AGGRESSIVE. Auto mode enabled. The OODA loop will execute trades on the next cycle (PERPS: ~3s, INVEST: ~5min). Check the Activity feed for real execution results.';
        if (cb.onGetPortfolio) {
          try {
            const info = await Promise.resolve(cb.onGetPortfolio());
            if (info) aggrCtx += `\n\nCurrent portfolio:\n${info}`;
          } catch { /* non-critical */ }
        }
        openclaw.sendMessage(content, aggrCtx);
        return;
      }

      case 'conservative': {
        cb.onSetConservative?.();
        let consCtx = 'Strategy bias set to CONSERVATIVE. The OODA loop will use lower risk tolerance on the next cycle. Check the Activity feed for results.';
        if (cb.onGetPortfolio) {
          try {
            const info = await Promise.resolve(cb.onGetPortfolio());
            if (info) consCtx += `\n\nCurrent portfolio:\n${info}`;
          } catch { /* non-critical */ }
        }
        openclaw.sendMessage(content, consCtx);
        return;
      }

      case 'portfolio':
        if (cb.onGetPortfolio) {
          const info = await Promise.resolve(cb.onGetPortfolio());
          openclaw.sendMessage(content, `Current portfolio state:\n${info}`);
        } else {
          openclaw.sendMessage(content);
        }
        return;

      case 'stake': {
        let stakeCtx = '';
        if (cb.onStake && intent.amount) {
          try {
            await cb.onStake(intent.amount, intent.fromToken ?? 'SOL');
            stakeCtx = `Successfully executed: stake ${intent.amount} ${intent.fromToken ?? 'SOL'}. The transaction has been submitted. Check the Activity feed for confirmation.`;
          } catch (e) {
            stakeCtx = `Stake failed: ${e instanceof Error ? e.message : 'unknown error'}`;
          }
        } else {
          stakeCtx = 'Stake command detected but wallet not connected or amount missing.';
        }
        openclaw.sendMessage(content, stakeCtx);
        return;
      }

      case 'unstake': {
        let unstakeCtx = '';
        if (cb.onUnstake && intent.amount) {
          try {
            await cb.onUnstake(intent.amount, intent.fromToken ?? 'mSOL');
            unstakeCtx = `Successfully executed: unstake ${intent.amount} ${intent.fromToken ?? 'mSOL'}. The transaction has been submitted. Check the Activity feed for confirmation.`;
          } catch (e) {
            unstakeCtx = `Unstake failed: ${e instanceof Error ? e.message : 'unknown error'}`;
          }
        } else {
          unstakeCtx = 'Unstake command detected but wallet not connected or amount missing.';
        }
        openclaw.sendMessage(content, unstakeCtx);
        return;
      }

      case 'open_position': {
        let openCtx = '';
        if (cb.onOpenPosition && intent.symbol && intent.side) {
          try {
            openCtx = await cb.onOpenPosition(
              intent.symbol,
              intent.side,
              intent.leverage ?? 5,
              intent.pct ?? 100,
            );
          } catch (e) {
            openCtx = `Failed to open position: ${e instanceof Error ? e.message : 'unknown error'}`;
          }
        } else {
          openCtx = 'Open position command detected but wallet not connected or parameters missing.';
        }
        openclaw.sendMessage(content, openCtx);
        return;
      }

      case 'close_position': {
        let closeCtx = '';
        if (cb.onClosePosition) {
          try {
            closeCtx = await cb.onClosePosition(intent.symbol);
          } catch (e) {
            closeCtx = `Close position failed: ${e instanceof Error ? e.message : 'unknown error'}`;
          }
        } else {
          closeCtx = 'Close position command detected but wallet not connected.';
        }
        openclaw.sendMessage(content, closeCtx);
        return;
      }

      case 'swap': {
        let swapCtx = '';
        if (cb.onSwap && intent.amount && intent.fromToken && intent.toToken) {
          try {
            await cb.onSwap(intent.amount, intent.fromToken, intent.toToken);
            swapCtx = `Successfully executed: swap ${intent.amount} ${intent.fromToken} -> ${intent.toToken}. The transaction has been submitted via Jupiter. Check the Activity feed for confirmation.`;
          } catch (e) {
            swapCtx = `Swap failed: ${e instanceof Error ? e.message : 'unknown error'}`;
          }
        } else {
          swapCtx = 'Swap command detected but wallet not connected or parameters missing.';
        }
        openclaw.sendMessage(content, swapCtx);
        return;
      }

      default: {
        // Always include live portfolio for general messages so the LLM never hallucinates
        let portfolioCtx: string | undefined;
        if (cb.onGetPortfolio) {
          try {
            const info = await Promise.resolve(cb.onGetPortfolio());
            if (info) portfolioCtx = `Current portfolio:\n${info}`;
          } catch { /* non-critical */ }
        }
        openclaw.sendMessage(content, portfolioCtx);
      }
    }
  }, [openclaw]);

  return {
    messages: openclaw.messages,
    isStreaming: openclaw.isStreaming,
    isConnected: openclaw.isConnected,
    error: openclaw.error,
    sendMessage,
    clearChat: openclaw.clearChat,
    checkConnection: openclaw.checkConnection,
    injectContext: openclaw.injectContext,
    lastIntent: lastIntentRef.current,
    detectIntent,
    getIntentBadge,
  };
}

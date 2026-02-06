'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Header } from '@/components/Header';
import { OnboardingBanner } from '@/components/OnboardingBanner';
import { TheWheel } from '@/components/TheWheel';
import { PortfolioCard } from '@/components/PortfolioCard';
import { TradeGuardPanel } from '@/components/TradeGuardPanel';
import { ActivityFeed } from '@/components/ActivityFeed';
import { RiskControls } from '@/components/RiskControls';
import { SettingsPanel } from '@/components/SettingsPanel';
import { LLMReasoningPanel } from '@/components/LLMReasoningPanel';
import { PolymarketPanel } from '@/components/PolymarketPanel';
import { ChatPanel } from '@/components/ChatPanel';
import { ExecutionPanel } from '@/components/ExecutionPanel';
import { SelfEvaluationPanel } from '@/components/SelfEvaluationPanel';
import { PositionsPanel } from '@/components/PositionsPanel';
import { PerformanceHistoryPanel } from '@/components/PerformanceHistoryPanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useOODALoop } from '@/hooks/useOODALoop';
import type { PastDecision } from '@/hooks/useSelfEvaluation';
import { useYieldData } from '@/hooks/useYieldData';
import { useLLMConfig } from '@/hooks/useLLMConfig';
import { usePolymarket } from '@/hooks/usePolymarket';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useChatBridge } from '@/hooks/useChatBridge';
import { useTradeGuard } from '@/hooks/useTradeGuard';
import { useTradingSession, type SessionParams } from '@/hooks/useTradingSession';
import { useVault } from '@/hooks/useVault';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

// ─── Time formatting helper ──────────────────────────────────────────────────

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return '00:00';
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function Home() {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const ooda = useOODALoop();
  const vault = useVault(); // Direct vault access for chat fallback

  // Cache wallet balance so session start can read it synchronously
  const cachedBalanceRef = useRef(0);
  useEffect(() => {
    if (!publicKey) { cachedBalanceRef.current = 0; return; }
    connection.getBalance(publicKey).then(bal => {
      cachedBalanceRef.current = bal / LAMPORTS_PER_SOL;
    }).catch(() => {});
  }, [publicKey, connection]);

  // Track perp positions P&L (fetched from server)
  const [perpPnlSol, setPerpPnlSol] = useState(0);
  useEffect(() => {
    if (!publicKey) { setPerpPnlSol(0); return; }

    const fetchPerpPnl = async () => {
      try {
        const res = await fetch(`/api/agent/positions?wallet=${publicKey.toBase58()}`);
        if (!res.ok) return;
        const data = await res.json();
        // Convert USD P&L to SOL (rough estimate using current SOL price)
        const solPrice = ooda.lastObservation?.solPrice || 180;
        const pnlUsd = data.perpSummary?.totalUnrealizedPnl || 0;
        setPerpPnlSol(pnlUsd / solPrice);
      } catch { /* ignore */ }
    };

    fetchPerpPnl();
    const interval = setInterval(fetchPerpPnl, 5000); // Fetch every 5s to reduce API load
    return () => clearInterval(interval);
  }, [publicKey, ooda.lastObservation?.solPrice]);

  const tradeGuard = useTradeGuard();
  const tradingSession = useTradingSession();
  const { addActivity } = useActivityFeed();
  const { opportunities } = useYieldData();
  const { config, isConfigured } = useLLMConfig();
  const { intelligence, loading: polyLoading, error: polyError } = usePolymarket();

  // ── Session report generation via LLM ────────────────────────────────────

  const generateReport = useCallback(async (data: {
    params: SessionParams;
    pnlSol: number;
    pnlPct: number;
    tradesExecuted: number;
    cyclesCompleted: number;
    durationMs: number;
    reason: string;
  }): Promise<string> => {
    const localEndpoint = config?.localEndpoint || '';
    if (!localEndpoint && !config?.llmKeys) {
      // No LLM configured — return empty to trigger fallback
      return '';
    }
    try {
      const res = await fetch('/api/openclaw/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: 'You are MoltBot, the trading agent for Makora. Generate a concise session report in markdown. Include: performance summary, what worked, what didn\'t, risk events if any, and a recommendation for the next session. Be direct and data-driven.' },
            { role: 'user', content: `Generate a session report:\n- Strategy: ${data.params.strategy}\n- Budget: ${data.params.walletPct}% of portfolio\n- Duration: ${Math.round(data.durationMs / 60000)} minutes\n- Reason ended: ${data.reason}\n- P&L: ${data.pnlSol >= 0 ? '+' : ''}${data.pnlSol.toFixed(4)} SOL (${data.pnlPct >= 0 ? '+' : ''}${data.pnlPct.toFixed(2)}%)\n- OODA cycles: ${data.cyclesCompleted}\n- Trades executed: ${data.tradesExecuted}${data.params.focusTokens?.length ? `\n- Focus tokens: ${data.params.focusTokens.join(', ')}` : ''}` },
          ],
          gatewayUrl: localEndpoint || 'http://localhost:1234',
          sessionId: 'makora-report',
        }),
      });
      if (res.ok) {
        const result = await res.json();
        return result.content || '';
      }
    } catch { /* fall through */ }
    return '';
  }, [config?.localEndpoint, config?.llmKeys]);

  // ── Wire trading session callbacks ─────────────────────────────────────────

  useEffect(() => {
    tradingSession.setCallbacks({
      onStartLoop: () => ooda.startLoop(),
      onStopLoop: () => ooda.stopLoop(),
      onSetAutoMode: (auto) => ooda.setAutoMode(auto),
      onSetSessionParams: (params) => ooda.setSessionParams(params),
      onGetPortfolioValue: () => ooda.lastObservation?.totalPortfolio || (cachedBalanceRef.current + (vault.vaultBalance || 0)),
      onGetVaultValue: () => ooda.lastObservation?.vaultBalance || vault.vaultBalance || 0,
      onGenerateReport: generateReport,
    });
  }, [ooda.startLoop, ooda.stopLoop, ooda.setAutoMode, ooda.setSessionParams, ooda.lastObservation, vault.vaultBalance, generateReport, tradingSession.setCallbacks]);

  // DISABLED: Auto-resume session on page load
  // MoltBot should NOT start automatically - user must explicitly start a session
  // The old behavior was causing the bot to trade without user consent
  //
  // const resumedRef = useRef(false);
  // useEffect(() => {
  //   if (!resumedRef.current && tradingSession.session.status === 'active') {
  //     resumedRef.current = true;
  //     tradingSession.resumeSession();
  //     addActivity({ action: 'Resumed trading session from previous page load', status: 'adapt' });
  //   }
  // }, [tradingSession.session.status, tradingSession.resumeSession, addActivity]);

  // ── Agent chat — uses local model or cloud API keys ─────────────────────────

  const localEndpoint = config?.localEndpoint || '';
  const chatBridge = useChatBridge({
    gatewayUrl: localEndpoint,
    sessionId: 'makora-anon',
    llmKeys: config?.llmKeys, // Pass cloud API keys for fallback
    callbacks: {
      onSetMode: async (mode) => {
        ooda.setAutoMode(mode === 'auto');
        if (mode === 'auto' && !ooda.isRunning) {
          ooda.startLoop();
        }
      },
      onStopLoop: () => ooda.stopLoop(),
      onGetPortfolio: async () => {
        // Use OODA data if available
        const obs = ooda.lastObservation;
        if (obs) {
          const pos = ooda.positionSnapshot;
          const vaultBal = obs.vaultBalance;
          const freeSol = vaultBal > 0 ? Math.max(0, obs.walletBalance - vaultBal) : obs.walletBalance;
          const lines = [`Total: ${obs.totalPortfolio.toFixed(4)} SOL`];
          lines.push(`  Wallet (your funds): ${freeSol.toFixed(4)} SOL`);
          if (vaultBal > 0) {
            lines.push(`  Vault (agent budget): ${vaultBal.toFixed(4)} SOL`);
            lines.push(`NOTE: The agent trades ONLY the Vault balance (${vaultBal.toFixed(4)} SOL), NOT the wallet funds.`);
          }
          if (pos?.positions) {
            lines.push('Tokens:');
            for (const p of pos.positions) lines.push(`  ${p.symbol}: ${p.uiAmount.toFixed(4)}`);
          }
          if (pos?.allocation) {
            lines.push('Allocation:');
            for (const a of pos.allocation) lines.push(`  ${a.symbol}: ${a.pct}%`);
          }
          return lines.join('\n');
        }
        // Fallback: use cached wallet + vault balance when OODA hasn't run yet
        if (!publicKey) return 'No wallet connected. Connect Phantom or Solflare to view your portfolio.';
        const walletBal = cachedBalanceRef.current;
        const vaultBal = vault.vaultBalance || 0;
        const total = walletBal + vaultBal;
        const lines = [`Total: ${total.toFixed(4)} SOL`];
        lines.push(`  Wallet (your funds): ${walletBal.toFixed(4)} SOL`);
        if (vaultBal > 0) {
          lines.push(`  Vault (agent budget): ${vaultBal.toFixed(4)} SOL`);
          lines.push(`NOTE: The agent trades ONLY the Vault balance (${vaultBal.toFixed(4)} SOL), NOT the wallet funds.`);
        }
        return lines.join('\n');
      },
      // ── Direct execution callbacks (chat commands) ────────────────────────
      onSwap: async (amount: number, from: string, to: string) => {
        if (!publicKey) throw new Error('Connect wallet first');
        const res = await fetch('/api/agent/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            allocation: [{
              protocol: 'Jupiter',
              symbol: `${from}->${to}`,
              pct: 100,
              expectedApy: 0,
              strategyTag: 'swap',
              risk: 'Low',
            }],
            walletPublicKey: publicKey.toBase58(),
            riskLimits: { maxPositionSizePct: 100, maxSlippageBps: 100, maxDailyLossPct: 10, minSolReserve: 0.01, maxProtocolExposurePct: 100 },
            confidence: 100,
            portfolioValueSol: amount,
            signingMode: ooda.signingMode,
          }),
        });
        const data = await res.json();
        const r = data.results?.[0];
        if (r?.success) {
          addActivity({ action: `Swap ${amount} ${from} -> ${to}${r.simulated ? ' (simulated)' : ''}`, status: 'success' });
        } else {
          addActivity({ action: `Swap failed: ${r?.error || data.error || 'unknown'}`, status: 'warning' });
          throw new Error(r?.error || data.error || 'Swap failed');
        }
      },
      onStake: async (amount: number, token: string) => {
        if (!publicKey) throw new Error('Connect wallet first');
        const res = await fetch('/api/agent/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            allocation: [{
              protocol: 'Marinade',
              symbol: `${token}->mSOL`,
              pct: 100,
              expectedApy: 7.5,
              strategyTag: 'stake',
              risk: 'Low',
            }],
            walletPublicKey: publicKey.toBase58(),
            riskLimits: { maxPositionSizePct: 100, maxSlippageBps: 100, maxDailyLossPct: 10, minSolReserve: 0.01, maxProtocolExposurePct: 100 },
            confidence: 100,
            portfolioValueSol: amount,
            signingMode: ooda.signingMode,
          }),
        });
        const data = await res.json();
        const r = data.results?.[0];
        if (r?.success) {
          addActivity({ action: `Stake ${amount} ${token}${r.simulated ? ' (simulated)' : ''}`, status: 'success' });
        } else {
          addActivity({ action: `Stake failed: ${r?.error || data.error || 'unknown'}`, status: 'warning' });
          throw new Error(r?.error || data.error || 'Stake failed');
        }
      },
      onUnstake: async (amount: number, token: string) => {
        if (!publicKey) throw new Error('Connect wallet first');
        const res = await fetch('/api/agent/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            allocation: [{
              protocol: 'Marinade',
              symbol: token,
              pct: 100,
              expectedApy: 0,
              strategyTag: 'sell',
              risk: 'Low',
            }],
            walletPublicKey: publicKey.toBase58(),
            riskLimits: { maxPositionSizePct: 100, maxSlippageBps: 100, maxDailyLossPct: 10, minSolReserve: 0.01, maxProtocolExposurePct: 100 },
            confidence: 100,
            portfolioValueSol: amount,
            signingMode: ooda.signingMode,
          }),
        });
        const data = await res.json();
        const r = data.results?.[0];
        if (r?.success) {
          addActivity({ action: `Unstake ${amount} ${token}${r.simulated ? ' (simulated)' : ''}`, status: 'success' });
        } else {
          addActivity({ action: `Unstake failed: ${r?.error || data.error || 'unknown'}`, status: 'warning' });
          throw new Error(r?.error || data.error || 'Unstake failed');
        }
      },
      // ── Session callbacks ──────────────────────────────────────────────────
      onStartSession: async (params: SessionParams) => {
        const error = tradingSession.startSession(params);
        if (error) return `Failed to start session: ${error}`;
        const budgetSource = params.useVaultOnly ? 'VAULT ONLY' : 'total portfolio';
        const vaultBal = vault.vaultBalance || 0;
        addActivity({
          action: `Trading session started: ${params.walletPct}% ${budgetSource}${params.useVaultOnly ? ` (${vaultBal.toFixed(4)} SOL)` : ''}, ${params.strategy} strategy`,
          status: 'success',
        });
        const durationLabel = params.durationMs >= 3600000
          ? `${Math.round(params.durationMs / 3600000)}h`
          : `${Math.round(params.durationMs / 60000)}min`;
        const cycleTime = ooda.tradingMode === 'perps' ? '~3 seconds' : '~5 minutes';
        const budgetMsg = params.useVaultOnly
          ? `Using ${params.walletPct}% of your VAULT (${vaultBal.toFixed(4)} SOL)`
          : `Using ${params.walletPct}% of your total portfolio`;
        return `Trading session started in ${ooda.tradingMode.toUpperCase()} mode. ${budgetMsg} with ${params.strategy} strategy for ${durationLabel}. Cycle time: ${cycleTime}. The wheel is spinning.`;
      },
      onStopSession: async () => {
        tradingSession.stopSession();
        addActivity({ action: 'Trading session stopped by user', status: 'warning' });
        return 'Trading session stopped. Generating report...';
      },
      onResetSession: () => {
        tradingSession.forceReset();
        ooda.stopLoop();
        addActivity({ action: 'Session force-reset: all data cleared', status: 'warning' });
      },
      onSessionStatus: () => {
        const s = tradingSession.session;
        if (s.status === 'idle') return 'No active session. Say "trade 20% for 1 hour" to start.';
        const pnlSign = s.pnlSol >= 0 ? '+' : '';
        const timeLeft = formatTimeRemaining(tradingSession.timeRemainingMs);
        return [
          `Status: ${s.status.toUpperCase()}`,
          `Strategy: ${s.params?.strategy ?? 'balanced'}`,
          `Budget: ${s.params?.walletPct ?? 0}%`,
          `P&L: ${pnlSign}${s.pnlSol.toFixed(4)} SOL (${pnlSign}${s.pnlPct.toFixed(2)}%)`,
          `Time remaining: ${timeLeft}`,
          `Cycles: ${s.cyclesCompleted} | Trades: ${s.tradesExecuted}`,
        ].join('\n');
      },
    },
  });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'details' | 'intelligence' | 'execution' | 'risk'>('details');
  const [secondaryOpen, setSecondaryOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Re-check connection when settings panel closes (user may have saved new keys)
  const handleSettingsClose = useCallback(() => {
    setSettingsOpen(false);
    // Small delay to let config state update from localStorage
    setTimeout(() => chatBridge.checkConnection(), 100);
  }, [chatBridge.checkConnection]);

  // Force re-render every second for countdown timer
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!tradingSession.isActive) return;
    const timer = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [tradingSession.isActive]);

  // ── Feed OODA loop with latest yield data ──────────────────────────────────

  useEffect(() => {
    ooda.setYields(opportunities);
  }, [opportunities, ooda.setYields]);

  // ── Connect trade guard to OODA loop ───────────────────────────────────────

  useEffect(() => {
    ooda.setTradeGuard({
      initSession: tradeGuard.initSession,
      updateValue: tradeGuard.updateValue,
      updatePositions: tradeGuard.updatePositions,
      vetTrade: tradeGuard.vetTrade,
      getStopLossTriggers: tradeGuard.getStopLossTriggers,
      recordEntry: tradeGuard.recordEntry,
      isDailyHalted: () => tradeGuard.state.dailyLimitHalted,
      setConfig: tradeGuard.setConfig,
    });
  }, [ooda.setTradeGuard, tradeGuard]);

  // ── Feed LLM config to OODA loop ──────────────────────────────────────────

  useEffect(() => {
    if (config && (config.localEndpoint || Object.values(config.llmKeys).some(k => k && k.length > 0))) {
      ooda.setGateway({
        endpoint: config.localEndpoint,
        llmKeys: config.llmKeys,
      });
    } else {
      ooda.setGateway(null);
    }
    if (config?.signingMode) {
      ooda.setSigningMode(config.signingMode);
    }
  }, [config, ooda.setGateway, ooda.setSigningMode]);

  // ── Feed Polymarket data to OODA loop ──────────────────────────────────────

  useEffect(() => {
    if (config?.enablePolymarket !== false && intelligence) {
      ooda.setPolymarketData(intelligence);
    } else {
      ooda.setPolymarketData(null);
    }
  }, [intelligence, config?.enablePolymarket, ooda.setPolymarketData]);

  const sentimentBias = intelligence?.sentimentSummary?.overallBias as 'bullish' | 'neutral' | 'bearish' | undefined;

  // ── Inject initial wallet context into chat immediately (before OODA runs) ──

  // Inject wallet context eagerly — no need to wait for isConfigured or OODA
  const initialContextSent = useRef(false);
  useEffect(() => {
    if (!publicKey || initialContextSent.current) return;
    connection.getBalance(publicKey).then(bal => {
      const sol = bal / LAMPORTS_PER_SOL;
      chatBridge.injectContext(
        `LIVE WALLET DATA: ${sol.toFixed(4)} SOL in wallet. Mode: ${ooda.isAutoMode ? 'AUTO' : 'ADVISORY'}. Network: devnet.`
      );
      initialContextSent.current = true;
    }).catch(() => {});
  }, [publicKey, connection, chatBridge.injectContext, ooda.isAutoMode]);

  // ── Feed app context to chat bridge on each OODA cycle ─────────────────────

  const lastContextRef = useRef<string>('');
  const injectContextRef = useRef(chatBridge.injectContext);
  injectContextRef.current = chatBridge.injectContext;

  useEffect(() => {
    if (!isConfigured) return;
    const obs = ooda.lastObservation;
    if (!obs) return;
    const vaultBal = obs.vaultBalance;
    const freeSol = vaultBal > 0 ? Math.max(0, obs.walletBalance - vaultBal) : obs.walletBalance;
    const cycleTime = ooda.tradingMode === 'perps' ? '3s' : '5min';
    const parts = [`Makora agent active. Trading mode: ${ooda.tradingMode.toUpperCase()} (${cycleTime} cycles). Total: ${obs.totalPortfolio.toFixed(4)} SOL. Wallet (user funds): ${freeSol.toFixed(4)} SOL. Vault (agent budget): ${vaultBal.toFixed(4)} SOL. The agent trades ONLY the Vault balance. OODA cycle #${ooda.adaptations}. Mode: ${ooda.isAutoMode ? 'AUTO' : 'ADVISORY'}.`];
    if (ooda.llmOrient?.analysis) {
      const a = ooda.llmOrient.analysis;
      parts.push(`Last analysis: ${a.marketAssessment.sentiment} (${a.marketAssessment.confidence}% confidence). Key factors: ${a.marketAssessment.keyFactors?.join(', ') || 'none'}.`);
      if (a.allocation.length > 0) {
        parts.push(`Target allocation: ${a.allocation.map(al => `${al.token} ${al.percentOfPortfolio}% (${al.action})`).join(', ')}.`);
      }
    }
    if (intelligence) {
      const pm = intelligence;
      parts.push(`Polymarket signals: ${pm.sentimentSummary?.overallBias || 'neutral'} bias, ${pm.sentimentSummary?.highConvictionCount || 0} high-conviction markets.`);
      if (pm.cryptoMarkets?.length > 0) {
        const top = pm.cryptoMarkets.slice(0, 3).map((m: any) => `${m.question} (${(m.probability * 100).toFixed(0)}%)`).join('; ');
        parts.push(`Top signals: ${top}.`);
      }
    }
    // Session context - use stable values to avoid re-renders
    const sessionStatus = tradingSession.session.status;
    const sessionPnl = tradingSession.session.pnlSol;
    const sessionCycles = tradingSession.session.cyclesCompleted;
    if (sessionStatus === 'active') {
      const s = tradingSession.session;
      parts.push(`Active session: ${s.params?.strategy} strategy, ${s.params?.walletPct}% budget. P&L: ${sessionPnl >= 0 ? '+' : ''}${sessionPnl.toFixed(4)} SOL (${s.pnlPct >= 0 ? '+' : ''}${s.pnlPct.toFixed(2)}%). Cycles: ${sessionCycles}. Time left: ${formatTimeRemaining(tradingSession.timeRemainingMs)}.`);
    }
    if (ooda.executionResults.length > 0) {
      const ok = ooda.executionResults.filter(r => r.success && !r.simulated).length;
      const sim = ooda.executionResults.filter(r => r.simulated).length;
      const fail = ooda.executionResults.filter(r => !r.success).length;
      parts.push(`Last execution: ${ok} executed, ${sim} simulated, ${fail} failed.`);
    }
    const ctx = parts.join(' ');
    // Only inject if context actually changed to prevent infinite loops
    if (ctx !== lastContextRef.current) {
      lastContextRef.current = ctx;
      injectContextRef.current(ctx);
    }
  }, [ooda.adaptations, ooda.lastObservation, ooda.llmOrient, ooda.executionResults, ooda.isAutoMode, ooda.tradingMode, intelligence, isConfigured, tradingSession.session.status, tradingSession.session.pnlSol, tradingSession.session.pnlPct, tradingSession.session.cyclesCompleted, tradingSession.session.params?.strategy, tradingSession.session.params?.walletPct, tradingSession.timeRemainingMs]);

  // ── Tick trading session on each OODA cycle ────────────────────────────────

  useEffect(() => {
    if (!tradingSession.isActive || !ooda.lastObservation) return;
    const tradesThisCycle = ooda.executionResults.filter(r => r.success && !r.simulated).length;
    tradingSession.tickSession({
      totalPortfolio: ooda.lastObservation.totalPortfolio,
      tradesThisCycle,
      unrealizedPerpPnlSol: perpPnlSol, // Include perp positions P&L
    });
  }, [ooda.adaptations, ooda.lastObservation, ooda.executionResults, tradingSession.isActive, tradingSession.tickSession, perpPnlSol]);

  // ── Inject session report into chat when session ends ──────────────────────

  const prevSessionStatus = useRef(tradingSession.session.status);
  useEffect(() => {
    const wasActive = prevSessionStatus.current === 'active';
    const nowDone = tradingSession.session.status === 'completed' || tradingSession.session.status === 'stopped';
    prevSessionStatus.current = tradingSession.session.status;

    if (wasActive && nowDone && tradingSession.session.report) {
      chatBridge.injectContext(`SESSION REPORT:\n${tradingSession.session.report.summary}`);
      addActivity({
        action: `Session ${tradingSession.session.status}: ${tradingSession.session.report.pnlSol >= 0 ? '+' : ''}${tradingSession.session.report.pnlSol.toFixed(4)} SOL (${tradingSession.session.report.pnlPct >= 0 ? '+' : ''}${tradingSession.session.report.pnlPct.toFixed(2)}%)`,
        status: tradingSession.session.report.pnlSol >= 0 ? 'success' : 'warning',
      });
    }
  }, [tradingSession.session.status, tradingSession.session.report, chatBridge.injectContext, addActivity]);

  // ── Check chat connection when LLM is configured (local or cloud) ──────────

  const hasCloudKeys = config?.llmKeys && Object.values(config.llmKeys).some(k => k && k.length > 0);
  useEffect(() => {
    if (localEndpoint || hasCloudKeys) {
      chatBridge.checkConnection();
    }
  }, [localEndpoint, hasCloudKeys, chatBridge.checkConnection]);

  // ── Tab definitions (no more AGENT tab — chat is always visible) ───────────

  const tabs = [
    { id: 'details' as const, kanji: '制', label: 'DETAILS' },
    { id: 'intelligence' as const, kanji: '知', label: 'INTELLIGENCE' },
    { id: 'execution' as const, kanji: '執', label: 'EXECUTION' },
    { id: 'risk' as const, kanji: '防', label: 'RISK' },
  ];

  // ── Derive past decisions for Self-Evaluation from execution results ──────

  const selfEvalDecisions = useMemo<PastDecision[]>(() => {
    return ooda.executionResults
      .filter(r => !r.simulated)
      .map(r => ({
        timestamp: Date.now(),
        action: `${r.action} via ${r.protocol}`,
        reasoning: r.riskAssessment?.summary || 'No reasoning available',
        outcome: (r.success ? 'profit' : 'loss') as 'profit' | 'loss' | 'neutral',
        pnlPercent: r.success ? (r.riskAssessment?.riskScore ?? 0) * 0.1 : -(r.riskAssessment?.riskScore ?? 0) * 0.1,
      }));
  }, [ooda.executionResults]);

  const selfEvalLLMConfig = useMemo(() => {
    if (!config?.llmKeys) return null;
    const entries = Object.entries(config.llmKeys);
    const active = entries.find(([, v]) => v && v.length > 0);
    if (!active) return null;
    return {
      provider: active[0],
      apiKey: active[1] as string,
      model: active[0] === 'anthropic' ? 'claude-sonnet-4-20250514' : active[0] === 'openai' ? 'gpt-4o' : 'qwen-max',
    };
  }, [config?.llmKeys]);

  return (
    <div className="h-screen bg-bg-void flex flex-col overflow-hidden">
      <Header
        onSettingsOpen={() => setSettingsOpen(true)}
        llmModel={isConfigured ? 'AI Active' : undefined}
        sentimentBias={sentimentBias}
        tradingMode={ooda.tradingMode}
        onTradingModeChange={ooda.setTradingMode}
      />

      {/* ── Main content: Wheel (left) + Chat (right) — always visible ── */}
      <main className="flex-1 min-h-0 overflow-hidden">
        <div className="max-w-[1600px] 2xl:max-w-[2200px] mx-auto px-4 py-2 h-full flex flex-col">

          {/* Onboarding banner for edge cases */}
          {!bannerDismissed && (
            <ErrorBoundary fallback={null}>
              <div className="flex-shrink-0 mb-2">
                <OnboardingBanner
                  walletConnected={!!publicKey}
                  llmConfigured={isConfigured}
                  onDismiss={() => setBannerDismissed(true)}
                />
              </div>
            </ErrorBoundary>
          )}

          {/* Top row: Wheel + Chat */}
          <div className="flex flex-col lg:flex-row gap-3 min-h-0" style={{ flex: secondaryOpen ? '0 0 55%' : '1 1 auto' }}>
            {/* Left: Wheel column */}
            <div className="w-full lg:w-[35%] min-w-0 lg:min-w-[300px] max-h-[50vh] lg:max-h-none flex-shrink-0 min-h-0">
              <TheWheel
                oodaState={ooda}
                sessionActive={tradingSession.isActive}
                sessionPnlPct={tradingSession.session.pnlPct}
                sessionPnlSol={tradingSession.session.pnlSol}
                sessionTimeRemaining={tradingSession.isActive ? formatTimeRemaining(tradingSession.timeRemainingMs) : undefined}
                sessionStrategy={tradingSession.session.params?.strategy}
              />
            </div>

            {/* Right: Chat panel OR Positions panel (when Execution tab is open) */}
            <div className="flex-1 min-h-0">
              {secondaryOpen && activeTab === 'execution' ? (
                <PositionsPanel className="h-full overflow-auto" />
              ) : (
                <ChatPanel
                  messages={chatBridge.messages}
                  isStreaming={chatBridge.isStreaming}
                  isConnected={chatBridge.isConnected}
                  error={chatBridge.error}
                  onSendMessage={chatBridge.sendMessage}
                  onClearChat={chatBridge.clearChat}
                  onCheckConnection={chatBridge.checkConnection}
                />
              )}
            </div>
          </div>

          {/* ── Secondary tabs (collapsible) ── */}
          <div className="flex-shrink-0 mt-2">
            {/* Tab bar */}
            <nav className="flex items-center gap-4 border-t border-cursed/10 pt-1">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => {
                    if (activeTab === tab.id && secondaryOpen) {
                      setSecondaryOpen(false);
                    } else {
                      setActiveTab(tab.id);
                      setSecondaryOpen(true);
                    }
                  }}
                  className={`text-[9px] font-mono tracking-[0.15em] uppercase transition-colors py-1 border-b-2 ${
                    activeTab === tab.id && secondaryOpen
                      ? 'text-cursed border-cursed'
                      : 'text-text-muted hover:text-text-secondary border-transparent'
                  }`}
                >
                  {tab.kanji} {tab.label}
                </button>
              ))}
              <div className="flex-1" />
              {secondaryOpen && (
                <button
                  onClick={() => setSecondaryOpen(false)}
                  className="text-[9px] font-mono text-text-muted hover:text-cursed transition-colors"
                >
                  COLLAPSE
                </button>
              )}
            </nav>
          </div>

          {/* Tab content area */}
          {secondaryOpen && (
            <div className="flex-1 min-h-0 overflow-auto mt-1">
              {/* DETAILS */}
              {activeTab === 'details' && (
                <div className="space-y-3 h-full">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                    <div className="min-h-0 overflow-auto">
                      <PortfolioCard />
                    </div>
                    <div className="min-h-0 overflow-auto">
                      <LLMReasoningPanel llmOrient={ooda.llmOrient} phase={ooda.phase} />
                    </div>
                    <div className="min-h-0 overflow-auto">
                      <ActivityFeed />
                    </div>
                  </div>
                  <ErrorBoundary>
                    <div className="min-h-0 overflow-auto">
                      <PerformanceHistoryPanel />
                    </div>
                  </ErrorBoundary>
                </div>
              )}

              {/* INTELLIGENCE */}
              {activeTab === 'intelligence' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 h-full">
                  <div className="min-h-0 overflow-auto">
                    <PolymarketPanel
                      intelligence={intelligence}
                      loading={polyLoading}
                      error={polyError}
                    />
                  </div>
                  <ErrorBoundary>
                    <div className="min-h-0 overflow-auto">
                      <SelfEvaluationPanel
                        decisions={selfEvalDecisions}
                        llmConfig={selfEvalLLMConfig}
                      />
                    </div>
                  </ErrorBoundary>
                  <div className="min-h-0 overflow-auto">
                    <ActivityFeed />
                  </div>
                </div>
              )}

              {/* EXECUTION */}
              {activeTab === 'execution' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 h-full">
                  <div className="min-h-0 overflow-auto">
                    <ExecutionPanel
                      executionResults={ooda.executionResults}
                      positionSnapshot={ooda.positionSnapshot}
                      isAutoMode={ooda.isAutoMode}
                      confidence={ooda.confidence}
                      tradeGuard={tradeGuard}
                    />
                  </div>
                  <div className="min-h-0 overflow-auto">
                    <ActivityFeed />
                  </div>
                </div>
              )}

              {/* RISK */}
              {activeTab === 'risk' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 h-full">
                  <div className="min-h-0 overflow-auto">
                    <RiskControls
                      isAgentAutoMode={ooda.isAutoMode}
                      onSetAutoMode={ooda.setAutoMode}
                      signingMode={ooda.signingMode}
                      onSetSigningMode={ooda.setSigningMode}
                      agentRiskParams={ooda.agentRiskParams}
                      walletBalance={ooda.lastObservation?.walletBalance}
                      vaultBalance={ooda.lastObservation?.vaultBalance}
                    />
                  </div>
                  <div className="min-h-0 overflow-auto">
                    <TradeGuardPanel state={tradeGuard.state} config={tradeGuard.config} />
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </main>

      {/* Settings drawer */}
      <SettingsPanel open={settingsOpen} onClose={handleSettingsClose} />
    </div>
  );
}

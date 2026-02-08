'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Header } from '@/components/Header';
import { TheWheel } from '@/components/TheWheel';
import { PortfolioCard } from '@/components/PortfolioCard';
import { TradeGuardPanel } from '@/components/TradeGuardPanel';
import { ActivityFeed } from '@/components/ActivityFeed';
import { RiskControls } from '@/components/RiskControls';
import { LLMReasoningPanel } from '@/components/LLMReasoningPanel';
import { PolymarketPanel } from '@/components/PolymarketPanel';
import { ExecutionPanel } from '@/components/ExecutionPanel';
import { SelfEvaluationPanel } from '@/components/SelfEvaluationPanel';
import { PositionsPanel } from '@/components/PositionsPanel';
import { PerformanceHistoryPanel } from '@/components/PerformanceHistoryPanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useOODALoop } from '@/hooks/useOODALoop';
import type { PastDecision } from '@/hooks/useSelfEvaluation';
import { useYieldData } from '@/hooks/useYieldData';
import { usePolymarket } from '@/hooks/usePolymarket';
import { useActivityFeed } from '@/hooks/useActivityFeed';
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
  const vault = useVault();

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
        const solPrice = ooda.lastObservation?.solPrice || 180;
        const pnlUsd = data.perpSummary?.totalUnrealizedPnl || 0;
        setPerpPnlSol(pnlUsd / solPrice);
      } catch { /* ignore */ }
    };

    fetchPerpPnl();
    const interval = setInterval(fetchPerpPnl, 5000);
    return () => clearInterval(interval);
  }, [publicKey, ooda.lastObservation?.solPrice]);

  const tradeGuard = useTradeGuard();
  const tradingSession = useTradingSession();
  const { addActivity } = useActivityFeed();
  const { opportunities } = useYieldData();
  const { intelligence, loading: polyLoading, error: polyError } = usePolymarket();

  // ── Session report generation (agent handles this via Telegram) ──────────

  const generateReport = useCallback(async (): Promise<string> => {
    return '';
  }, []);

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

  const [activeTab, setActiveTab] = useState<'details' | 'intelligence' | 'execution' | 'risk'>('details');

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

  // ── Feed Polymarket data to OODA loop ──────────────────────────────────────

  useEffect(() => {
    if (intelligence) {
      ooda.setPolymarketData(intelligence);
    }
  }, [intelligence, ooda.setPolymarketData]);

  const sentimentBias = intelligence?.sentimentSummary?.overallBias as 'bullish' | 'neutral' | 'bearish' | undefined;

  // ── Tick trading session on each OODA cycle ────────────────────────────────

  useEffect(() => {
    if (!tradingSession.isActive || !ooda.lastObservation) return;
    const tradesThisCycle = ooda.executionResults.filter(r => r.success && !r.simulated).length;
    tradingSession.tickSession({
      totalPortfolio: ooda.lastObservation.totalPortfolio,
      tradesThisCycle,
      unrealizedPerpPnlSol: perpPnlSol,
    });
  }, [ooda.adaptations, ooda.lastObservation, ooda.executionResults, tradingSession.isActive, tradingSession.tickSession, perpPnlSol]);

  // ── Log session report to activity feed when session ends ──────────────────

  const prevSessionStatus = useRef(tradingSession.session.status);
  useEffect(() => {
    const wasActive = prevSessionStatus.current === 'active';
    const nowDone = tradingSession.session.status === 'completed' || tradingSession.session.status === 'stopped';
    prevSessionStatus.current = tradingSession.session.status;

    if (wasActive && nowDone && tradingSession.session.report) {
      addActivity({
        action: `Session ${tradingSession.session.status}: ${tradingSession.session.report.pnlSol >= 0 ? '+' : ''}${tradingSession.session.report.pnlSol.toFixed(4)} SOL (${tradingSession.session.report.pnlPct >= 0 ? '+' : ''}${tradingSession.session.report.pnlPct.toFixed(2)}%)`,
        status: tradingSession.session.report.pnlSol >= 0 ? 'success' : 'warning',
      });
    }
  }, [tradingSession.session.status, tradingSession.session.report, addActivity]);

  // ── Tab definitions ────────────────────────────────────────────────────────

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

  const selfEvalLLMConfig = null;

  return (
    <div className="h-screen bg-bg-void flex flex-col overflow-hidden">
      <Header
        sentimentBias={sentimentBias}
        tradingMode={ooda.tradingMode}
        onTradingModeChange={ooda.setTradingMode}
      />

      <main className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-[1600px] 2xl:max-w-[2200px] mx-auto px-4 py-3 space-y-3">

          {/* Top row: Wheel + Portfolio + Positions */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="min-h-0">
              <TheWheel
                oodaState={ooda}
                sessionActive={tradingSession.isActive}
                sessionPnlPct={tradingSession.session.pnlPct}
                sessionPnlSol={tradingSession.session.pnlSol}
                sessionTimeRemaining={tradingSession.isActive ? formatTimeRemaining(tradingSession.timeRemainingMs) : undefined}
                sessionStrategy={tradingSession.session.params?.strategy}
              />
            </div>
            <div className="min-h-0">
              <PortfolioCard />
            </div>
            <div className="min-h-0">
              <PositionsPanel />
            </div>
          </div>

          {/* Tab bar */}
          <nav className="flex items-center gap-4 border-t border-cursed/10 pt-2">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`text-[9px] font-mono tracking-[0.15em] uppercase transition-colors py-1 border-b-2 ${
                  activeTab === tab.id
                    ? 'text-cursed border-cursed'
                    : 'text-text-muted hover:text-text-secondary border-transparent'
                }`}
              >
                {tab.kanji} {tab.label}
              </button>
            ))}
          </nav>

          {/* Tab content — always visible */}
          <div>
            {/* DETAILS */}
            {activeTab === 'details' && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                  <div className="min-h-0">
                    <LLMReasoningPanel llmOrient={ooda.llmOrient} phase={ooda.phase} />
                  </div>
                  <div className="min-h-0">
                    <ActivityFeed />
                  </div>
                  <ErrorBoundary>
                    <div className="min-h-0">
                      <PerformanceHistoryPanel />
                    </div>
                  </ErrorBoundary>
                </div>
              </div>
            )}

            {/* INTELLIGENCE */}
            {activeTab === 'intelligence' && (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className="min-h-0">
                  <PolymarketPanel
                    intelligence={intelligence}
                    loading={polyLoading}
                    error={polyError}
                  />
                </div>
                <ErrorBoundary>
                  <div className="min-h-0">
                    <SelfEvaluationPanel
                      decisions={selfEvalDecisions}
                      llmConfig={selfEvalLLMConfig}
                    />
                  </div>
                </ErrorBoundary>
                <div className="min-h-0">
                  <ActivityFeed />
                </div>
              </div>
            )}

            {/* EXECUTION */}
            {activeTab === 'execution' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="min-h-0">
                  <ExecutionPanel
                    executionResults={ooda.executionResults}
                    positionSnapshot={ooda.positionSnapshot}
                    isAutoMode={ooda.isAutoMode}
                    confidence={ooda.confidence}
                    tradeGuard={tradeGuard}
                  />
                </div>
                <div className="min-h-0">
                  <ActivityFeed />
                </div>
              </div>
            )}

            {/* RISK */}
            {activeTab === 'risk' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="min-h-0">
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
                <div className="min-h-0">
                  <TradeGuardPanel state={tradeGuard.state} config={tradeGuard.config} />
                </div>
              </div>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Header } from '@/components/Header';
import { TheWheel } from '@/components/TheWheel';
import { PortfolioCard } from '@/components/PortfolioCard';
import { MarketTickerBar } from '@/components/MarketTickerBar';
import { ActivityFeed } from '@/components/ActivityFeed';
import { PositionsPanel } from '@/components/PositionsPanel';
import { PerformanceHistoryPanel } from '@/components/PerformanceHistoryPanel';
import { SentimentPanel } from '@/components/SentimentPanel';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useOODALoop } from '@/hooks/useOODALoop';
import { useYieldData } from '@/hooks/useYieldData';
import { usePolymarket } from '@/hooks/usePolymarket';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import { useTradeGuard } from '@/hooks/useTradeGuard';
import { useTradingSession } from '@/hooks/useTradingSession';
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

  return (
    <div className="h-screen bg-bg-void flex flex-col overflow-hidden">
      <Header
        sentimentBias={sentimentBias}
        tradingMode={ooda.tradingMode}
        onTradingModeChange={ooda.setTradingMode}
      />

      <main className="flex-1 min-h-0 overflow-auto">
        <div className="max-w-[1600px] 2xl:max-w-[2200px] mx-auto px-4 py-3 space-y-3">

          {/* Ticker Bar */}
          <MarketTickerBar />

          {/* Top row: Status + Portfolio + Positions */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3" style={{ minHeight: '200px' }}>
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

          {/* Bottom row: Sentiment + Activity + Performance */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3" style={{ minHeight: '280px' }}>
            <ErrorBoundary>
              <div className="min-h-0">
                <SentimentPanel
                  intelligence={intelligence}
                  loading={polyLoading}
                  error={polyError}
                />
              </div>
            </ErrorBoundary>
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
      </main>
    </div>
  );
}

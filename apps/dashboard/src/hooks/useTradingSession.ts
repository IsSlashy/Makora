'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SessionParams {
  walletPct: number;       // % of budget to trade with
  durationMs: number;      // session duration in ms
  strategy: 'conservative' | 'balanced' | 'aggressive';
  targetProfitPct?: number;
  focusTokens?: string[];  // tokens to focus on (e.g. ["SOL", "USDC"])
  useVaultOnly?: boolean;  // true = trade only vault balance, false = total portfolio
}

export type SessionStatus = 'idle' | 'active' | 'completed' | 'stopped';

export interface SessionReport {
  summary: string;
  pnlSol: number;
  pnlPct: number;
  tradesExecuted: number;
  cyclesCompleted: number;
  strategy: string;
  duration: string;
  recommendation: string;
}

export interface SessionState {
  id: string;
  status: SessionStatus;
  params: SessionParams | null;
  startedAt: number;
  endsAt: number;
  startingValueSol: number;
  currentValueSol: number;
  pnlSol: number;
  pnlPct: number;
  cyclesCompleted: number;
  tradesExecuted: number;
  report: SessionReport | null;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const SESSION_KEY = 'makora_trading_session';
const REPORTS_KEY = 'makora_session_reports';
const MAX_REPORTS = 20;

function loadSession(): SessionState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed: SessionState = JSON.parse(raw);
    // Only restore active sessions
    if (parsed.status === 'active') return parsed;
    return null;
  } catch { return null; }
}

function saveSession(state: SessionState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(state));
  } catch { /* storage full */ }
}

function clearPersistedSession(): void {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

function saveReport(report: SessionReport & { sessionId: string; timestamp: number }): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = localStorage.getItem(REPORTS_KEY);
    const existing = raw ? JSON.parse(raw) : [];
    existing.push(report);
    localStorage.setItem(REPORTS_KEY, JSON.stringify(existing.slice(-MAX_REPORTS)));
  } catch { /* storage full */ }
}

// ─── Initial state ───────────────────────────────────────────────────────────

function initialState(): SessionState {
  return {
    id: '',
    status: 'idle',
    params: null,
    startedAt: 0,
    endsAt: 0,
    startingValueSol: 0,
    currentValueSol: 0,
    pnlSol: 0,
    pnlPct: 0,
    cyclesCompleted: 0,
    tradesExecuted: 0,
    report: null,
  };
}

// ─── Callbacks (injected from page.tsx) ──────────────────────────────────────

export interface TradingSessionCallbacks {
  onStartLoop: () => void;
  onStopLoop: () => void;
  onSetAutoMode: (auto: boolean) => void;
  onSetSessionParams: (params: { walletPct: number; strategy: string; focusTokens?: string[]; useVaultOnly?: boolean }) => void;
  onGetPortfolioValue: () => number;
  onGetVaultValue: () => number;  // Returns vault balance only
  onGenerateReport: (data: {
    params: SessionParams;
    pnlSol: number;
    pnlPct: number;
    tradesExecuted: number;
    cyclesCompleted: number;
    durationMs: number;
    reason: string;
  }) => Promise<string>;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTradingSession() {
  const [session, setSession] = useState<SessionState>(initialState);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const callbacksRef = useRef<TradingSessionCallbacks | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setCallbacks = useCallback((cb: TradingSessionCallbacks) => {
    callbacksRef.current = cb;
  }, []);

  // Restore session from localStorage on mount
  useEffect(() => {
    const saved = loadSession();
    if (saved && saved.status === 'active') {
      // Check if session should have already expired
      if (Date.now() >= saved.endsAt) {
        // Session expired while page was closed — mark completed
        const expired: SessionState = {
          ...saved,
          status: 'completed',
        };
        setSession(expired);
        clearPersistedSession();
      } else {
        setSession(saved);
      }
    }
  }, []);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // ── Start a new trading session ────────────────────────────────────────────

  const startSession = useCallback((params: SessionParams): string | null => {
    const cb = callbacksRef.current;
    if (!cb) return 'Callbacks not initialized';

    const current = sessionRef.current;
    if (current.status === 'active') return 'Session already active';

    // Validate params
    if (params.walletPct < 1 || params.walletPct > 100) return 'Wallet % must be 1-100';
    if (params.durationMs < 60_000) return 'Minimum duration: 1 minute';

    // Snapshot portfolio value - use vault only if specified
    const portfolioValue = params.useVaultOnly
      ? cb.onGetVaultValue()
      : cb.onGetPortfolioValue();
    if (portfolioValue <= 0) return params.useVaultOnly ? 'No vault balance detected' : 'No portfolio value detected';

    const id = `session-${Date.now()}`;
    const now = Date.now();

    const newSession: SessionState = {
      id,
      status: 'active',
      params,
      startedAt: now,
      endsAt: now + params.durationMs,
      startingValueSol: portfolioValue,
      currentValueSol: portfolioValue,
      pnlSol: 0,
      pnlPct: 0,
      cyclesCompleted: 0,
      tradesExecuted: 0,
      report: null,
    };

    setSession(newSession);
    saveSession(newSession);

    // Configure OODA loop
    cb.onSetSessionParams({
      walletPct: params.walletPct,
      strategy: params.strategy,
      focusTokens: params.focusTokens,
      useVaultOnly: params.useVaultOnly,
    });
    cb.onSetAutoMode(true);
    cb.onStartLoop();

    // Start timer to check expiry
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const s = sessionRef.current;
      if (s.status !== 'active') {
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      if (Date.now() >= s.endsAt) {
        stopSessionInternal('expired');
      }
    }, 1000);

    return null; // success
  }, []);

  // Resume a restored session (called from page.tsx after callbacks are set)
  const resumeSession = useCallback(() => {
    const cb = callbacksRef.current;
    const s = sessionRef.current;
    if (!cb || s.status !== 'active') return;

    // Re-configure OODA loop with saved params
    if (s.params) {
      cb.onSetSessionParams({
        walletPct: s.params.walletPct,
        strategy: s.params.strategy,
        focusTokens: s.params.focusTokens,
      });
    }
    cb.onSetAutoMode(true);
    cb.onStartLoop();

    // Re-start timer
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      const curr = sessionRef.current;
      if (curr.status !== 'active') {
        if (timerRef.current) clearInterval(timerRef.current);
        return;
      }
      if (Date.now() >= curr.endsAt) {
        stopSessionInternal('expired');
      }
    }, 1000);
  }, []);

  // ── Internal stop (handles both user-initiated and auto-expiry) ────────────

  const stopSessionInternal = useCallback(async (reason: 'expired' | 'user_stopped' | 'loss_limit') => {
    const cb = callbacksRef.current;
    const s = sessionRef.current;
    if (s.status !== 'active') return;

    // Stop OODA loop
    cb?.onStopLoop();
    cb?.onSetAutoMode(false);

    // Clear timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    // Generate report
    let reportText = '';
    if (cb?.onGenerateReport && s.params) {
      try {
        reportText = await cb.onGenerateReport({
          params: s.params,
          pnlSol: s.pnlSol,
          pnlPct: s.pnlPct,
          tradesExecuted: s.tradesExecuted,
          cyclesCompleted: s.cyclesCompleted,
          durationMs: Date.now() - s.startedAt,
          reason,
        });
      } catch {
        reportText = buildFallbackReport(s, reason);
      }
    } else {
      reportText = buildFallbackReport(s, reason);
    }

    const durationMs = Date.now() - s.startedAt;
    const report: SessionReport = {
      summary: reportText,
      pnlSol: s.pnlSol,
      pnlPct: s.pnlPct,
      tradesExecuted: s.tradesExecuted,
      cyclesCompleted: s.cyclesCompleted,
      strategy: s.params?.strategy ?? 'balanced',
      duration: formatDuration(durationMs),
      recommendation: s.pnlPct >= 0
        ? 'Continue with current strategy parameters.'
        : 'Consider reducing position size or switching to conservative strategy.',
    };

    const finalSession: SessionState = {
      ...s,
      status: reason === 'user_stopped' ? 'stopped' : 'completed',
      report,
    };

    setSession(finalSession);
    clearPersistedSession();

    // Save report for adaptation memory
    saveReport({
      ...report,
      sessionId: s.id,
      timestamp: Date.now(),
    });
  }, []);

  // ── Public stop ────────────────────────────────────────────────────────────

  const stopSession = useCallback(() => {
    stopSessionInternal('user_stopped');
  }, [stopSessionInternal]);

  // ── Tick: called each OODA cycle with new observation data ─────────────────

  const tickSession = useCallback((observation: {
    totalPortfolio: number;
    tradesThisCycle?: number;
    unrealizedPerpPnlSol?: number; // P&L from open perp positions
  }) => {
    const s = sessionRef.current;
    if (s.status !== 'active') return;

    // FIX: On first tick, correct startingValueSol if it was set before OODA had real data
    // This prevents false P&L when session started with wallet-only balance
    let effectiveStartingValue = s.startingValueSol;
    if (s.cyclesCompleted === 0 && Math.abs(observation.totalPortfolio - s.startingValueSol) > 0.5) {
      // First cycle and values differ significantly - use current as starting point
      effectiveStartingValue = observation.totalPortfolio;
    }

    // Include unrealized P&L from perp positions
    const unrealizedPnl = observation.unrealizedPerpPnlSol ?? 0;
    const totalValue = observation.totalPortfolio + unrealizedPnl;

    const pnlSol = totalValue - effectiveStartingValue;
    const pnlPct = effectiveStartingValue > 0 ? (pnlSol / effectiveStartingValue) * 100 : 0;

    const updated: SessionState = {
      ...s,
      startingValueSol: effectiveStartingValue, // Update starting value on first tick if needed
      currentValueSol: totalValue, // Include unrealized P&L in current value
      pnlSol,
      pnlPct,
      cyclesCompleted: s.cyclesCompleted + 1,
      tradesExecuted: s.tradesExecuted + (observation.tradesThisCycle ?? 0),
    };

    setSession(updated);
    saveSession(updated);

    // Check profit target
    if (s.params?.targetProfitPct && pnlPct >= s.params.targetProfitPct) {
      stopSessionInternal('expired'); // treat profit target as successful completion
    }
  }, [stopSessionInternal]);

  // ── Reset to idle (for post-report dismissal) ──────────────────────────────

  const dismissReport = useCallback(() => {
    setSession(initialState());
  }, []);

  // ── Force reset (clears localStorage and state) ────────────────────────────

  const forceReset = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch { /* ignore */ }
    sessionRef.current = initialState();
    setSession(initialState());
    callbacksRef.current.onStopLoop?.();
  }, []);

  // ── Computed values ────────────────────────────────────────────────────────

  const timeRemainingMs = session.status === 'active'
    ? Math.max(0, session.endsAt - Date.now())
    : 0;

  return {
    session,
    timeRemainingMs,
    isActive: session.status === 'active',
    startSession,
    stopSession,
    tickSession,
    dismissReport,
    resumeSession,
    setCallbacks,
    forceReset, // Emergency reset: clears localStorage and stops everything
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function buildFallbackReport(s: SessionState, reason: string): string {
  const duration = formatDuration(Date.now() - s.startedAt);
  const pnlSign = s.pnlSol >= 0 ? '+' : '';
  return [
    `## Session Report`,
    ``,
    `**Status:** ${reason === 'expired' ? 'Completed (time expired)' : reason === 'user_stopped' ? 'Stopped by user' : 'Stopped (loss limit)'}`,
    `**Duration:** ${duration}`,
    `**Strategy:** ${s.params?.strategy ?? 'balanced'}`,
    `**Budget:** ${s.params?.walletPct ?? 0}% of portfolio`,
    ``,
    `### Performance`,
    `- P&L: ${pnlSign}${s.pnlSol.toFixed(4)} SOL (${pnlSign}${s.pnlPct.toFixed(2)}%)`,
    `- Starting value: ${s.startingValueSol.toFixed(4)} SOL`,
    `- Current value: ${s.currentValueSol.toFixed(4)} SOL`,
    `- OODA cycles: ${s.cyclesCompleted}`,
    `- Trades executed: ${s.tradesExecuted}`,
  ].join('\n');
}

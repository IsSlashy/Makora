'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TradeGuardConfig {
  /** Max daily loss as % of starting balance before auto-halt (default 10%) */
  maxDailyLossPct: number;
  /** Stop-loss per position: sell if down this % from entry (default 8%) */
  stopLossPct: number;
  /** Minimum trade size in SOL — reject anything smaller (default 0.01) */
  minTradeSizeSol: number;
  /** Maximum trades per day (default 20) */
  maxDailyTrades: number;
  /** Cooldown between trades on same token in ms (default 5 min) */
  cooldownMs: number;
}

export interface PositionEntry {
  symbol: string;
  entryPriceSol: number; // cumulative SOL invested by the agent
  entryTimestamp: number;
  currentValueSol: number;
  baselineValueSol: number; // position value BEFORE agent's first trade (pre-existing balance)
  pnlPct: number;
}

export interface TradeGuardState {
  /** Portfolio value at session start (SOL) */
  sessionStartValue: number;
  /** Current portfolio value (SOL) */
  currentValue: number;
  /** Session P&L in SOL */
  pnlSol: number;
  /** Session P&L as % */
  pnlPct: number;
  /** Whether daily loss limit has been hit */
  dailyLimitHalted: boolean;
  /** Number of trades executed today */
  dailyTradeCount: number;
  /** Positions with entry tracking for stop-loss */
  trackedPositions: PositionEntry[];
  /** Tokens currently on cooldown */
  cooldowns: Record<string, number>; // symbol -> cooldown expires timestamp
}

export interface TradeGuardVeto {
  allowed: boolean;
  reason?: string;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

const GUARD_STATE_KEY = 'makora_trade_guard';
const GUARD_CONFIG_KEY = 'makora_trade_guard_config';

interface PersistedState {
  sessionStartValue: number;
  sessionDate: string; // YYYY-MM-DD — reset at midnight
  dailyTradeCount: number;
  trackedPositions: PositionEntry[];
  cooldowns: Record<string, number>;
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function loadState(): PersistedState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(GUARD_STATE_KEY);
    if (!raw) return null;
    const parsed: PersistedState = JSON.parse(raw);
    // Reset if it's a new day
    if (parsed.sessionDate !== todayStr()) return null;
    return parsed;
  } catch { return null; }
}

function saveState(state: PersistedState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(GUARD_STATE_KEY, JSON.stringify(state));
  } catch { /* storage full */ }
}

function loadConfig(): TradeGuardConfig {
  if (typeof window === 'undefined') return defaultConfig();
  try {
    const raw = localStorage.getItem(GUARD_CONFIG_KEY);
    if (!raw) return defaultConfig();
    return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch { return defaultConfig(); }
}

function saveConfig(config: TradeGuardConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(GUARD_CONFIG_KEY, JSON.stringify(config));
  } catch { /* storage full */ }
}

function defaultConfig(): TradeGuardConfig {
  return {
    maxDailyLossPct: 10,
    stopLossPct: 8,
    minTradeSizeSol: 0.001,
    maxDailyTrades: 20,
    cooldownMs: 5 * 60 * 1000, // 5 minutes
  };
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTradeGuard() {
  const [config, setConfigState] = useState<TradeGuardConfig>(defaultConfig);
  const [state, setState] = useState<TradeGuardState>({
    sessionStartValue: 0,
    currentValue: 0,
    pnlSol: 0,
    pnlPct: 0,
    dailyLimitHalted: false,
    dailyTradeCount: 0,
    trackedPositions: [],
    cooldowns: {},
  });

  const stateRef = useRef(state);
  stateRef.current = state;
  const configRef = useRef(config);
  configRef.current = config;

  // Load persisted state + config on mount
  useEffect(() => {
    const loaded = loadState();
    const loadedConfig = loadConfig();
    setConfigState(loadedConfig);
    if (loaded) {
      setState(prev => ({
        ...prev,
        sessionStartValue: loaded.sessionStartValue,
        dailyTradeCount: loaded.dailyTradeCount,
        trackedPositions: loaded.trackedPositions,
        cooldowns: loaded.cooldowns,
      }));
    }
  }, []);

  // ── Set session start value (called on first OBSERVE of the day) ──────────
  const initSession = useCallback((portfolioValueSol: number) => {
    const current = stateRef.current;
    // Only set if not already initialized for today
    if (current.sessionStartValue > 0) return;
    setState(prev => ({
      ...prev,
      sessionStartValue: portfolioValueSol,
      currentValue: portfolioValueSol,
    }));
    saveState({
      sessionStartValue: portfolioValueSol,
      sessionDate: todayStr(),
      dailyTradeCount: current.dailyTradeCount,
      trackedPositions: current.trackedPositions,
      cooldowns: current.cooldowns,
    });
  }, []);

  // ── Update current value + recompute P&L (called every OBSERVE) ───────────
  const updateValue = useCallback((portfolioValueSol: number) => {
    setState(prev => {
      let startVal = prev.sessionStartValue || portfolioValueSol;

      // Detect deposit/withdrawal: re-baseline when budget changed >30%.
      // Trades are capped at ~20% per position, so a >30% jump must be a manual deposit/withdrawal.
      if (prev.currentValue > 0 && startVal > 0) {
        const changePct = Math.abs(portfolioValueSol - prev.currentValue) / prev.currentValue;
        if (changePct > 0.3) {
          startVal = portfolioValueSol;
        }
      } else if (prev.currentValue === 0 && startVal > 0) {
        // First call after mount — currentValue not yet set, compare to stored sessionStart
        const changePct = Math.abs(portfolioValueSol - startVal) / startVal;
        if (changePct > 0.3) {
          startVal = portfolioValueSol;
        }
      }

      const pnlSol = portfolioValueSol - startVal;
      const pnlPct = startVal > 0 ? (pnlSol / startVal) * 100 : 0;
      const dailyLimitHalted = pnlPct < -configRef.current.maxDailyLossPct;

      return {
        ...prev,
        sessionStartValue: startVal,
        currentValue: portfolioValueSol,
        pnlSol,
        pnlPct,
        dailyLimitHalted,
      };
    });
  }, []);

  // ── Update position tracking (called after positions are fetched) ─────────
  const updatePositions = useCallback((positions: Array<{ symbol: string; valueSol: number }>) => {
    setState(prev => {
      const updated = prev.trackedPositions.map(tp => {
        const current = positions.find(p => p.symbol === tp.symbol);
        if (!current) return { ...tp, currentValueSol: 0, pnlPct: -100 };
        // P&L = (agentPortionValue - agentInvested) / agentInvested
        // agentPortionValue = currentTotal - baseline (pre-existing before agent traded)
        const agentPortion = current.valueSol - tp.baselineValueSol;
        const pnlPct = tp.entryPriceSol > 0
          ? ((agentPortion - tp.entryPriceSol) / tp.entryPriceSol) * 100
          : 0;
        return { ...tp, currentValueSol: current.valueSol, pnlPct };
      });
      return { ...prev, trackedPositions: updated };
    });
  }, []);

  // ── Record a new position entry ───────────────────────────────────────────
  const recordEntry = useCallback((symbol: string, valueSol: number, preTradePositionValueSol?: number) => {
    setState(prev => {
      // Update existing or add new
      const existing = prev.trackedPositions.find(p => p.symbol === symbol);
      let positions: PositionEntry[];
      if (existing) {
        // Accumulate total invested (sum, not average) so we can compare
        // total SOL invested vs total current position value for accurate P&L
        positions = prev.trackedPositions.map(p =>
          p.symbol === symbol
            ? { ...p, entryPriceSol: p.entryPriceSol + valueSol, currentValueSol: valueSol }
            : p,
        );
      } else {
        // First entry: record the pre-existing position value as baseline
        // so P&L only reflects the agent's trades, not pre-existing holdings
        positions = [...prev.trackedPositions, {
          symbol,
          entryPriceSol: valueSol,
          entryTimestamp: Date.now(),
          currentValueSol: valueSol,
          baselineValueSol: preTradePositionValueSol ?? 0,
          pnlPct: 0,
        }];
      }

      const newState = {
        ...prev,
        trackedPositions: positions,
        dailyTradeCount: prev.dailyTradeCount + 1,
        cooldowns: { ...prev.cooldowns, [symbol]: Date.now() + configRef.current.cooldownMs },
      };

      // Persist
      saveState({
        sessionStartValue: newState.sessionStartValue,
        sessionDate: todayStr(),
        dailyTradeCount: newState.dailyTradeCount,
        trackedPositions: newState.trackedPositions,
        cooldowns: newState.cooldowns,
      });

      return newState;
    });
  }, []);

  // ── Check if a trade is allowed ───────────────────────────────────────────
  const vetTrade = useCallback((symbol: string, tradeSizeSol: number): TradeGuardVeto => {
    const s = stateRef.current;
    const c = configRef.current;

    // 1. Daily loss limit
    if (s.dailyLimitHalted) {
      return { allowed: false, reason: `Daily loss limit hit (${s.pnlPct.toFixed(1)}% < -${c.maxDailyLossPct}%)` };
    }

    // 2. Max daily trades
    if (s.dailyTradeCount >= c.maxDailyTrades) {
      return { allowed: false, reason: `Max daily trades reached (${s.dailyTradeCount}/${c.maxDailyTrades})` };
    }

    // 3. Min trade size
    if (tradeSizeSol < c.minTradeSizeSol) {
      return { allowed: false, reason: `Trade too small (${tradeSizeSol.toFixed(4)} SOL < ${c.minTradeSizeSol} SOL min)` };
    }

    // 4. Cooldown
    const cooldownExpires = s.cooldowns[symbol] || 0;
    if (Date.now() < cooldownExpires) {
      const remainSec = Math.ceil((cooldownExpires - Date.now()) / 1000);
      return { allowed: false, reason: `${symbol} on cooldown (${remainSec}s remaining)` };
    }

    return { allowed: true };
  }, []);

  // ── Get positions that need stop-loss liquidation ─────────────────────────
  const getStopLossTriggers = useCallback((): PositionEntry[] => {
    const c = configRef.current;
    return stateRef.current.trackedPositions.filter(p =>
      p.symbol !== 'SOL' && p.pnlPct < -c.stopLossPct && p.currentValueSol > 0,
    );
  }, []);

  // ── Update config ─────────────────────────────────────────────────────────
  const setConfig = useCallback((updates: Partial<TradeGuardConfig>) => {
    setConfigState(prev => {
      const next = { ...prev, ...updates };
      saveConfig(next);
      return next;
    });
  }, []);

  // ── Reset daily counters (manual reset) ───────────────────────────────────
  const resetDaily = useCallback(() => {
    setState(prev => ({
      ...prev,
      sessionStartValue: prev.currentValue,
      pnlSol: 0,
      pnlPct: 0,
      dailyLimitHalted: false,
      dailyTradeCount: 0,
      cooldowns: {},
    }));
    saveState({
      sessionStartValue: stateRef.current.currentValue,
      sessionDate: todayStr(),
      dailyTradeCount: 0,
      trackedPositions: stateRef.current.trackedPositions,
      cooldowns: {},
    });
  }, []);

  return {
    config,
    state,
    setConfig,
    initSession,
    updateValue,
    updatePositions,
    recordEntry,
    vetTrade,
    getStopLossTriggers,
    resetDaily,
  };
}

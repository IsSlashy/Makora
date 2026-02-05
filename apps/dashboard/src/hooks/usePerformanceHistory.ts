'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Integration Note ────────────────────────────────────────────────────────
// To wire addTrade() into the OODA loop, call it inside useOODALoop.ts at:
//
//   ACT phase, ~line 1511 — inside the `for (const result of results)` loop,
//   right after the activity feed logging (`deps.addActivity({ ... })`) and
//   the trade guard `recordEntry()` call (~line 1537-1549).
//
//   Example integration point (useOODALoop.ts, ACT phase):
//
//     // Record entry in trade guard for stop-loss tracking
//     if (result.success && !result.simulated && guard) {
//       ...
//       // >>> ADD PERFORMANCE HISTORY ENTRY HERE <<<
//       // performanceHistory.addTrade({
//       //   action: result.action,
//       //   asset: targetSymbol,
//       //   amount: inputSol,
//       //   price: observation.solPrice ?? 0,
//       //   pnl: 0,  // P&L is computed later when position closes
//       //   mode: tradingModeRef.current === 'perps' ? 'PERPS' : 'INVEST',
//       //   reasoning: llmOrientUpdate.reasoning,
//       //   sessionId: sessionParamsRef.current?.strategy ?? 'default',
//       // });
//     }
//
// ─────────────────────────────────────────────────────────────────────────────

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TradeEntry {
  id: string;
  timestamp: number;
  action: string;
  asset: string;
  amount: number;
  price: number;
  pnl: number;
  mode: 'PERPS' | 'INVEST';
  reasoning: string;
  sessionId: string;
}

export interface SessionSummary {
  sessionId: string;
  totalTrades: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  startTime: number;
  endTime: number;
}

export interface OverallStats {
  totalTrades: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  bestTrade: TradeEntry | null;
  worstTrade: TradeEntry | null;
  tradesPerMode: { PERPS: number; INVEST: number };
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STORAGE_KEY = 'makora-performance-history';
const MAX_ENTRIES = 200;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadTrades(): TradeEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveTrades(trades: TradeEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    // FIFO: keep only the most recent MAX_ENTRIES
    const trimmed = trades.slice(-MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage may be full — silently fail
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function usePerformanceHistory() {
  const [trades, setTrades] = useState<TradeEntry[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    setTrades(loadTrades());
  }, []);

  const addTrade = useCallback((trade: Omit<TradeEntry, 'id' | 'timestamp'> & { id?: string; timestamp?: number }) => {
    setTrades(prev => {
      const entry: TradeEntry = {
        id: trade.id || `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: trade.timestamp || Date.now(),
        action: trade.action,
        asset: trade.asset,
        amount: trade.amount,
        price: trade.price,
        pnl: trade.pnl,
        mode: trade.mode,
        reasoning: trade.reasoning,
        sessionId: trade.sessionId,
      };
      const updated = [...prev, entry].slice(-MAX_ENTRIES);
      saveTrades(updated);
      return updated;
    });
  }, []);

  const getTrades = useCallback((): TradeEntry[] => {
    return trades;
  }, [trades]);

  const getSessionSummary = useCallback((sessionId: string): SessionSummary | null => {
    const sessionTrades = trades.filter(t => t.sessionId === sessionId);
    if (sessionTrades.length === 0) return null;

    const wins = sessionTrades.filter(t => t.pnl > 0).length;
    const totalPnL = sessionTrades.reduce((sum, t) => sum + t.pnl, 0);
    const timestamps = sessionTrades.map(t => t.timestamp);

    return {
      sessionId,
      totalTrades: sessionTrades.length,
      winRate: sessionTrades.length > 0 ? (wins / sessionTrades.length) * 100 : 0,
      totalPnL,
      avgPnL: sessionTrades.length > 0 ? totalPnL / sessionTrades.length : 0,
      startTime: Math.min(...timestamps),
      endTime: Math.max(...timestamps),
    };
  }, [trades]);

  const getOverallStats = useCallback((): OverallStats => {
    if (trades.length === 0) {
      return {
        totalTrades: 0,
        winRate: 0,
        totalPnL: 0,
        avgPnL: 0,
        bestTrade: null,
        worstTrade: null,
        tradesPerMode: { PERPS: 0, INVEST: 0 },
      };
    }

    const wins = trades.filter(t => t.pnl > 0).length;
    const totalPnL = trades.reduce((sum, t) => sum + t.pnl, 0);

    // Find best and worst trades
    let bestTrade = trades[0];
    let worstTrade = trades[0];
    for (const t of trades) {
      if (t.pnl > bestTrade.pnl) bestTrade = t;
      if (t.pnl < worstTrade.pnl) worstTrade = t;
    }

    const perps = trades.filter(t => t.mode === 'PERPS').length;
    const invest = trades.filter(t => t.mode === 'INVEST').length;

    return {
      totalTrades: trades.length,
      winRate: (wins / trades.length) * 100,
      totalPnL,
      avgPnL: totalPnL / trades.length,
      bestTrade,
      worstTrade,
      tradesPerMode: { PERPS: perps, INVEST: invest },
    };
  }, [trades]);

  const clearHistory = useCallback(() => {
    setTrades([]);
    if (typeof window !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }, []);

  return {
    trades,
    addTrade,
    getTrades,
    getSessionSummary,
    getOverallStats,
    clearHistory,
  };
}

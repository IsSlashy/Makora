'use client';

import { useCallback, useRef, useEffect } from 'react';
import type { LLMAnalysisResult } from './useOODALoop';

const STORAGE_KEY = 'makora_strategy_memory';
const SESSION_MEMORY_KEY = 'makora_session_memory';
const MAX_ENTRIES = 10;
const MAX_SESSION_ENTRIES = 20;

interface MemoryEntry {
  timestamp: number;
  sentiment: 'bullish' | 'neutral' | 'bearish';
  confidence: number;
  allocation: Array<{ symbol: string; pct: number }>;
  reasoning: string;
}

export interface SessionMemoryEntry {
  sessionId: string;
  timestamp: number;
  strategy: 'conservative' | 'balanced' | 'aggressive';
  walletPct: number;
  durationMs: number;
  pnlPct: number;
  pnlSol: number;
  tradesExecuted: number;
  cyclesCompleted: number;
  marketConditions?: string; // e.g. "bullish", "bearish", "neutral"
}

export interface TrendSummary {
  sentimentTrend: string;
  confidenceTrend: string;
  allocationConvergence: string;
  recentCount: number;
  raw: string;
}

function loadMemory(): MemoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as MemoryEntry[];
  } catch {
    return [];
  }
}

function saveMemory(entries: MemoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(-MAX_ENTRIES)));
  } catch { /* storage full */ }
}

function loadSessionMemory(): SessionMemoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SESSION_MEMORY_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as SessionMemoryEntry[];
  } catch {
    return [];
  }
}

function saveSessionMemory(entries: SessionMemoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(SESSION_MEMORY_KEY, JSON.stringify(entries.slice(-MAX_SESSION_ENTRIES)));
  } catch { /* storage full */ }
}

function computeSentimentTrend(entries: MemoryEntry[]): string {
  if (entries.length < 2) return 'insufficient data';

  const counts = { bullish: 0, neutral: 0, bearish: 0 };
  for (const e of entries) counts[e.sentiment]++;

  const dominant = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)[0];

  const [sentiment, count] = dominant;
  const pct = Math.round((count / entries.length) * 100);

  // Check recent direction (last 3 vs first 3)
  if (entries.length >= 4) {
    const recent = entries.slice(-3);
    const older = entries.slice(0, 3);
    const recentBullish = recent.filter(e => e.sentiment === 'bullish').length;
    const olderBullish = older.filter(e => e.sentiment === 'bullish').length;

    if (recentBullish > olderBullish) return `trending bullish (${count}/${entries.length} ${sentiment})`;
    if (recentBullish < olderBullish) return `trending bearish (${count}/${entries.length} ${sentiment})`;
  }

  return `${pct}% ${sentiment} over ${entries.length} cycles`;
}

function computeConfidenceTrend(entries: MemoryEntry[]): string {
  if (entries.length < 2) return 'insufficient data';

  const confidences = entries.map(e => e.confidence);
  const recent = confidences.slice(-3);
  const older = confidences.slice(0, Math.min(3, confidences.length - 1));

  const recentAvg = recent.reduce((s, c) => s + c, 0) / recent.length;
  const olderAvg = older.reduce((s, c) => s + c, 0) / older.length;

  const current = confidences[confidences.length - 1];
  const direction = recentAvg > olderAvg + 3 ? 'rising' : recentAvg < olderAvg - 3 ? 'falling' : 'stable';

  return `${direction} (${Math.round(olderAvg)}->${Math.round(recentAvg)} over last ${entries.length} cycles, current: ${current}%)`;
}

function computeAllocationConvergence(entries: MemoryEntry[]): string {
  if (entries.length < 3) return 'insufficient data';

  // Find the most common allocation pattern in recent entries
  const symbolCounts: Record<string, number[]> = {};
  for (const entry of entries.slice(-5)) {
    for (const alloc of entry.allocation) {
      const key = alloc.symbol.toUpperCase();
      if (!symbolCounts[key]) symbolCounts[key] = [];
      symbolCounts[key].push(alloc.pct);
    }
  }

  const convergences: string[] = [];
  for (const [symbol, pcts] of Object.entries(symbolCounts)) {
    if (pcts.length < 2) continue;
    const avg = Math.round(pcts.reduce((s, p) => s + p, 0) / pcts.length);
    const variance = pcts.reduce((s, p) => s + (p - avg) ** 2, 0) / pcts.length;
    if (variance < 25) { // Low variance = converging
      convergences.push(`${avg}% ${symbol}`);
    }
  }

  return convergences.length > 0
    ? `converging toward ${convergences.join(', ')}`
    : 'allocation varying between cycles';
}

export function useStrategyMemory() {
  const memoryRef = useRef<MemoryEntry[]>([]);
  const sessionMemoryRef = useRef<SessionMemoryEntry[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    memoryRef.current = loadMemory();
    sessionMemoryRef.current = loadSessionMemory();
  }, []);

  /**
   * Record a new LLM analysis result into memory.
   */
  const recordAnalysis = useCallback((analysis: LLMAnalysisResult) => {
    const entry: MemoryEntry = {
      timestamp: Date.now(),
      sentiment: analysis.marketAssessment.sentiment,
      confidence: analysis.marketAssessment.confidence,
      allocation: analysis.allocation.map(a => ({
        symbol: a.token,
        pct: a.percentOfPortfolio,
      })),
      reasoning: analysis.marketAssessment.reasoning,
    };

    memoryRef.current = [...memoryRef.current, entry].slice(-MAX_ENTRIES);
    saveMemory(memoryRef.current);
  }, []);

  /**
   * Record a completed session result for adaptation memory.
   */
  const recordSessionResult = useCallback((entry: SessionMemoryEntry) => {
    sessionMemoryRef.current = [...sessionMemoryRef.current, entry].slice(-MAX_SESSION_ENTRIES);
    saveSessionMemory(sessionMemoryRef.current);
  }, []);

  /**
   * Get adaptation context string for ORIENT prompt injection.
   * Summarizes past session performance by strategy type.
   */
  const getAdaptationContext = useCallback((): string => {
    const entries = sessionMemoryRef.current;
    if (entries.length === 0) return '';

    // Group by strategy
    const byStrategy: Record<string, { wins: number; total: number; avgPnl: number; pnls: number[] }> = {};
    for (const e of entries) {
      if (!byStrategy[e.strategy]) {
        byStrategy[e.strategy] = { wins: 0, total: 0, avgPnl: 0, pnls: [] };
      }
      const group = byStrategy[e.strategy];
      group.total++;
      group.pnls.push(e.pnlPct);
      if (e.pnlPct > 0) group.wins++;
    }

    const lines: string[] = [`Past sessions: ${entries.length} completed.`];
    for (const [strategy, data] of Object.entries(byStrategy)) {
      const winRate = Math.round((data.wins / data.total) * 100);
      const avgPnl = data.pnls.reduce((s, p) => s + p, 0) / data.pnls.length;
      lines.push(`  ${strategy}: ${winRate}% win rate, avg ${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(1)}% P&L (${data.total} sessions)`);
    }

    // Recent trend
    const recent = entries.slice(-3);
    const recentWins = recent.filter(e => e.pnlPct > 0).length;
    lines.push(`Recent trend: ${recentWins}/${recent.length} profitable sessions.`);

    return lines.join('\n');
  }, []);

  /**
   * Get a trend summary for injection into ORIENT context.
   */
  const getTrendSummary = useCallback((): TrendSummary => {
    const entries = memoryRef.current;
    if (entries.length === 0) {
      return {
        sentimentTrend: 'no history',
        confidenceTrend: 'no history',
        allocationConvergence: 'no history',
        recentCount: 0,
        raw: 'No strategy history available.',
      };
    }

    const sentimentTrend = computeSentimentTrend(entries);
    const confidenceTrend = computeConfidenceTrend(entries);
    const allocationConvergence = computeAllocationConvergence(entries);

    const raw = [
      `Sentiment: ${sentimentTrend}`,
      `Confidence: ${confidenceTrend}`,
      `Allocation: ${allocationConvergence}`,
    ].join('\n');

    return {
      sentimentTrend,
      confidenceTrend,
      allocationConvergence,
      recentCount: entries.length,
      raw,
    };
  }, []);

  /**
   * Get the last N analysis entries for ORIENT context.
   */
  const getRecentHistory = useCallback((count: number = 5): string => {
    const entries = memoryRef.current.slice(-count);
    if (entries.length === 0) return 'No recent trades.';

    return entries.map((e, i) => {
      const ago = Math.round((Date.now() - e.timestamp) / 60_000);
      const allocStr = e.allocation.map(a => `${a.symbol} ${a.pct}%`).join(', ');
      return `${i + 1}. [${ago}m ago] ${e.sentiment} ${e.confidence}% — ${allocStr}`;
    }).join('\n');
  }, []);

  return {
    recordAnalysis,
    recordSessionResult,
    getAdaptationContext,
    getTrendSummary,
    getRecentHistory,
    entryCount: memoryRef.current.length,
    sessionCount: sessionMemoryRef.current.length,
  };
}

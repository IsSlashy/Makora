import { NextRequest, NextResponse } from 'next/server';

/**
 * Trade History & Learning API — records closed trades and computes stats + adaptive suggestions.
 *
 * GET  /api/trades?userId=X              → trade history + stats
 * GET  /api/trades?userId=X&action=learning → adaptive suggestions based on performance
 * POST /api/trades                        → record a completed trade
 */

interface TradeRecord {
  id: string;
  market: string;
  side: 'long' | 'short';
  leverage: number;
  collateralUsd: number;
  entryPrice: number;
  exitPrice: number;
  pnlUsd: number;
  pnlPct: number;
  reason: string;
  duration: number; // milliseconds
  closedAt: number;
}

interface TradeStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlUsd: number;
  avgPnlPct: number;
  bestTrade: TradeRecord | null;
  worstTrade: TradeRecord | null;
  avgDurationMs: number;
}

interface LearningSuggestion {
  suggestedLeverage: number;
  suggestedSlPct: number;
  suggestedTpPct: number;
  suggestedCollateral: number;
  reason: string;
}

const TRADES_KEY = '__makora_trades_history';

function getStore(): Record<string, TradeRecord[]> {
  if (!(globalThis as any)[TRADES_KEY]) {
    (globalThis as any)[TRADES_KEY] = {};
  }
  return (globalThis as any)[TRADES_KEY];
}

function computeStats(trades: TradeRecord[]): TradeStats {
  if (trades.length === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalPnlUsd: 0,
      avgPnlPct: 0,
      bestTrade: null,
      worstTrade: null,
      avgDurationMs: 0,
    };
  }

  const wins = trades.filter(t => t.pnlUsd > 0).length;
  const losses = trades.filter(t => t.pnlUsd <= 0).length;
  const totalPnlUsd = trades.reduce((s, t) => s + t.pnlUsd, 0);
  const avgPnlPct = trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length;
  const avgDurationMs = trades.reduce((s, t) => s + t.duration, 0) / trades.length;

  const sorted = [...trades].sort((a, b) => a.pnlUsd - b.pnlUsd);
  const worstTrade = sorted[0];
  const bestTrade = sorted[sorted.length - 1];

  return {
    totalTrades: trades.length,
    wins,
    losses,
    winRate: Math.round((wins / trades.length) * 10000) / 100, // percentage with 2 decimals
    totalPnlUsd: Math.round(totalPnlUsd * 100) / 100,
    avgPnlPct: Math.round(avgPnlPct * 100) / 100,
    bestTrade,
    worstTrade,
    avgDurationMs: Math.round(avgDurationMs),
  };
}

function computeLearningSuggestions(stats: TradeStats, trades: TradeRecord[]): LearningSuggestion {
  // Defaults based on moderate/balanced strategy
  let suggestedLeverage = 5;
  let suggestedSlPct = 5; // 5% stop loss
  let suggestedTpPct = 10; // 10% take profit
  let suggestedCollateral = 100; // $100 default
  const reasons: string[] = [];

  if (trades.length === 0) {
    return {
      suggestedLeverage,
      suggestedSlPct,
      suggestedTpPct,
      suggestedCollateral,
      reason: 'No trade history yet. Using default balanced parameters.',
    };
  }

  // Compute average collateral from recent trades for baseline
  const recentTrades = trades.slice(-10);
  const avgCollateral = recentTrades.reduce((s, t) => s + t.collateralUsd, 0) / recentTrades.length;
  suggestedCollateral = Math.round(avgCollateral * 100) / 100;

  // Compute average leverage from recent trades for baseline
  const avgLeverage = recentTrades.reduce((s, t) => s + t.leverage, 0) / recentTrades.length;
  suggestedLeverage = Math.round(avgLeverage * 10) / 10;

  // Rule 1: Low win rate (< 40%) — tighten SL, widen TP
  if (stats.winRate < 40) {
    suggestedSlPct = Math.max(2, suggestedSlPct - 2); // Tighter stop loss (closer to entry)
    suggestedTpPct = suggestedTpPct + 5; // Wider take profit (further from entry)
    reasons.push(
      `Win rate is low (${stats.winRate}%). Tightening stop-loss to ${suggestedSlPct}% and widening take-profit to ${suggestedTpPct}% to cut losses faster and let winners run.`
    );
  }

  // Rule 2: High win rate (> 60%) — widen SL, increase leverage
  if (stats.winRate > 60) {
    suggestedSlPct = suggestedSlPct + 2; // Wider stop loss (more room)
    suggestedLeverage = Math.min(20, Math.round((suggestedLeverage * 1.25) * 10) / 10); // +25% leverage, cap at 20x
    reasons.push(
      `Win rate is strong (${stats.winRate}%). Widening stop-loss to ${suggestedSlPct}% for more room and increasing leverage to ${suggestedLeverage}x to capitalize on edge.`
    );
  }

  // Rule 3: Negative average P&L — reduce position size
  if (stats.avgPnlPct < 0) {
    suggestedCollateral = Math.max(25, Math.round(suggestedCollateral * 0.75 * 100) / 100); // -25% collateral, min $25
    reasons.push(
      `Average P&L is negative (${stats.avgPnlPct}%). Reducing suggested collateral to $${suggestedCollateral} to limit drawdown.`
    );
  }

  // Rule 4: Positive avg P&L and decent win rate — can increase size slightly
  if (stats.avgPnlPct > 0 && stats.winRate >= 50) {
    suggestedCollateral = Math.round(suggestedCollateral * 1.1 * 100) / 100; // +10% collateral
    reasons.push(
      `Positive average P&L (${stats.avgPnlPct}%) with ${stats.winRate}% win rate. Slightly increasing collateral to $${suggestedCollateral}.`
    );
  }

  return {
    suggestedLeverage,
    suggestedSlPct,
    suggestedTpPct,
    suggestedCollateral,
    reason: reasons.length > 0 ? reasons.join(' ') : 'Performance is balanced. Maintaining current parameters.',
  };
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId') || 'default';
  const actionParam = req.nextUrl.searchParams.get('action');
  const store = getStore();
  const trades = store[userId] || [];
  const stats = computeStats(trades);

  if (actionParam === 'learning') {
    const suggestions = computeLearningSuggestions(stats, trades);
    return NextResponse.json({
      stats,
      suggestions,
      basedOnTrades: trades.length,
    });
  }

  return NextResponse.json({
    trades,
    stats,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId = 'default', trade } = body;

    if (!trade) {
      return NextResponse.json({ error: 'Missing trade data in request body.' }, { status: 400 });
    }

    const store = getStore();
    if (!store[userId]) store[userId] = [];

    const record: TradeRecord = {
      id: `trade-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      market: trade.market || 'SOL-PERP',
      side: trade.side || 'long',
      leverage: trade.leverage || 5,
      collateralUsd: trade.collateralUsd || 100,
      entryPrice: trade.entryPrice || 0,
      exitPrice: trade.exitPrice || 0,
      pnlUsd: trade.pnlUsd ?? 0,
      pnlPct: trade.pnlPct ?? 0,
      reason: trade.reason || 'manual',
      duration: trade.duration || 0,
      closedAt: Date.now(),
    };

    store[userId].push(record);

    const stats = computeStats(store[userId]);

    return NextResponse.json({
      success: true,
      trade: record,
      stats,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
}

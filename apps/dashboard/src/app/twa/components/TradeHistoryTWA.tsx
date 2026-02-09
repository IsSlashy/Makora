'use client';

import { useCallback, useEffect, useState } from 'react';

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
  closedAt: number;
}

interface TradeStats {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlUsd: number;
  avgPnlPct: number;
}

interface LearningSuggestion {
  suggestedLeverage: number;
  suggestedSlPct: number;
  suggestedTpPct: number;
  suggestedCollateral: number;
  reason: string;
}

interface TradeHistoryTWAProps {
  userId?: string;
}

function timeAgo(ts: number): string {
  if (!ts) return '--';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function TradeHistoryTWA({ userId }: TradeHistoryTWAProps) {
  const [trades, setTrades] = useState<TradeRecord[]>([]);
  const [stats, setStats] = useState<TradeStats | null>(null);
  const [learning, setLearning] = useState<LearningSuggestion | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTrades = useCallback(async () => {
    const uid = userId || 'default';
    try {
      const [tradesRes, learningRes] = await Promise.all([
        fetch(`/api/trades?userId=${uid}`),
        fetch(`/api/trades?userId=${uid}&action=learning`),
      ]);

      if (tradesRes.ok) {
        const data = await tradesRes.json();
        setTrades(data.trades || []);
        setStats(data.stats || null);
      }

      if (learningRes.ok) {
        const data = await learningRes.json();
        setLearning(data.suggestions || null);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchTrades();
    const interval = setInterval(fetchTrades, 15000);
    return () => clearInterval(interval);
  }, [fetchTrades]);

  if (loading) {
    return (
      <div className="cursed-card p-4">
        <div className="section-title mb-3">TRADE HISTORY</div>
        <div className="text-text-muted text-xs font-mono animate-pulse">Loading trades...</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stats card */}
      <div className="cursed-card p-4">
        <div className="section-title mb-3">TRADE PERFORMANCE</div>

        {stats && stats.totalTrades > 0 ? (
          <>
            <div className="flex items-center justify-between mb-3">
              <div className="text-center flex-1">
                <div className="text-[8px] font-mono text-text-muted tracking-wider uppercase mb-0.5">Total P&L</div>
                <div className="text-lg font-mono font-bold" style={{ color: stats.totalPnlUsd >= 0 ? '#22c55e' : '#ef4444' }}>
                  {stats.totalPnlUsd >= 0 ? '+' : ''}${stats.totalPnlUsd.toFixed(2)}
                </div>
              </div>
              <div className="w-px h-8 bg-cursed/15" />
              <div className="text-center flex-1">
                <div className="text-[8px] font-mono text-text-muted tracking-wider uppercase mb-0.5">Win Rate</div>
                <div className="text-lg font-mono font-bold" style={{ color: stats.winRate >= 50 ? '#22c55e' : '#ef4444' }}>
                  {stats.winRate.toFixed(1)}%
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs font-mono">
              <div className="text-center flex-1">
                <div className="text-[8px] text-text-muted tracking-wider uppercase mb-0.5">Trades</div>
                <div className="text-cursed font-bold">{stats.totalTrades}</div>
              </div>
              <div className="w-px h-5 bg-cursed/15" />
              <div className="text-center flex-1">
                <div className="text-[8px] text-text-muted tracking-wider uppercase mb-0.5">Wins</div>
                <div className="font-bold" style={{ color: '#22c55e' }}>{stats.wins}</div>
              </div>
              <div className="w-px h-5 bg-cursed/15" />
              <div className="text-center flex-1">
                <div className="text-[8px] text-text-muted tracking-wider uppercase mb-0.5">Losses</div>
                <div className="font-bold" style={{ color: '#ef4444' }}>{stats.losses}</div>
              </div>
              <div className="w-px h-5 bg-cursed/15" />
              <div className="text-center flex-1">
                <div className="text-[8px] text-text-muted tracking-wider uppercase mb-0.5">Avg P&L</div>
                <div className="font-bold" style={{ color: stats.avgPnlPct >= 0 ? '#22c55e' : '#ef4444' }}>
                  {stats.avgPnlPct >= 0 ? '+' : ''}{stats.avgPnlPct.toFixed(1)}%
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-text-muted text-[10px] font-mono">
            No closed trades yet. Open a position to start building your trade history.
          </div>
        )}
      </div>

      {/* Learning suggestions */}
      {learning && stats && stats.totalTrades > 0 && (
        <div className="cursed-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="section-title">AI LEARNING</div>
            <span className="text-[7px] font-mono tracking-wider uppercase px-1.5 py-0.5 rounded-sm"
              style={{ color: '#00E5FF', background: '#00E5FF12' }}>
              Adaptive
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="bg-bg-inner p-2 rounded-sm border border-cursed/10 text-center">
              <div className="text-[8px] font-mono text-text-muted tracking-wider uppercase mb-0.5">SL Target</div>
              <div className="text-sm font-mono font-bold" style={{ color: '#ef4444' }}>
                {learning.suggestedSlPct.toFixed(1)}%
              </div>
            </div>
            <div className="bg-bg-inner p-2 rounded-sm border border-cursed/10 text-center">
              <div className="text-[8px] font-mono text-text-muted tracking-wider uppercase mb-0.5">TP Target</div>
              <div className="text-sm font-mono font-bold" style={{ color: '#22c55e' }}>
                {learning.suggestedTpPct.toFixed(1)}%
              </div>
            </div>
            <div className="bg-bg-inner p-2 rounded-sm border border-cursed/10 text-center">
              <div className="text-[8px] font-mono text-text-muted tracking-wider uppercase mb-0.5">Leverage</div>
              <div className="text-sm font-mono font-bold text-cursed">
                {learning.suggestedLeverage.toFixed(1)}x
              </div>
            </div>
            <div className="bg-bg-inner p-2 rounded-sm border border-cursed/10 text-center">
              <div className="text-[8px] font-mono text-text-muted tracking-wider uppercase mb-0.5">Collateral</div>
              <div className="text-sm font-mono font-bold text-cursed">
                ${learning.suggestedCollateral.toFixed(0)}
              </div>
            </div>
          </div>

          <div className="text-[9px] font-mono text-text-muted leading-relaxed">
            {learning.reason}
          </div>
        </div>
      )}

      {/* Trade list */}
      {trades.length > 0 && (
        <div className="cursed-card p-4">
          <div className="section-title mb-3">RECENT TRADES ({trades.length})</div>

          <div className="space-y-2">
            {[...trades].reverse().slice(0, 10).map(trade => {
              const isProfit = trade.pnlUsd >= 0;
              const pnlColor = isProfit ? '#22c55e' : '#ef4444';
              const reasonLabel = trade.reason === 'stop_loss' ? 'SL' : trade.reason === 'take_profit' ? 'TP' : 'Manual';

              return (
                <div key={trade.id} className="bg-bg-inner p-2.5 rounded-sm border border-cursed/10">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="text-[8px] font-mono font-bold tracking-wider uppercase px-1 py-0.5 rounded-sm"
                        style={{
                          color: trade.side === 'long' ? '#22c55e' : '#ef4444',
                          background: trade.side === 'long' ? '#22c55e12' : '#ef444412',
                        }}
                      >
                        {trade.side}
                      </span>
                      <span className="text-[10px] font-mono font-bold">{trade.market}</span>
                      <span className="text-[9px] font-mono text-text-muted">{trade.leverage}x</span>
                    </div>
                    <span className="text-[10px] font-mono font-bold" style={{ color: pnlColor }}>
                      {isProfit ? '+' : ''}${trade.pnlUsd.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[9px] font-mono text-text-muted">
                    <span>${trade.entryPrice.toFixed(2)} → ${trade.exitPrice.toFixed(2)}</span>
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[7px] tracking-wider uppercase px-1 py-0.5 rounded-sm"
                        style={{
                          color: trade.reason === 'take_profit' ? '#22c55e' : trade.reason === 'stop_loss' ? '#ef4444' : '#00E5FF',
                          background: trade.reason === 'take_profit' ? '#22c55e10' : trade.reason === 'stop_loss' ? '#ef444410' : '#00E5FF10',
                        }}
                      >
                        {reasonLabel}
                      </span>
                      <span>{timeAgo(trade.closedAt)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useMemo } from 'react';
import { usePerformanceHistory, type TradeEntry } from '@/hooks/usePerformanceHistory';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── SVG Cumulative P&L Chart ────────────────────────────────────────────────

function CumulativePnLChart({ trades }: { trades: TradeEntry[] }) {
  const chartData = useMemo(() => {
    // Take last 50 trades for the chart
    const recent = trades.slice(-50);
    if (recent.length < 2) return null;

    // Build cumulative P&L series
    const points: { x: number; y: number }[] = [];
    let cumulative = 0;
    for (let i = 0; i < recent.length; i++) {
      cumulative += recent[i].pnl;
      points.push({ x: i, y: cumulative });
    }

    return points;
  }, [trades]);

  if (!chartData || chartData.length < 2) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="text-[10px] text-text-muted font-mono tracking-wider">
          Need 2+ trades for chart
        </span>
      </div>
    );
  }

  // Calculate chart dimensions
  const width = 400;
  const height = 100;
  const padding = { top: 8, right: 8, bottom: 8, left: 8 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const yValues = chartData.map(p => p.y);
  const minY = Math.min(0, ...yValues);
  const maxY = Math.max(0, ...yValues);
  const rangeY = maxY - minY || 1;

  // Scale points
  const scaleX = (i: number) => padding.left + (i / (chartData.length - 1)) * innerW;
  const scaleY = (v: number) => padding.top + innerH - ((v - minY) / rangeY) * innerH;

  // Build SVG path
  const pathD = chartData
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(p.x).toFixed(1)} ${scaleY(p.y).toFixed(1)}`)
    .join(' ');

  // Build area fill (from line down to zero line)
  const zeroY = scaleY(0);
  const areaD = pathD +
    ` L ${scaleX(chartData[chartData.length - 1].x).toFixed(1)} ${zeroY.toFixed(1)}` +
    ` L ${scaleX(chartData[0].x).toFixed(1)} ${zeroY.toFixed(1)} Z`;

  const finalPnl = chartData[chartData.length - 1].y;
  const isPositive = finalPnl >= 0;
  const lineColor = isPositive ? '#22c55e' : '#ef4444';
  const fillColor = isPositive ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)';

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-full"
      preserveAspectRatio="none"
    >
      {/* Zero line */}
      <line
        x1={padding.left}
        y1={zeroY}
        x2={width - padding.right}
        y2={zeroY}
        stroke="rgba(139, 92, 246, 0.15)"
        strokeWidth="0.5"
        strokeDasharray="4 2"
      />

      {/* Area fill */}
      <path d={areaD} fill={fillColor} />

      {/* Line */}
      <path d={pathD} fill="none" stroke={lineColor} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* End point dot */}
      <circle
        cx={scaleX(chartData[chartData.length - 1].x)}
        cy={scaleY(chartData[chartData.length - 1].y)}
        r="2.5"
        fill={lineColor}
      />
    </svg>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export const PerformanceHistoryPanel = () => {
  const { trades, getOverallStats, clearHistory } = usePerformanceHistory();
  const [collapsed, setCollapsed] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const stats = useMemo(() => getOverallStats(), [getOverallStats]);

  // Last 20 trades for the list (most recent first)
  const recentTrades = useMemo(() => {
    return [...trades].reverse().slice(0, 20);
  }, [trades]);

  const handleClear = () => {
    clearHistory();
    setShowClearConfirm(false);
  };

  return (
    <div className="cursed-card p-5 animate-fade-up h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-2 group"
        >
          <div className="section-title">Performance</div>
          <svg
            className={`w-3 h-3 text-cursed transition-transform ${collapsed ? '-rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-text-muted tracking-wider">
            {stats.totalTrades} TRADES
          </span>
          {trades.length > 0 && (
            <>
              {showClearConfirm ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleClear}
                    className="text-[11px] md:text-[9px] font-mono text-negative hover:text-negative/80 transition-colors uppercase tracking-wider"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setShowClearConfirm(false)}
                    className="text-[11px] md:text-[9px] font-mono text-text-muted hover:text-text-secondary transition-colors uppercase tracking-wider"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowClearConfirm(true)}
                  className="text-[11px] md:text-[9px] font-mono text-text-muted hover:text-negative transition-colors uppercase tracking-wider"
                >
                  Clear
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {!collapsed && (
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {/* Stats row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 flex-shrink-0">
            <div>
              <div className="text-[11px] md:text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">
                Total Trades
              </div>
              <div className="text-lg font-bold font-mono text-text-primary">
                {stats.totalTrades}
              </div>
              <div className="text-[11px] md:text-[9px] font-mono text-text-muted">
                {stats.tradesPerMode.PERPS}P / {stats.tradesPerMode.INVEST}I
              </div>
            </div>
            <div>
              <div className="text-[11px] md:text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">
                Win Rate
              </div>
              <div className={`text-lg font-bold font-mono ${stats.winRate >= 50 ? 'text-positive' : stats.totalTrades > 0 ? 'text-negative' : 'text-text-primary'}`}>
                {stats.winRate.toFixed(1)}%
              </div>
            </div>
            <div>
              <div className="text-[11px] md:text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">
                Total P&L
              </div>
              <div className={`text-lg font-bold font-mono ${stats.totalPnL >= 0 ? 'text-positive' : 'text-negative'}`}>
                {stats.totalPnL >= 0 ? '+' : ''}{stats.totalPnL.toFixed(4)}
              </div>
              <div className="text-[11px] md:text-[9px] font-mono text-text-muted">SOL</div>
            </div>
            <div>
              <div className="text-[11px] md:text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">
                Avg P&L
              </div>
              <div className={`text-lg font-bold font-mono ${stats.avgPnL >= 0 ? 'text-positive' : 'text-negative'}`}>
                {stats.avgPnL >= 0 ? '+' : ''}{stats.avgPnL.toFixed(4)}
              </div>
              <div className="text-[11px] md:text-[9px] font-mono text-text-muted">SOL/trade</div>
            </div>
          </div>

          {/* Best/Worst row */}
          {(stats.bestTrade || stats.worstTrade) && (
            <div className="grid grid-cols-2 gap-3 mb-4 flex-shrink-0">
              {stats.bestTrade && (
                <div className="p-2 bg-bg-inner border border-positive/10">
                  <div className="text-[11px] md:text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">
                    Best Trade
                  </div>
                  <div className="text-[11px] font-mono text-positive font-bold">
                    +{stats.bestTrade.pnl.toFixed(4)} SOL
                  </div>
                  <div className="text-[11px] md:text-[9px] font-mono text-text-muted">
                    {stats.bestTrade.action} {stats.bestTrade.asset}
                  </div>
                </div>
              )}
              {stats.worstTrade && (
                <div className="p-2 bg-bg-inner border border-negative/10">
                  <div className="text-[11px] md:text-[9px] text-text-muted font-mono uppercase tracking-wider mb-1">
                    Worst Trade
                  </div>
                  <div className="text-[11px] font-mono text-negative font-bold">
                    {stats.worstTrade.pnl.toFixed(4)} SOL
                  </div>
                  <div className="text-[11px] md:text-[9px] font-mono text-text-muted">
                    {stats.worstTrade.action} {stats.worstTrade.asset}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Cumulative P&L Chart */}
          <div className="mb-4 flex-shrink-0">
            <div className="text-[11px] md:text-[9px] text-text-muted font-mono uppercase tracking-wider mb-2">
              Cumulative P&L (last 50 trades)
            </div>
            <div className="w-full overflow-x-auto">
              <div className="h-[80px] bg-bg-inner border border-cursed/8 p-1 min-w-0">
                <CumulativePnLChart trades={trades} />
              </div>
            </div>
          </div>

          {/* Recent trades list */}
          <div className="flex-1 overflow-hidden flex flex-col min-h-0">
            <div className="text-[11px] md:text-[9px] text-text-muted font-mono uppercase tracking-wider mb-2 flex-shrink-0">
              Recent Trades ({recentTrades.length})
            </div>
            <div className="flex-1 overflow-y-auto space-y-1 pr-1 min-h-0">
              {recentTrades.length === 0 ? (
                <div className="flex items-center justify-center py-6">
                  <div className="text-[10px] text-text-muted font-mono tracking-wider text-center">
                    No trades recorded yet.
                    <br />
                    Trades appear after the agent executes.
                  </div>
                </div>
              ) : (
                recentTrades.map(trade => (
                  <div
                    key={trade.id}
                    className="p-2.5 bg-bg-inner border border-cursed/8 transition-all hover:border-cursed/20"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] md:text-[9px] font-mono font-bold px-1.5 py-0.5 border ${
                          trade.mode === 'PERPS'
                            ? 'text-shadow-purple border-shadow-purple/20 bg-shadow-purple/5'
                            : 'text-cursed border-cursed/20 bg-cursed/5'
                        } uppercase tracking-wider`}>
                          {trade.mode}
                        </span>
                        <span className="text-[11px] font-mono text-text-primary font-bold">
                          {trade.action}
                        </span>
                        <span className="text-[10px] font-mono text-text-secondary">
                          {trade.asset}
                        </span>
                      </div>
                      <span className={`text-[11px] font-mono font-bold ${trade.pnl >= 0 ? 'text-positive' : 'text-negative'}`}>
                        {trade.pnl >= 0 ? '+' : ''}{trade.pnl.toFixed(4)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[11px] md:text-[9px] text-text-muted font-mono">
                        {formatDate(trade.timestamp)} {formatTime(trade.timestamp)}
                      </span>
                      <span className="text-[11px] md:text-[9px] text-text-muted font-mono">
                        {trade.amount.toFixed(4)} @ {trade.price.toFixed(2)}
                      </span>
                    </div>
                    {trade.reasoning && (
                      <div className="mt-1 text-[11px] md:text-[9px] text-text-muted/60 font-mono truncate">
                        {trade.reasoning}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

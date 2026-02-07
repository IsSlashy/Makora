'use client';

interface PerpPosition {
  id: string;
  market: string;
  side: 'long' | 'short';
  leverage: number;
  collateralUsd: number;
  entryPrice: number;
  currentPrice?: number;
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;
  openedAt: number;
}

interface PositionsPanelTWAProps {
  positions: PerpPosition[];
  loading?: boolean;
}

export const PositionsPanelTWA = ({ positions, loading }: PositionsPanelTWAProps) => {
  if (loading) {
    return (
      <div className="cursed-card p-4">
        <div className="section-title mb-3">PERP POSITIONS</div>
        <div className="text-text-muted text-xs font-mono animate-pulse">Loading positions...</div>
      </div>
    );
  }

  if (positions.length === 0) {
    return (
      <div className="cursed-card p-4">
        <div className="section-title mb-3">PERP POSITIONS</div>
        <div className="text-text-muted text-xs font-mono">No open positions</div>
      </div>
    );
  }

  return (
    <div className="cursed-card p-4">
      <div className="section-title mb-3">PERP POSITIONS ({positions.length})</div>

      <div className="space-y-3">
        {positions.map(pos => {
          const pnlPct = pos.unrealizedPnlPct ?? 0;
          const pnlUsd = pos.unrealizedPnl ?? 0;
          const isProfit = pnlPct >= 0;
          const pnlColor = isProfit ? '#22c55e' : '#ef4444';
          const hoursOpen = ((Date.now() - pos.openedAt) / (1000 * 60 * 60)).toFixed(1);

          return (
            <div key={pos.id} className="bg-bg-inner p-3 rounded-sm border border-cursed/10">
              {/* Header: market + side + leverage */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span
                    className="text-[10px] font-mono font-bold tracking-wider uppercase px-1.5 py-0.5 rounded-sm"
                    style={{
                      color: pos.side === 'long' ? '#22c55e' : '#ef4444',
                      background: pos.side === 'long' ? '#22c55e15' : '#ef444415',
                      border: `1px solid ${pos.side === 'long' ? '#22c55e30' : '#ef444430'}`,
                    }}
                  >
                    {pos.side}
                  </span>
                  <span className="text-sm font-mono font-bold" style={{ color: '#f0ede5' }}>
                    {pos.market}
                  </span>
                  <span className="text-[10px] font-mono text-text-muted">{pos.leverage}x</span>
                </div>
                <span className="text-[10px] font-mono text-text-muted">{hoursOpen}h</span>
              </div>

              {/* Prices + P&L */}
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono text-text-muted">
                  Entry: ${pos.entryPrice.toFixed(2)}
                  {pos.currentPrice !== undefined && (
                    <span> | Now: ${pos.currentPrice.toFixed(2)}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-bold" style={{ color: pnlColor }}>
                    {isProfit ? '+' : ''}{pnlPct.toFixed(2)}%
                  </span>
                  <span className="text-[10px] font-mono" style={{ color: pnlColor }}>
                    ({isProfit ? '+' : ''}${pnlUsd.toFixed(2)})
                  </span>
                </div>
              </div>

              {/* Collateral */}
              <div className="mt-1 text-[10px] font-mono text-text-muted">
                Collateral: ${pos.collateralUsd.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

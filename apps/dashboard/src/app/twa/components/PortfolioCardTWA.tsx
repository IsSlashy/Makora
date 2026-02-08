'use client';

interface PositionEntry {
  symbol: string;
  mint: string;
  balance: number;
  uiAmount: number;
  decimals: number;
}

interface PortfolioCardTWAProps {
  solBalance: number | null;
  positions: PositionEntry[];
  allocation: Array<{ symbol: string; pct: number }>;
  totalValueSol: number;
  loading?: boolean;
}

export const PortfolioCardTWA = ({
  solBalance,
  positions,
  allocation,
  totalValueSol,
  loading,
}: PortfolioCardTWAProps) => {
  if (loading) {
    return (
      <div className="cursed-card p-4">
        <div className="section-title mb-3">PORTFOLIO</div>
        <div className="text-text-muted text-xs font-mono animate-pulse">Loading portfolio...</div>
      </div>
    );
  }

  return (
    <div className="cursed-card p-4">
      <div className="section-title mb-3">PORTFOLIO</div>

      {/* Total value */}
      <div className="flex items-baseline gap-2 mb-4">
        <span className="text-2xl font-bold font-mono text-cursed-gradient" style={{
          background: 'linear-gradient(135deg, #00B4D8 0%, #00E5FF 40%, #67EFFF 60%, #00E5FF 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          {totalValueSol.toFixed(4)}
        </span>
        <span className="text-text-muted text-xs font-mono">SOL</span>
      </div>

      {/* Token balances */}
      <div className="space-y-2">
        {positions.map(pos => {
          const alloc = allocation.find(a => a.symbol === pos.symbol);
          const pct = alloc?.pct ?? 0;

          return (
            <div key={pos.mint} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold" style={{ color: '#f0edf5' }}>{pos.symbol}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-text-muted">
                  {pos.uiAmount < 1 ? pos.uiAmount.toFixed(6) : pos.uiAmount.toFixed(4)}
                </span>
                {pct > 0 && (
                  <div className="flex items-center gap-1.5">
                    <div className="w-12 h-1.5 bg-bg-inner rounded-sm overflow-hidden">
                      <div
                        className="h-full rounded-sm"
                        style={{
                          width: `${Math.min(100, pct)}%`,
                          background: '#00E5FF',
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-text-muted w-8 text-right">{pct}%</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {positions.length === 0 && (
        <div className="text-text-muted text-xs font-mono">No token balances found</div>
      )}
    </div>
  );
};

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
  vaultBalanceSol?: number;
}

export const PortfolioCardTWA = ({
  solBalance,
  positions,
  allocation,
  totalValueSol,
  loading,
  vaultBalanceSol = 0,
}: PortfolioCardTWAProps) => {
  // Subtract vault balance from available SOL
  const availableSol = Math.max(0, totalValueSol - vaultBalanceSol);
  const adjustedPositions = positions.map(p => {
    if (p.symbol === 'SOL') {
      const adjustedAmount = Math.max(0, p.uiAmount - vaultBalanceSol);
      return { ...p, uiAmount: adjustedAmount };
    }
    return p;
  });
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

      {/* Available balance (excludes vault) */}
      <div className="flex items-baseline gap-2 mb-1">
        <span className="text-2xl font-bold font-mono text-cursed-gradient" style={{
          background: 'linear-gradient(135deg, #00B4D8 0%, #00E5FF 40%, #67EFFF 60%, #00E5FF 100%)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          backgroundClip: 'text',
        }}>
          {availableSol.toFixed(4)}
        </span>
        <span className="text-text-muted text-xs font-mono">SOL available</span>
      </div>
      {vaultBalanceSol > 0 && (
        <div className="text-[10px] font-mono text-text-muted mb-4">
          + {vaultBalanceSol.toFixed(4)} SOL in ZK vault = {totalValueSol.toFixed(4)} SOL total
        </div>
      )}
      {vaultBalanceSol === 0 && <div className="mb-3" />}

      {/* Token balances */}
      <div className="space-y-2">
        {adjustedPositions.map(pos => {
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

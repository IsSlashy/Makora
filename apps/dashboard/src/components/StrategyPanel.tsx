'use client';

interface YieldOpportunity {
  protocol: string;
  apy: number;
  tvl: string;
  risk: 'Low' | 'Medium' | 'High';
}

export const StrategyPanel = () => {
  const opportunities: YieldOpportunity[] = [
    { protocol: 'Marinade', apy: 7.2, tvl: '$1.2B', risk: 'Low' },
    { protocol: 'Jupiter Perps', apy: 12.4, tvl: '$450M', risk: 'Medium' },
    { protocol: 'Kamino', apy: 8.9, tvl: '$890M', risk: 'Low' },
    { protocol: 'Raydium', apy: 15.6, tvl: '$320M', risk: 'Medium' },
  ];

  const getRiskStyle = (risk: string) => {
    switch (risk) {
      case 'Low': return 'text-positive';
      case 'Medium': return 'text-caution';
      case 'High': return 'text-negative';
      default: return 'text-text-muted';
    }
  };

  return (
    <div className="cursed-card p-5 animate-fade-up">
      <div className="flex items-center justify-between mb-5">
        <div className="section-title">Strategy</div>
        <div className="text-[10px] font-mono tracking-wider text-cursed bg-cursed/10 px-2 py-0.5 border border-cursed/20">
          YIELD OPT
        </div>
      </div>

      {/* Rebalance */}
      <div className="mb-5 p-3 bg-bg-inner border border-cursed/8">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] text-text-muted font-mono tracking-wider uppercase">Target Alloc</span>
          <span className="text-[10px] text-cursed font-mono">Rebalancing</span>
        </div>
        <div className="space-y-1.5 text-[11px] font-mono">
          <div className="flex justify-between">
            <span className="text-text-secondary">SOL + mSOL</span>
            <span className="text-text-muted">45% <span className="text-cursed">&#8594;</span> 55%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-secondary">Stables</span>
            <span className="text-text-muted">25% <span className="text-cursed">&#8594;</span> 20%</span>
          </div>
        </div>
      </div>

      {/* Yield opportunities */}
      <div className="text-[10px] text-text-muted font-mono tracking-wider uppercase mb-3">
        Yield Sources
      </div>
      <div className="space-y-2">
        {opportunities.map((opp, idx) => (
          <div
            key={idx}
            className="p-2.5 bg-bg-inner border border-transparent hover:border-cursed/15 transition-colors cursor-pointer group"
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-mono font-bold text-text-primary group-hover:text-cursed transition-colors">
                {opp.protocol}
              </span>
              <span className="text-xs font-mono font-bold text-cursed">{opp.apy}%</span>
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono">
              <span className="text-text-muted">TVL {opp.tvl}</span>
              <span className={getRiskStyle(opp.risk)}>{opp.risk}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <button className="flex-1 px-3 py-2 text-[10px] font-mono tracking-wider uppercase bg-cursed/15 border border-cursed/30 text-cursed hover:bg-cursed/25 transition-colors">
          Execute All
        </button>
        <button className="px-3 py-2 text-[10px] font-mono tracking-wider uppercase border border-cursed/15 text-text-muted hover:text-cursed hover:border-cursed/30 transition-colors">
          Review
        </button>
      </div>
    </div>
  );
};

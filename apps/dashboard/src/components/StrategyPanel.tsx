'use client';

interface YieldOpportunity {
  protocol: string;
  apy: number;
  tvl: string;
  risk: 'Low' | 'Medium' | 'High';
}

export const StrategyPanel = () => {
  const opportunities: YieldOpportunity[] = [
    { protocol: 'Marinade Finance', apy: 7.2, tvl: '$1.2B', risk: 'Low' },
    { protocol: 'Jupiter Perps', apy: 12.4, tvl: '$450M', risk: 'Medium' },
    { protocol: 'Solend', apy: 8.9, tvl: '$890M', risk: 'Low' },
    { protocol: 'Drift Protocol', apy: 15.6, tvl: '$320M', risk: 'Medium' },
  ];

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case 'Low': return 'text-green-500';
      case 'Medium': return 'text-yellow-500';
      case 'High': return 'text-red-500';
      default: return 'text-gray-500';
    }
  };

  return (
    <div className="glass-card p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-text-primary">Active Strategy</h2>
        <div className="px-3 py-1 rounded-full bg-accent/20 text-accent text-sm font-medium">
          Yield Optimizer
        </div>
      </div>

      <div className="mb-6 p-4 rounded-lg bg-bg-secondary border border-accent/20">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm text-text-secondary">Target Allocation</span>
          <span className="text-sm text-accent">Rebalancing in progress</span>
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-primary">SOL → mSOL</span>
            <span className="text-text-secondary">45% → 55%</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-primary">Stablecoins</span>
            <span className="text-text-secondary">25% → 20%</span>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-text-primary mb-4">
          Top Yield Opportunities
        </h3>
        <div className="space-y-3">
          {opportunities.map((opp, idx) => (
            <div
              key={idx}
              className="p-3 rounded-lg bg-bg-secondary hover:bg-bg-secondary/80 transition-colors cursor-pointer border border-transparent hover:border-accent/30"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-text-primary">{opp.protocol}</span>
                <span className="text-accent font-bold">{opp.apy}% APY</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-text-secondary">TVL: {opp.tvl}</span>
                <span className={`font-medium ${getRiskColor(opp.risk)}`}>
                  {opp.risk} Risk
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 flex gap-3">
        <button className="flex-1 px-4 py-2 rounded-lg bg-accent hover:bg-accent-light transition-colors text-white font-medium">
          Approve All
        </button>
        <button className="px-4 py-2 rounded-lg border border-accent/30 hover:bg-accent/10 transition-colors text-accent font-medium">
          Review
        </button>
      </div>
    </div>
  );
};

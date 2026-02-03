'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useStrategy } from '@/hooks/useStrategy';
import { useActivityFeed } from '@/hooks/useActivityFeed';

const STRATEGY_LABELS: Record<string, string> = {
  yield: 'YIELD OPT',
  trading: 'TRADING',
  rebalance: 'REBALANCE',
  liquidity: 'LIQUIDITY',
};

interface YieldOpportunity {
  protocol: string;
  apy: number;
  tvl: string;
  risk: 'Low' | 'Medium' | 'High';
}

// Static yield sources (these protocols are mainnet-only, shown for reference)
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

function bytesToString(bytes: number[]): string {
  const end = bytes.indexOf(0);
  const slice = end === -1 ? bytes : bytes.slice(0, end);
  return String.fromCharCode(...slice);
}

export const StrategyPanel = () => {
  const { publicKey } = useWallet();
  const { strategyState, strategyTypeString, totalCycles, totalActions, loading, initializeStrategy } = useStrategy();
  const { addActivity } = useActivityFeed();

  const strategyLabel = STRATEGY_LABELS[strategyTypeString.toLowerCase()] || strategyTypeString;

  // Parse allocation from on-chain state
  const allocations: { symbol: string; pct: number }[] = [];
  if (strategyState) {
    for (let i = 0; i < strategyState.allocationCount; i++) {
      const target = strategyState.targetAllocation[i];
      if (target && target.targetPct > 0) {
        allocations.push({
          symbol: bytesToString(target.symbol),
          pct: target.targetPct,
        });
      }
    }
  }

  const handleInitStrategy = async () => {
    try {
      const tx = await initializeStrategy();
      addActivity({ action: 'Strategy account initialized on-chain', status: 'success', txSig: tx });
    } catch (e: any) {
      addActivity({ action: `Strategy init failed: ${e.message?.slice(0, 50)}`, status: 'error' });
    }
  };

  return (
    <div className="cursed-card p-5 animate-fade-up">
      <div className="flex items-center justify-between mb-5">
        <div className="section-title">Strategy</div>
        <div className="text-[10px] font-mono tracking-wider text-cursed bg-cursed/10 px-2 py-0.5 border border-cursed/20">
          {strategyState ? strategyLabel : 'N/A'}
        </div>
      </div>

      {!publicKey ? (
        <div className="text-[10px] text-text-muted font-mono text-center py-6 tracking-wider">
          Connect wallet to view strategy
        </div>
      ) : !strategyState ? (
        <div className="space-y-4">
          <div className="text-[10px] text-text-muted font-mono text-center py-4 tracking-wider">
            No strategy account — initialize to track OODA on-chain
          </div>
          <button
            onClick={handleInitStrategy}
            disabled={loading}
            className="w-full px-3 py-2 text-[10px] font-mono tracking-[0.15em] uppercase bg-cursed/10 border border-cursed/30 text-cursed hover:bg-cursed/20 transition-colors font-bold disabled:opacity-50"
          >
            {loading ? 'INITIALIZING...' : 'INITIALIZE STRATEGY'}
          </button>
        </div>
      ) : (
        <>
          {/* On-chain allocation */}
          <div className="mb-5 p-3 bg-bg-inner border border-cursed/8">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] text-text-muted font-mono tracking-wider uppercase">
                Target Alloc (on-chain)
              </span>
              <span className="text-[10px] text-cursed font-mono">
                {totalCycles} cycles
              </span>
            </div>
            <div className="space-y-1.5 text-[11px] font-mono">
              {allocations.map((a, i) => (
                <div key={i} className="flex justify-between">
                  <span className="text-text-secondary">{a.symbol}</span>
                  <span className="text-cursed">{a.pct}%</span>
                </div>
              ))}
              {allocations.length === 0 && (
                <div className="text-text-muted text-[10px]">No allocation set</div>
              )}
            </div>
            <div className="mt-2 pt-2 border-t border-cursed/8 flex justify-between text-[10px] font-mono">
              <span className="text-text-muted">Actions executed</span>
              <span className="text-text-primary">{totalActions}</span>
            </div>
          </div>

          {/* Yield opportunities (reference — mainnet only) */}
          <div className="text-[10px] text-text-muted font-mono tracking-wider uppercase mb-3">
            Yield Sources (mainnet ref)
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
        </>
      )}
    </div>
  );
};

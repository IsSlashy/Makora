'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { useStrategy } from '@/hooks/useStrategy';
import { useActivityFeed } from '@/hooks/useActivityFeed';
import type { OODAState, AllocationSlot } from '@/hooks/useOODALoop';
import { getStrategyLabel } from '@/hooks/useOODALoop';
import type { YieldOpportunity } from '@/hooks/useYieldData';

const STRATEGY_LABELS: Record<string, string> = {
  yield: 'YIELD OPT',
  trading: 'TRADING',
  rebalance: 'REBALANCE',
  liquidity: 'LIQUIDITY',
};

const TAG_LABELS: Record<string, string> = {
  stake: 'Liquid Stake',
  lend: 'Lending',
  lp: 'LP',
  loop: 'Leverage Loop',
  'perps-lp': 'Perps LP',
};

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

interface StrategyPanelProps {
  oodaState?: OODAState & { adaptations: number };
  yields?: YieldOpportunity[];
  yieldLoading?: boolean;
  yieldLastUpdated?: Date | null;
  yieldError?: string | null;
}

export const StrategyPanel = ({
  oodaState,
  yields,
  yieldLoading: yieldLoadingProp,
  yieldLastUpdated: lastUpdatedProp,
  yieldError: yieldErrorProp,
}: StrategyPanelProps) => {
  const { publicKey } = useWallet();
  const { strategyState, strategyTypeString, totalCycles, totalActions, loading, initializeStrategy } = useStrategy();
  const { addActivity } = useActivityFeed();

  // Use props if provided, otherwise show empty state
  const opportunities = yields ?? [];
  const yieldLoading = yieldLoadingProp ?? false;
  const lastUpdated = lastUpdatedProp ?? null;
  const yieldError = yieldErrorProp ?? null;

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

  // Get allocation from OODA decision
  const allocation: AllocationSlot[] = oodaState?.lastDecision?.allocation ?? [];
  const blendedApy = oodaState?.lastDecision?.blendedApy ?? 0;
  const confidence = oodaState?.confidence ?? 0;
  const stratLabel = confidence > 0 ? getStrategyLabel(confidence) : null;

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

          {/* Recommended Allocation from OODA DECIDE phase */}
          {allocation.length > 0 && (
            <div className="mb-5 p-3 bg-bg-inner border border-cursed/15">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] text-text-muted font-mono tracking-wider uppercase">
                  Recommended Allocation
                </span>
                {stratLabel && (
                  <span className="text-[9px] font-mono tracking-wider px-1.5 py-0.5 border border-cursed/30 text-cursed bg-cursed/5 uppercase">
                    {stratLabel}
                  </span>
                )}
              </div>
              <div className="space-y-2">
                {allocation.map((slot, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[11px] font-mono">
                    <div className="flex items-center gap-2">
                      <span className="text-text-primary font-bold">{slot.symbol}</span>
                      <span className="text-[9px] text-text-muted">{TAG_LABELS[slot.strategyTag] || slot.strategyTag}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`text-[9px] ${getRiskStyle(slot.risk)}`}>{slot.risk}</span>
                      <span className="text-text-secondary w-8 text-right">{slot.pct}%</span>
                      <span className="text-cursed w-12 text-right">{slot.expectedApy}%</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-2 pt-2 border-t border-cursed/12 flex justify-between text-[10px] font-mono">
                <span className="text-text-muted">Blended APY</span>
                <span className="text-cursed font-bold">{blendedApy}%</span>
              </div>
            </div>
          )}

          {/* Live yield opportunities from DeFi protocols */}
          <div className="flex items-center justify-between mb-3">
            <div className="text-[10px] text-text-muted font-mono tracking-wider uppercase">
              Yield Sources {yieldLoading ? '(loading...)' : '(live)'}
            </div>
            {lastUpdated && (
              <div className="text-[9px] text-text-muted font-mono">
                {lastUpdated.toLocaleTimeString()}
              </div>
            )}
          </div>
          {yieldError && (
            <div className="text-[9px] text-caution font-mono mb-2">{yieldError}</div>
          )}
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
                  <span className="text-text-muted">
                    {opp.symbol} | TVL {opp.tvl}
                  </span>
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

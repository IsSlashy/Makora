/**
 * Allocation Diff Engine
 *
 * Pure function that compares current portfolio allocation against a target
 * and determines which trades are needed to reach the target.
 */

export interface CurrentPosition {
  symbol: string;
  pct: number;
}

export interface TargetSlot {
  symbol: string;
  pct: number;
  protocol?: string;
  strategyTag?: string;
}

export interface DiffAction {
  symbol: string;
  direction: 'increase' | 'decrease';
  currentPct: number;
  targetPct: number;
  deltaPct: number;
  protocol?: string;
  strategyTag?: string;
}

export interface AllocationDiff {
  needsRebalance: boolean;
  maxDrift: number;
  actions: DiffAction[];
}

/**
 * Compare current allocation against target and return needed trades.
 *
 * @param current - Current portfolio allocation (symbol + pct)
 * @param target - Target allocation slots (symbol + pct)
 * @param driftThreshold - Minimum pct drift to trigger rebalance (default 3%)
 */
export function computeAllocationDiff(
  current: CurrentPosition[],
  target: TargetSlot[],
  driftThreshold: number = 3,
): AllocationDiff {
  const currentMap = new Map<string, number>();
  for (const pos of current) {
    const key = pos.symbol.toUpperCase();
    currentMap.set(key, (currentMap.get(key) ?? 0) + pos.pct);
  }

  const actions: DiffAction[] = [];
  let maxDrift = 0;

  for (const slot of target) {
    const key = slot.symbol.toUpperCase();
    const currentPct = currentMap.get(key) ?? 0;
    const deltaPct = slot.pct - currentPct;
    const absDelta = Math.abs(deltaPct);

    if (absDelta > maxDrift) maxDrift = absDelta;

    if (absDelta >= driftThreshold) {
      actions.push({
        symbol: slot.symbol,
        direction: deltaPct > 0 ? 'increase' : 'decrease',
        currentPct,
        targetPct: slot.pct,
        deltaPct: absDelta,
        protocol: slot.protocol,
        strategyTag: slot.strategyTag,
      });
    }
  }

  // Also check for tokens in current but not in target (should decrease to 0)
  for (const [symbol, pct] of currentMap) {
    const inTarget = target.some(t => t.symbol.toUpperCase() === symbol);
    if (!inTarget && pct >= driftThreshold) {
      if (pct > maxDrift) maxDrift = pct;
      actions.push({
        symbol,
        direction: 'decrease',
        currentPct: pct,
        targetPct: 0,
        deltaPct: pct,
      });
    }
  }

  // Sort by largest drift first (most impactful trades first)
  actions.sort((a, b) => b.deltaPct - a.deltaPct);

  return {
    needsRebalance: actions.length > 0,
    maxDrift,
    actions,
  };
}

/**
 * Format an allocation diff for display or LLM context.
 */
export function formatAllocationDiff(diff: AllocationDiff): string {
  if (!diff.needsRebalance) {
    return `Portfolio is within target (max drift: ${diff.maxDrift.toFixed(1)}%)`;
  }

  const lines = diff.actions.map(a =>
    `${a.direction === 'increase' ? '+' : '-'} ${a.symbol}: ${a.currentPct.toFixed(1)}% -> ${a.targetPct.toFixed(1)}% (${a.deltaPct.toFixed(1)}% drift)`,
  );

  return `Rebalance needed (max drift ${diff.maxDrift.toFixed(1)}%):\n${lines.join('\n')}`;
}

import { describe, it, expect } from 'vitest';
import { computeAllocationDiff, formatAllocationDiff } from '../allocation-diff';

describe('computeAllocationDiff', () => {
  it('detects no rebalance needed when within threshold', () => {
    const current = [
      { symbol: 'SOL', pct: 36 },
      { symbol: 'USDC', pct: 24 },
      { symbol: 'mSOL', pct: 25 },
      { symbol: 'JLP', pct: 15 },
    ];
    const target = [
      { symbol: 'SOL', pct: 35 },
      { symbol: 'USDC', pct: 25 },
      { symbol: 'mSOL', pct: 25 },
      { symbol: 'JLP', pct: 15 },
    ];

    const diff = computeAllocationDiff(current, target, 3);
    expect(diff.needsRebalance).toBe(false);
    expect(diff.actions).toHaveLength(0);
  });

  it('detects rebalance needed for large drift', () => {
    const current = [
      { symbol: 'SOL', pct: 60 },
      { symbol: 'USDC', pct: 10 },
    ];
    const target = [
      { symbol: 'SOL', pct: 35 },
      { symbol: 'USDC', pct: 25 },
      { symbol: 'mSOL', pct: 25 },
      { symbol: 'JLP', pct: 15 },
    ];

    const diff = computeAllocationDiff(current, target, 3);
    expect(diff.needsRebalance).toBe(true);
    expect(diff.actions.length).toBeGreaterThan(0);
  });

  it('includes decrease action for tokens not in target', () => {
    const current = [
      { symbol: 'SOL', pct: 50 },
      { symbol: 'BONK', pct: 20 },
    ];
    const target = [
      { symbol: 'SOL', pct: 50 },
      { symbol: 'USDC', pct: 30 },
    ];

    const diff = computeAllocationDiff(current, target, 3);
    const bonkAction = diff.actions.find(a => a.symbol === 'BONK');
    expect(bonkAction).toBeDefined();
    expect(bonkAction!.direction).toBe('decrease');
    expect(bonkAction!.targetPct).toBe(0);
  });

  it('sorts actions by largest drift first', () => {
    const current = [
      { symbol: 'SOL', pct: 80 },
    ];
    const target = [
      { symbol: 'SOL', pct: 35 },
      { symbol: 'USDC', pct: 25 },
      { symbol: 'mSOL', pct: 25 },
      { symbol: 'JLP', pct: 15 },
    ];

    const diff = computeAllocationDiff(current, target, 3);
    // Actions should be sorted by deltaPct descending
    for (let i = 1; i < diff.actions.length; i++) {
      expect(diff.actions[i - 1].deltaPct).toBeGreaterThanOrEqual(diff.actions[i].deltaPct);
    }
  });

  it('handles empty current portfolio', () => {
    const current: Array<{ symbol: string; pct: number }> = [];
    const target = [
      { symbol: 'SOL', pct: 50 },
      { symbol: 'USDC', pct: 50 },
    ];

    const diff = computeAllocationDiff(current, target, 3);
    expect(diff.needsRebalance).toBe(true);
    expect(diff.actions).toHaveLength(2);
    expect(diff.actions[0].direction).toBe('increase');
  });

  it('respects custom drift threshold', () => {
    const current = [{ symbol: 'SOL', pct: 48 }];
    const target = [{ symbol: 'SOL', pct: 50 }];

    // 2% drift, default threshold 3 → no rebalance
    expect(computeAllocationDiff(current, target, 3).needsRebalance).toBe(false);
    // 2% drift, threshold 1 → rebalance
    expect(computeAllocationDiff(current, target, 1).needsRebalance).toBe(true);
  });

  it('is case-insensitive for symbol matching', () => {
    const current = [{ symbol: 'sol', pct: 50 }];
    const target = [{ symbol: 'SOL', pct: 50 }];

    const diff = computeAllocationDiff(current, target, 3);
    expect(diff.needsRebalance).toBe(false);
  });
});

describe('formatAllocationDiff', () => {
  it('formats no-rebalance message', () => {
    const diff = { needsRebalance: false, maxDrift: 1.5, actions: [] };
    const result = formatAllocationDiff(diff);
    expect(result).toContain('within target');
    expect(result).toContain('1.5');
  });

  it('formats rebalance message with actions', () => {
    const diff = {
      needsRebalance: true,
      maxDrift: 25,
      actions: [
        { symbol: 'SOL', direction: 'decrease' as const, currentPct: 60, targetPct: 35, deltaPct: 25 },
        { symbol: 'mSOL', direction: 'increase' as const, currentPct: 0, targetPct: 25, deltaPct: 25 },
      ],
    };
    const result = formatAllocationDiff(diff);
    expect(result).toContain('Rebalance needed');
    expect(result).toContain('SOL');
    expect(result).toContain('mSOL');
  });
});

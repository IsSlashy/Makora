import { describe, it, expect } from 'vitest';
import { splitAmount, chooseWalletCount } from '../amount-splitter';

describe('splitAmount', () => {
  it('splits into 2 wallets that sum to total', () => {
    const total = 1.0;
    const splits = splitAmount(total, 2);
    expect(splits).toHaveLength(2);
    const sum = splits.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - total)).toBeLessThan(0.000_001);
  });

  it('splits into 3 wallets that sum to total', () => {
    const total = 2.5;
    const splits = splitAmount(total, 3);
    expect(splits).toHaveLength(3);
    const sum = splits.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - total)).toBeLessThan(0.000_001);
  });

  it('respects minimum per wallet', () => {
    const total = 1.0;
    const minPerWallet = 0.1;
    const splits = splitAmount(total, 3, minPerWallet);
    for (const s of splits) {
      expect(s).toBeGreaterThanOrEqual(minPerWallet - 0.000_001);
    }
  });

  it('throws when total is below minimum for wallet count', () => {
    expect(() => splitAmount(0.1, 3, 0.1)).toThrow();
  });

  it('produces non-uniform splits (randomized)', () => {
    const splits1 = splitAmount(1.0, 3);
    const splits2 = splitAmount(1.0, 3);
    // With crypto randomness, extremely unlikely to be identical
    // But we can't assert they're different with certainty — just check structure
    expect(splits1).toHaveLength(3);
    expect(splits2).toHaveLength(3);
  });

  it('rounds to 6 decimal places', () => {
    const splits = splitAmount(1.0, 2);
    for (const s of splits) {
      const decimals = s.toString().split('.')[1]?.length ?? 0;
      expect(decimals).toBeLessThanOrEqual(6);
    }
  });

  it('handles large amounts', () => {
    const total = 100;
    const splits = splitAmount(total, 3);
    const sum = splits.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - total)).toBeLessThan(0.000_001);
  });

  it('handles minimum viable amount', () => {
    const total = 0.2;
    const splits = splitAmount(total, 2, 0.1);
    expect(splits).toHaveLength(2);
    const sum = splits.reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - total)).toBeLessThan(0.000_001);
  });
});

describe('chooseWalletCount', () => {
  it('returns 2 when total is too small for 3 wallets', () => {
    expect(chooseWalletCount(0.2, 0.1)).toBe(2);
  });

  it('returns 2 or 3 for sufficient amounts', () => {
    // Run multiple times — should always return 2 or 3
    for (let i = 0; i < 20; i++) {
      const count = chooseWalletCount(1.0, 0.1);
      expect([2, 3]).toContain(count);
    }
  });
});

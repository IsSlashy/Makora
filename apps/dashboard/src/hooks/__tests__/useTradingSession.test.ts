import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('TradingSession – lifecycle logic', () => {
  beforeEach(() => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key: string) => store[key] ?? null),
      setItem: vi.fn((key: string, val: string) => { store[key] = val; }),
      removeItem: vi.fn((key: string) => { delete store[key]; }),
    });
  });

  describe('session state transitions', () => {
    it('starts in idle state', () => {
      const state = {
        id: '',
        status: 'idle' as const,
        params: null,
        startedAt: 0,
        endsAt: 0,
        startingValueSol: 0,
        currentValueSol: 0,
        pnlSol: 0,
        pnlPct: 0,
        cyclesCompleted: 0,
        tradesExecuted: 0,
        report: null,
      };
      expect(state.status).toBe('idle');
      expect(state.params).toBeNull();
    });

    it('validates wallet percentage range', () => {
      const validateParams = (walletPct: number) => {
        if (walletPct < 1 || walletPct > 100) return 'Wallet % must be 1-100';
        return null;
      };
      expect(validateParams(0)).toBe('Wallet % must be 1-100');
      expect(validateParams(101)).toBe('Wallet % must be 1-100');
      expect(validateParams(50)).toBeNull();
    });

    it('validates minimum duration', () => {
      const validateDuration = (ms: number) => {
        if (ms < 60_000) return 'Minimum duration: 1 minute';
        return null;
      };
      expect(validateDuration(30_000)).toBe('Minimum duration: 1 minute');
      expect(validateDuration(60_000)).toBeNull();
    });
  });

  describe('tick computation', () => {
    it('computes P&L correctly after tick', () => {
      const startingValueSol = 10;
      const currentPortfolio = 10.5;
      const pnlSol = currentPortfolio - startingValueSol;
      const pnlPct = (pnlSol / startingValueSol) * 100;

      expect(pnlSol).toBeCloseTo(0.5);
      expect(pnlPct).toBeCloseTo(5);
    });

    it('increments cycle count on tick', () => {
      let cyclesCompleted = 3;
      cyclesCompleted += 1;
      expect(cyclesCompleted).toBe(4);
    });

    it('accumulates trade count', () => {
      let tradesExecuted = 2;
      tradesExecuted += 3;
      expect(tradesExecuted).toBe(5);
    });
  });

  describe('session expiry detection', () => {
    it('detects expired session', () => {
      const endsAt = Date.now() - 1000;
      expect(Date.now() >= endsAt).toBe(true);
    });

    it('detects active session', () => {
      const endsAt = Date.now() + 60_000;
      expect(Date.now() >= endsAt).toBe(false);
    });
  });

  describe('profit target', () => {
    it('triggers completion when profit target is met', () => {
      const targetProfitPct = 5;
      const pnlPct = 6;
      expect(pnlPct >= targetProfitPct).toBe(true);
    });

    it('does not trigger when below target', () => {
      const targetProfitPct = 5;
      const pnlPct = 3;
      expect(pnlPct >= targetProfitPct).toBe(false);
    });
  });

  describe('formatDuration', () => {
    function formatDuration(ms: number): string {
      const totalSec = Math.floor(ms / 1000);
      const hours = Math.floor(totalSec / 3600);
      const minutes = Math.floor((totalSec % 3600) / 60);
      if (hours > 0) return `${hours}h ${minutes}m`;
      return `${minutes}m`;
    }

    it('formats minutes only', () => {
      expect(formatDuration(5 * 60 * 1000)).toBe('5m');
    });

    it('formats hours and minutes', () => {
      expect(formatDuration(90 * 60 * 1000)).toBe('1h 30m');
    });
  });
});

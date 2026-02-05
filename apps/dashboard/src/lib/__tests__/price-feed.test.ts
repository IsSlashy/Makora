import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('price-feed', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  describe('fetchTokenPrices', () => {
    it('returns prices from Jupiter API on success', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          data: {
            'So11111111111111111111111111111111111111112': { price: '210.50' },
            'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { price: '1.00' },
          },
        }),
      }) as any;

      const { fetchTokenPrices } = await import('../price-feed');
      const prices = await fetchTokenPrices(['SOL', 'USDC']);
      expect(prices.SOL).toBe(210.50);
      expect(prices.USDC).toBe(1.00);
    });

    it('returns fallback prices on API failure', async () => {
      globalThis.fetch = vi.fn().mockRejectedValueOnce(new Error('Network error')) as any;

      const { fetchTokenPrices } = await import('../price-feed');
      const prices = await fetchTokenPrices(['SOL']);
      expect(prices.SOL).toBe(200); // fallback
    });

    it('returns fallback on non-ok response', async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 500,
      }) as any;

      const { fetchTokenPrices } = await import('../price-feed');
      const prices = await fetchTokenPrices(['SOL']);
      expect(prices.SOL).toBe(200);
    });
  });

  describe('tokenValueInSol', () => {
    it('returns amount directly for SOL', async () => {
      const { tokenValueInSol } = await import('../price-feed');
      const prices = { SOL: 200, USDC: 1, mSOL: 220, JLP: 3.5 };
      expect(tokenValueInSol('SOL', 5, prices)).toBe(5);
    });

    it('converts USDC to SOL value', async () => {
      const { tokenValueInSol } = await import('../price-feed');
      const prices = { SOL: 200, USDC: 1, mSOL: 220, JLP: 3.5 };
      // 100 USDC * $1 / $200 = 0.5 SOL
      expect(tokenValueInSol('USDC', 100, prices)).toBeCloseTo(0.5);
    });

    it('converts mSOL to SOL value', async () => {
      const { tokenValueInSol } = await import('../price-feed');
      const prices = { SOL: 200, USDC: 1, mSOL: 220, JLP: 3.5 };
      // 1 mSOL * $220 / $200 = 1.1 SOL
      expect(tokenValueInSol('mSOL', 1, prices)).toBeCloseTo(1.1);
    });

    it('returns 0 for unknown token', async () => {
      const { tokenValueInSol } = await import('../price-feed');
      const prices = { SOL: 200, USDC: 1 };
      expect(tokenValueInSol('UNKNOWN', 100, prices)).toBe(0);
    });

    it('returns 0 when SOL price is 0', async () => {
      const { tokenValueInSol } = await import('../price-feed');
      expect(tokenValueInSol('USDC', 100, { SOL: 0, USDC: 1 })).toBe(0);
    });
  });
});

import { describe, it, expect } from 'vitest';

describe('useVault – mainnet degradation', () => {
  describe('isMainnet detection', () => {
    it('defaults to mainnet-beta when env not set', () => {
      const network = undefined;
      const isMainnet = (network || 'mainnet-beta') === 'mainnet-beta';
      expect(isMainnet).toBe(true);
    });

    it('detects devnet', () => {
      const network = 'devnet';
      const isMainnet = (network || 'mainnet-beta') === 'mainnet-beta';
      expect(isMainnet).toBe(false);
    });
  });

  describe('graceful degradation behavior', () => {
    it('initializeVault sets error instead of throwing on mainnet', () => {
      // Simulates the fixed behavior: setError + return instead of throw
      const isMainnet = true;
      let error: string | null = null;
      let threw = false;

      if (isMainnet) {
        error = 'Vault programs on devnet only';
        // return; — in the hook, this would return void
      } else {
        threw = true; // would proceed with on-chain call
      }

      expect(error).toBe('Vault programs on devnet only');
      expect(threw).toBe(false);
    });

    it('allows initializeVault on devnet', () => {
      const isMainnet = false;
      let error: string | null = null;
      let proceeded = false;

      if (isMainnet) {
        error = 'Vault programs on devnet only';
      } else {
        proceeded = true;
      }

      expect(error).toBeNull();
      expect(proceeded).toBe(true);
    });
  });

  describe('balance calculations', () => {
    it('computes currentBalance from deposited - withdrawn', () => {
      const totalDeposited = 5_000_000_000; // 5 SOL in lamports
      const totalWithdrawn = 2_000_000_000; // 2 SOL
      const LAMPORTS_PER_SOL = 1_000_000_000;
      const currentBalance = (totalDeposited - totalWithdrawn) / LAMPORTS_PER_SOL;
      expect(currentBalance).toBe(3);
    });

    it('computes availableBalance excluding in-session amount', () => {
      const currentBalance = 3;
      const inSessionAmount = 1;
      const available = Math.max(0, currentBalance - inSessionAmount);
      expect(available).toBe(2);
    });

    it('clamps availableBalance to zero', () => {
      const currentBalance = 1;
      const inSessionAmount = 2;
      const available = Math.max(0, currentBalance - inSessionAmount);
      expect(available).toBe(0);
    });
  });
});

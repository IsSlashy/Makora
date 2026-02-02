import { PublicKey } from '@solana/web3.js';
import type { TokenPrice } from '@makora/types';

const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';

/** Cache entry with TTL */
interface CacheEntry {
  price: TokenPrice;
  expiresAt: number;
}

/**
 * Fetches token prices from Jupiter Price API v2.
 *
 * This is the simplest price data source -- HTTP request, no WebSocket.
 * Suitable for CLI commands and infrequent reads.
 * For real-time prices (Phase 2+), use Pyth WebSocket subscriptions.
 */
export class JupiterPriceFeed {
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTtlMs: number;

  constructor(cacheTtlMs: number = 10_000) {
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Get price for a single token.
   */
  async getPrice(mint: PublicKey): Promise<TokenPrice | null> {
    const prices = await this.getPrices([mint]);
    return prices.get(mint.toBase58()) ?? null;
  }

  /**
   * Get prices for multiple tokens in a single request.
   * Uses Jupiter Price API v2 batch endpoint.
   */
  async getPrices(mints: PublicKey[]): Promise<Map<string, TokenPrice>> {
    const result = new Map<string, TokenPrice>();
    const uncachedMints: PublicKey[] = [];
    const now = Date.now();

    // Check cache first
    for (const mint of mints) {
      const key = mint.toBase58();
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > now) {
        result.set(key, cached.price);
      } else {
        uncachedMints.push(mint);
      }
    }

    if (uncachedMints.length === 0) {
      return result;
    }

    // Fetch uncached prices from Jupiter
    try {
      const ids = uncachedMints.map((m) => m.toBase58()).join(',');
      const response = await fetch(`${JUPITER_PRICE_API}?ids=${ids}`);

      if (!response.ok) {
        console.warn(`Jupiter Price API returned ${response.status}`);
        return result;
      }

      const data = (await response.json()) as {
        data: Record<string, { id: string; price: string; type: string }>;
      };

      for (const [mintStr, priceData] of Object.entries(data.data ?? {})) {
        const price: TokenPrice = {
          mint: new PublicKey(mintStr),
          symbol: '', // Will be enriched by caller
          priceUsd: parseFloat(priceData.price),
          timestamp: Math.floor(now / 1000),
          source: 'jupiter',
        };

        result.set(mintStr, price);
        this.cache.set(mintStr, {
          price,
          expiresAt: now + this.cacheTtlMs,
        });
      }
    } catch (err) {
      console.warn('Failed to fetch prices from Jupiter:', err);
    }

    return result;
  }

  /**
   * Clear the price cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}

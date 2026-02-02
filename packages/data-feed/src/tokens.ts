import { PublicKey } from '@solana/web3.js';
import type { TokenInfo, SolanaCluster } from '@makora/types';

/** Well-known SPL token mints */
export const NATIVE_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

/** Known tokens per cluster */
const TOKEN_REGISTRY: Record<SolanaCluster, TokenInfo[]> = {
  devnet: [
    {
      symbol: 'SOL',
      name: 'Solana',
      mint: NATIVE_SOL_MINT,
      decimals: 9,
      coingeckoId: 'solana',
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      mint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
      decimals: 6,
      coingeckoId: 'usd-coin',
    },
  ],
  'mainnet-beta': [
    {
      symbol: 'SOL',
      name: 'Solana',
      mint: NATIVE_SOL_MINT,
      decimals: 9,
      coingeckoId: 'solana',
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
      decimals: 6,
      coingeckoId: 'usd-coin',
    },
    {
      symbol: 'mSOL',
      name: 'Marinade staked SOL',
      mint: new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'),
      decimals: 9,
      coingeckoId: 'msol',
    },
    {
      symbol: 'USDT',
      name: 'Tether USD',
      mint: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
      decimals: 6,
      coingeckoId: 'tether',
    },
  ],
  localnet: [
    {
      symbol: 'SOL',
      name: 'Solana',
      mint: NATIVE_SOL_MINT,
      decimals: 9,
      coingeckoId: 'solana',
    },
  ],
};

/**
 * Get known tokens for a given cluster.
 */
export function getKnownTokens(cluster: SolanaCluster): TokenInfo[] {
  return TOKEN_REGISTRY[cluster] ?? TOKEN_REGISTRY.devnet;
}

/**
 * Find a token by symbol in the registry.
 */
export function findTokenBySymbol(symbol: string, cluster: SolanaCluster): TokenInfo | undefined {
  return getKnownTokens(cluster).find(
    (t) => t.symbol.toUpperCase() === symbol.toUpperCase()
  );
}

/**
 * Find a token by mint address in the registry.
 */
export function findTokenByMint(mint: PublicKey, cluster: SolanaCluster): TokenInfo | undefined {
  return getKnownTokens(cluster).find(
    (t) => t.mint.equals(mint)
  );
}

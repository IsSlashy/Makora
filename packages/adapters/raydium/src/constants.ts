import { PublicKey } from '@solana/web3.js';

/** Raydium AMM program ID (mainnet) */
export const RAYDIUM_AMM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

/** Raydium CLMM (Concentrated Liquidity) program ID (mainnet) */
export const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');

/** Raydium CPMM (Constant Product) program ID (mainnet) */
export const RAYDIUM_CPMM_PROGRAM_ID = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');

/** Raydium API base URL for pool data */
export const RAYDIUM_API_BASE_URL = 'https://api-v3.raydium.io';

/** Known high-TVL pools for default suggestions */
export const KNOWN_POOLS = {
  /** SOL/USDC AMM pool */
  SOL_USDC: new PublicKey('58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'),
  /** SOL/USDT AMM pool */
  SOL_USDT: new PublicKey('7XawhbbxtsRcQA8KTkHT9f9nc6d69UwqCDh6U5EEbEmX'),
} as const;

/** Default slippage for LP operations in basis points (1%) */
export const DEFAULT_LP_SLIPPAGE_BPS = 100;

/** Minimum liquidity amount in lamports */
export const MIN_LIQUIDITY_AMOUNT_LAMPORTS = 10_000_000n; // 0.01 SOL equivalent

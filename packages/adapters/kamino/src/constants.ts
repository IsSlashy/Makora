import { PublicKey } from '@solana/web3.js';

/** Kamino Lending (kLend) program ID (mainnet) */
export const KAMINO_LEND_PROGRAM_ID = new PublicKey('KLend2g3cP87ber41GXWsSZQz5NkCeMtW3aCdBqePxG');

/** Kamino Liquidity program ID (mainnet) */
export const KAMINO_LIQUIDITY_PROGRAM_ID = new PublicKey('KLiquQBRewRPyMgSFvehorBDf3PK5ZBT3e5U3yWDmZJ');

/** Kamino main market address (mainnet) */
export const KAMINO_MAIN_MARKET = new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF');

/** Kamino API base URL */
export const KAMINO_API_BASE_URL = 'https://api.hubbleprotocol.io/kamino';

/** Minimum deposit amount in lamports */
export const MIN_DEPOSIT_AMOUNT_LAMPORTS = 1_000_000n; // 0.001 SOL equivalent

/** Known Kamino vault strategies */
export const KNOWN_VAULTS = {
  /** SOL-USDC vault (most popular) */
  SOL_USDC: new PublicKey('ByxRYF4YKxasDqEr6VTtM5tLZqAR31YjGxsNEepKLUno'),
  /** SOL-mSOL vault */
  SOL_MSOL: new PublicKey('8DRToyNBUTR1PFNmEiRrHMGqbWf7Bfo2DhLHVFE1FbbD'),
} as const;

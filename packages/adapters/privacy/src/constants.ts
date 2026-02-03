import { PublicKey } from '@solana/web3.js';

/** Privacy program ID (makora_privacy) */
export const PRIVACY_PROGRAM_ID = new PublicKey(
  'C1qXFsB6oJgZLQnXwRi9mwrm3QshKMU8kGGUZTAa9xcM'
);

/** Default shield/unshield fee in basis points */
export const DEFAULT_PRIVACY_FEE_BPS = 10; // 0.1%

/** Maximum shieldable amount in lamports (10 SOL for hackathon) */
export const MAX_SHIELD_AMOUNT = 10_000_000_000n;

/** PDA seed prefixes */
export const SEEDS = {
  POOL: Buffer.from('pool'),
  STEALTH: Buffer.from('stealth'),
  NULLIFIER: Buffer.from('nullifier'),
} as const;

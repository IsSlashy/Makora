import { PublicKey } from '@solana/web3.js';

/** Marinade Finance program ID (mainnet) */
export const MARINADE_PROGRAM_ID = new PublicKey('MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD');

/** mSOL token mint (mainnet) */
export const MSOL_MINT = new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');

/** Marinade state account (mainnet) */
export const MARINADE_STATE = new PublicKey('8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC');

/** Native SOL wrapped mint */
export const NATIVE_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

/** Default priority fee for Marinade transactions (lamports) */
export const DEFAULT_PRIORITY_FEE_LAMPORTS = 5_000;

/** Maximum stake amount in SOL per single transaction */
export const MAX_STAKE_AMOUNT_SOL = 10_000;

/** Minimum stake amount in lamports (0.001 SOL) */
export const MIN_STAKE_AMOUNT_LAMPORTS = 1_000_000n;

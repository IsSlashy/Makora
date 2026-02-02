import type { PublicKey } from '@solana/web3.js';

// ============================================================================
// Privacy Types (for Phase 4 - placeholders now, full implementation later)
// ============================================================================

/** Stealth meta-address (published publicly by recipient) */
export interface StealthMetaAddress {
  spendingPublicKey: Uint8Array;
  viewingPublicKey: Uint8Array;
}

/** One-time stealth address (derived by sender) */
export interface StealthAddress {
  address: PublicKey;
  ephemeralPublicKey: Uint8Array;
}

/** Shielded note (private UTXO) */
export interface ShieldedNote {
  amount: bigint;
  tokenMint: PublicKey;
  owner: Uint8Array;
  randomness: Uint8Array;
  commitment: Uint8Array;
}

/** Groth16 proof for shielded transfers */
export interface Groth16Proof {
  piA: [string, string];
  piB: [[string, string], [string, string]];
  piC: [string, string];
  publicInputs: string[];
}

/** Privacy mode for the agent */
export type PrivacyMode = 'off' | 'stealth_only' | 'full_shielded';

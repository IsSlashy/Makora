/**
 * Type definitions for privacy layer
 */

import { PublicKey, Keypair } from '@solana/web3.js';

// ============================================================================
// Stealth Address Types
// ============================================================================

/**
 * Stealth meta-address used to derive one-time addresses
 * Contains the spending and viewing public keys
 */
export interface StealthMetaAddress {
  /** Spending public key (K) */
  spendingPubKey: Uint8Array;
  /** Viewing public key (V) */
  viewingPubKey: Uint8Array;
  /** Encoded string representation for sharing */
  encoded: string;
}

/**
 * A one-time stealth address for receiving a payment
 */
export interface StealthAddress {
  /** The one-time public key for receiving */
  address: PublicKey;
  /** Ephemeral public key (R) - shared with sender */
  ephemeralPubKey: Uint8Array;
  /** View tag for efficient scanning */
  viewTag: number;
  /** Timestamp when generated */
  createdAt: Date;
}

/**
 * A detected incoming stealth payment
 */
export interface StealthPayment {
  /** The stealth address that received the payment */
  stealthAddress: PublicKey;
  /** The ephemeral public key from the sender */
  ephemeralPubKey: Uint8Array;
  /** Amount received in lamports */
  amount: bigint;
  /** Token mint (null for SOL) */
  tokenMint: PublicKey | null;
  /** Transaction signature */
  signature: string;
  /** Block time of the payment */
  blockTime: number;
  /** Whether the payment has been claimed */
  claimed: boolean;
  /** View tag for verification */
  viewTag: number;
}

// ============================================================================
// Shielded Transfer Types
// ============================================================================

/**
 * Note data representing a shielded UTXO
 */
export interface NoteData {
  /** Amount in the note */
  amount: bigint;
  /** Owner's public key (as field element) */
  ownerPubkey: bigint;
  /** Randomness for commitment */
  randomness: bigint;
  /** Token mint (as field element) */
  tokenMint: bigint;
  /** Commitment hash */
  commitment: bigint;
  /** Leaf index in Merkle tree (optional) */
  leafIndex?: number;
}

/**
 * Encrypted note data
 */
export interface EncryptedNoteData {
  /** Encrypted note ciphertext */
  ciphertext: Uint8Array;
  /** Ephemeral public key for decryption */
  ephemeralPubkey: Uint8Array;
  /** Commitment (public) */
  commitment: Uint8Array;
  /** Nonce for encryption */
  nonce: Uint8Array;
}

/**
 * Groth16 proof structure
 */
export interface Groth16Proof {
  /** Proof element A (G1 point) */
  pi_a: Uint8Array;
  /** Proof element B (G2 point) */
  pi_b: Uint8Array;
  /** Proof element C (G1 point) */
  pi_c: Uint8Array;
}

/**
 * Public inputs for transfer circuit
 */
export interface TransferPublicInputs {
  /** Merkle root of note tree */
  merkleRoot: bigint;
  /** Nullifier for input note 1 */
  nullifier1: bigint;
  /** Nullifier for input note 2 */
  nullifier2: bigint;
  /** Commitment for output note 1 */
  outputCommitment1: bigint;
  /** Commitment for output note 2 */
  outputCommitment2: bigint;
  /** Public amount (deposit/withdrawal) */
  publicAmount: bigint;
  /** Token mint */
  tokenMint: bigint;
}

/**
 * Private inputs for transfer circuit
 */
export interface TransferPrivateInputs {
  /** Input note 1 amount */
  inAmount1: bigint;
  /** Input note 1 owner pubkey */
  inOwnerPubkey1: bigint;
  /** Input note 1 randomness */
  inRandomness1: bigint;
  /** Input note 1 Merkle path indices */
  inPathIndices1: number[];
  /** Input note 1 Merkle path elements */
  inPathElements1: bigint[];

  /** Input note 2 amount */
  inAmount2: bigint;
  /** Input note 2 owner pubkey */
  inOwnerPubkey2: bigint;
  /** Input note 2 randomness */
  inRandomness2: bigint;
  /** Input note 2 Merkle path indices */
  inPathIndices2: number[];
  /** Input note 2 Merkle path elements */
  inPathElements2: bigint[];

  /** Output note 1 amount */
  outAmount1: bigint;
  /** Output note 1 recipient pubkey */
  outRecipient1: bigint;
  /** Output note 1 randomness */
  outRandomness1: bigint;

  /** Output note 2 amount */
  outAmount2: bigint;
  /** Output note 2 recipient pubkey */
  outRecipient2: bigint;
  /** Output note 2 randomness */
  outRandomness2: bigint;

  /** Spending key */
  spendingKey: bigint;
}

/**
 * Merkle proof data
 */
export interface MerkleProof {
  /** Path elements (siblings) */
  path: bigint[];
  /** Path indices (0 = left, 1 = right) */
  pathIndices: number[];
  /** Merkle root */
  root: bigint;
  /** Leaf value */
  leaf: bigint;
  /** Leaf index */
  leafIndex: number;
}

// ============================================================================
// Privacy Manager Types
// ============================================================================

/**
 * Privacy configuration
 */
export interface PrivacyConfig {
  /** Enable privacy features */
  enabled: boolean;
  /** Default privacy level */
  defaultLevel?: 'none' | 'stealth' | 'shielded';
  /** Custom circuit paths */
  circuitPaths?: {
    wasm?: string;
    zkey?: string;
    vkey?: string;
  };
}

/**
 * Privacy status
 */
export interface PrivacyStatus {
  /** Whether privacy is enabled */
  enabled: boolean;
  /** Whether stealth is available */
  stealthAvailable: boolean;
  /** Whether shielded transfers are available */
  shieldedAvailable: boolean;
  /** Number of notes in local tree */
  noteCount: number;
  /** Current Merkle root */
  currentRoot: bigint | null;
}

/**
 * Spending key pair for shielded transactions
 */
export interface SpendingKeyPair {
  /** Spending key (private) */
  spendingKey: bigint;
  /** Owner public key (derived from spending key) */
  ownerPubkey: bigint;
  /** Spending key hash */
  spendingKeyHash: bigint;
}

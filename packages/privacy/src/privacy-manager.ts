/**
 * Privacy Manager
 * Main entry point that ties together stealth and shielded functionality
 */

import { Keypair, PublicKey } from '@solana/web3.js';
import type {
  PrivacyConfig,
  PrivacyStatus,
  StealthMetaAddress,
  NoteData,
  Groth16Proof,
  TransferPublicInputs,
  TransferPrivateInputs,
  MerkleProof,
} from './types';
import {
  generateStealthMetaAddress,
  parseStealthMetaAddress,
  generateStealthAddress,
  StealthScanner,
} from './stealth';
import {
  Note,
  createNote,
  MerkleTree,
  ZkProver,
} from './shielded';

/**
 * Privacy Manager class
 * Manages privacy features including stealth addresses and shielded transfers
 */
export class PrivacyManager {
  private enabled: boolean;
  private stealthScanner: StealthScanner | null = null;
  private merkleTree: MerkleTree | null = null;
  private zkProver: ZkProver | null = null;
  private config: PrivacyConfig;

  constructor(config: PrivacyConfig) {
    this.enabled = config.enabled;
    this.config = config;

    // Initialize Merkle tree if enabled
    if (this.enabled) {
      this.merkleTree = new MerkleTree();
    }
  }

  // ============================================================================
  // Stealth Address Operations
  // ============================================================================

  /**
   * Generate a stealth meta-address
   * @param spendingKeypair - Keypair for spending
   * @param viewingKeypair - Keypair for viewing/scanning
   */
  generateMetaAddress(
    spendingKeypair: Keypair,
    viewingKeypair: Keypair
  ): StealthMetaAddress {
    if (!this.enabled) {
      throw new Error('Privacy features are disabled');
    }

    return generateStealthMetaAddress(spendingKeypair, viewingKeypair);
  }

  /**
   * Parse a stealth meta-address from string
   */
  parseMetaAddress(encoded: string): StealthMetaAddress {
    return parseStealthMetaAddress(encoded);
  }

  /**
   * Derive a one-time stealth address for a recipient
   * @param recipientMeta - Recipient's stealth meta-address
   */
  deriveStealthAddress(recipientMeta: StealthMetaAddress | string): {
    address: PublicKey;
    ephemeralPubKey: Uint8Array;
    viewTag: number;
    ephemeralPrivateKey: Uint8Array;
  } {
    if (!this.enabled) {
      throw new Error('Privacy features are disabled');
    }

    return generateStealthAddress(recipientMeta);
  }

  /**
   * Initialize stealth scanner
   */
  initializeScanner(
    connection: any,
    viewingPrivateKey: Uint8Array,
    spendingPubKey: Uint8Array
  ): void {
    if (!this.enabled) {
      throw new Error('Privacy features are disabled');
    }

    this.stealthScanner = new StealthScanner(
      connection,
      viewingPrivateKey,
      spendingPubKey
    );
  }

  /**
   * Scan for incoming stealth payments
   */
  async scanPayments(options?: any): Promise<any[]> {
    if (!this.stealthScanner) {
      throw new Error('Scanner not initialized');
    }

    return this.stealthScanner.scan(options);
  }

  // ============================================================================
  // Shielded Transfer Operations
  // ============================================================================

  /**
   * Create a shielded note
   * @param amount - Amount in the note
   * @param recipient - Recipient's public key (as field element)
   * @param tokenMint - Token mint (as field element)
   */
  createShieldedNote(
    amount: bigint,
    recipient: bigint,
    tokenMint: bigint
  ): Note {
    if (!this.enabled) {
      throw new Error('Privacy features are disabled');
    }

    return createNote(amount, recipient, tokenMint);
  }

  /**
   * Insert a note commitment into the Merkle tree
   * @param commitment - Note commitment
   */
  insertNoteCommitment(commitment: bigint): number {
    if (!this.merkleTree) {
      throw new Error('Merkle tree not initialized');
    }

    return this.merkleTree.insert(commitment);
  }

  /**
   * Generate a Merkle proof for a note
   * @param leafIndex - Index of the note in the tree
   */
  generateMerkleProof(leafIndex: number): MerkleProof {
    if (!this.merkleTree) {
      throw new Error('Merkle tree not initialized');
    }

    return this.merkleTree.generateProof(leafIndex);
  }

  /**
   * Get current Merkle root
   */
  getMerkleRoot(): bigint {
    if (!this.merkleTree) {
      throw new Error('Merkle tree not initialized');
    }

    return this.merkleTree.getRoot();
  }

  /**
   * Generate a shielded transfer proof
   * @param publicInputs - Public inputs for the circuit
   * @param privateInputs - Private inputs for the circuit
   */
  async generateShieldProof(
    publicInputs: TransferPublicInputs,
    privateInputs: TransferPrivateInputs
  ): Promise<{ proof: Groth16Proof; publicSignals: string[] }> {
    if (!this.enabled) {
      throw new Error('Privacy features are disabled');
    }

    // Initialize prover if needed
    if (!this.zkProver) {
      this.zkProver = new ZkProver(
        this.config.circuitPaths?.wasm,
        this.config.circuitPaths?.zkey
      );
      await this.zkProver.initialize();
    }

    return this.zkProver.generateTransferProof(publicInputs, privateInputs);
  }

  // ============================================================================
  // Status and Configuration
  // ============================================================================

  /**
   * Check if privacy features are enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Get privacy status
   */
  getStatus(): PrivacyStatus {
    return {
      enabled: this.enabled,
      stealthAvailable: this.enabled,
      shieldedAvailable: this.enabled && this.zkProver !== null,
      noteCount: this.merkleTree?.leafCount ?? 0,
      currentRoot: this.merkleTree?.getRoot() ?? null,
    };
  }

  /**
   * Export Merkle tree state
   */
  exportTreeState(): { leaves: [number, string][]; depth: number } | null {
    if (!this.merkleTree) {
      return null;
    }

    return this.merkleTree.export();
  }

  /**
   * Import Merkle tree state
   */
  importTreeState(state: { leaves: [number, string][]; depth: number }): void {
    if (!this.merkleTree) {
      this.merkleTree = new MerkleTree();
    }

    this.merkleTree.import(state);
  }
}

/**
 * Create a privacy manager instance
 * @param config - Privacy configuration
 */
export function createPrivacyManager(config: PrivacyConfig): PrivacyManager {
  return new PrivacyManager(config);
}

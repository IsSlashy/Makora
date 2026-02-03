/**
 * @makora/privacy
 * Privacy layer for Makora - stealth addresses and shielded transfers
 */

// ============================================================================
// Main Privacy Manager
// ============================================================================
export { PrivacyManager, createPrivacyManager } from './privacy-manager';

// ============================================================================
// Types
// ============================================================================
export type {
  // Stealth types
  StealthMetaAddress,
  StealthAddress,
  StealthPayment,

  // Shielded types
  NoteData,
  EncryptedNoteData,
  Groth16Proof,
  TransferPublicInputs,
  TransferPrivateInputs,
  MerkleProof,

  // Privacy types
  PrivacyConfig,
  PrivacyStatus,
  SpendingKeyPair,
} from './types';

// ============================================================================
// Stealth Module
// ============================================================================
export {
  // Generation
  generateStealthMetaAddress,
  parseStealthMetaAddress,
  generateStealthAddress,
  createStealthAnnouncement,
  parseStealthAnnouncement,

  // Derivation
  deriveStealthPublicKey,
  deriveStealthPrivateKey,
  verifyStealthOwnership,

  // Scanning
  StealthScanner,
  scanForPayments,
  type ScanOptions,
} from './stealth';

// ============================================================================
// Shielded Module
// ============================================================================
export {
  // Note management
  Note,
  createNote,
  encryptNote,
  decryptNote,

  // Merkle tree
  MerkleTree,
  generateMerkleProof,
  verifyMerkleProof,

  // Prover
  ZkProver,
  generateProof,
  type CircuitInputs,
} from './shielded';

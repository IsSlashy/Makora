/**
 * Shielded transfer module
 * Exports all shielded transfer functionality
 */

// Note management
export { Note, createNote, encryptNote, decryptNote } from './note';

// Merkle tree
export { MerkleTree, generateMerkleProof, verifyMerkleProof } from './merkle';

// Prover
export { ZkProver, generateProof, type CircuitInputs } from './prover';

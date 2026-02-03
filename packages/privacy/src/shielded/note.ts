/**
 * Note management for shielded transactions
 * Handles creation, encryption, and decryption of notes
 */

import { sha256 } from '@noble/hashes/sha256';
import type { NoteData, EncryptedNoteData } from '../types';

/**
 * Note class representing a shielded UTXO
 */
export class Note {
  readonly amount: bigint;
  readonly ownerPubkey: bigint;
  readonly randomness: bigint;
  readonly tokenMint: bigint;
  readonly commitment: bigint;
  leafIndex?: number;

  constructor(data: NoteData) {
    this.amount = data.amount;
    this.ownerPubkey = data.ownerPubkey;
    this.randomness = data.randomness;
    this.tokenMint = data.tokenMint;
    this.commitment = data.commitment;
    this.leafIndex = data.leafIndex;
  }

  /**
   * Serialize note data
   */
  toJSON(): NoteData {
    return {
      amount: this.amount,
      ownerPubkey: this.ownerPubkey,
      randomness: this.randomness,
      tokenMint: this.tokenMint,
      commitment: this.commitment,
      leafIndex: this.leafIndex,
    };
  }

  /**
   * Get commitment as bytes
   */
  getCommitmentBytes(): Uint8Array {
    return fieldToBytes(this.commitment);
  }
}

/**
 * Create a new note
 * @param amount - Amount in the note
 * @param ownerPubkey - Owner's public key (as field element)
 * @param tokenMint - Token mint (as field element)
 * @param randomness - Randomness for commitment (optional, will be generated)
 */
export function createNote(
  amount: bigint,
  ownerPubkey: bigint,
  tokenMint: bigint,
  randomness?: bigint
): Note {
  const rand = randomness ?? randomFieldElement();

  // Compute commitment using Poseidon-like hash
  // In production, this would use actual Poseidon hash from circuit
  // For now, use SHA256-based commitment
  const commitment = computeCommitment(amount, ownerPubkey, rand, tokenMint);

  return new Note({
    amount,
    ownerPubkey,
    randomness: rand,
    tokenMint,
    commitment,
  });
}

/**
 * Encrypt a note for storage
 * Uses AES-like encryption with derived key
 */
export function encryptNote(note: Note, sharedSecret: Uint8Array): EncryptedNoteData {
  // Generate ephemeral data
  const ephemeralPubkey = new Uint8Array(32);
  crypto.getRandomValues(ephemeralPubkey);

  // Derive encryption key from shared secret
  const encryptionKey = sha256(
    new Uint8Array([...sharedSecret, ...ephemeralPubkey])
  );

  // Serialize note data
  const noteData = serializeNoteData(note);

  // Generate nonce
  const nonce = new Uint8Array(24);
  crypto.getRandomValues(nonce);

  // Simple XOR encryption (replace with XChaCha20-Poly1305 in production)
  const keyStream = expandKey(encryptionKey, nonce, noteData.length);
  const ciphertext = new Uint8Array(noteData.length);
  for (let i = 0; i < noteData.length; i++) {
    ciphertext[i] = noteData[i]! ^ keyStream[i]!;
  }

  return {
    ciphertext,
    ephemeralPubkey,
    commitment: fieldToBytes(note.commitment),
    nonce,
  };
}

/**
 * Decrypt a note
 */
export function decryptNote(
  encrypted: EncryptedNoteData,
  sharedSecret: Uint8Array
): Note | null {
  try {
    // Derive encryption key
    const encryptionKey = sha256(
      new Uint8Array([...sharedSecret, ...encrypted.ephemeralPubkey])
    );

    // Decrypt
    const keyStream = expandKey(encryptionKey, encrypted.nonce, encrypted.ciphertext.length);
    const noteData = new Uint8Array(encrypted.ciphertext.length);
    for (let i = 0; i < encrypted.ciphertext.length; i++) {
      noteData[i] = encrypted.ciphertext[i]! ^ keyStream[i]!;
    }

    // Deserialize
    return deserializeNoteData(noteData);
  } catch {
    return null;
  }
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Compute commitment for a note
 * Simplified version using SHA256 - production would use Poseidon
 */
function computeCommitment(
  amount: bigint,
  ownerPubkey: bigint,
  randomness: bigint,
  tokenMint: bigint
): bigint {
  const inputs = new Uint8Array(128);
  inputs.set(fieldToBytes(amount), 0);
  inputs.set(fieldToBytes(ownerPubkey), 32);
  inputs.set(fieldToBytes(randomness), 64);
  inputs.set(fieldToBytes(tokenMint), 96);

  const hash = sha256(inputs);
  return bytesToField(hash);
}

/**
 * Generate a random field element
 */
function randomFieldElement(): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToField(bytes);
}

/**
 * Convert field element to bytes
 */
function fieldToBytes(field: bigint): Uint8Array {
  const bytes = new Uint8Array(32);
  let value = field;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(value & 0xffn);
    value = value >> 8n;
  }
  return bytes;
}

/**
 * Convert bytes to field element
 */
function bytesToField(bytes: Uint8Array): bigint {
  let result = 0n;
  for (let i = 0; i < Math.min(bytes.length, 32); i++) {
    result = (result << 8n) | BigInt(bytes[i]!);
  }
  return result;
}

/**
 * Serialize note data to bytes
 */
function serializeNoteData(note: Note): Uint8Array {
  const buffer = new Uint8Array(128);
  let offset = 0;

  // Amount (32 bytes)
  const amountBytes = fieldToBytes(note.amount);
  buffer.set(amountBytes, offset);
  offset += 32;

  // Owner pubkey (32 bytes)
  buffer.set(fieldToBytes(note.ownerPubkey), offset);
  offset += 32;

  // Randomness (32 bytes)
  buffer.set(fieldToBytes(note.randomness), offset);
  offset += 32;

  // Token mint (32 bytes)
  buffer.set(fieldToBytes(note.tokenMint), offset);

  return buffer;
}

/**
 * Deserialize note data from bytes
 */
function deserializeNoteData(data: Uint8Array): Note {
  let offset = 0;

  // Amount
  const amount = bytesToField(data.slice(offset, offset + 32));
  offset += 32;

  // Owner pubkey
  const ownerPubkey = bytesToField(data.slice(offset, offset + 32));
  offset += 32;

  // Randomness
  const randomness = bytesToField(data.slice(offset, offset + 32));
  offset += 32;

  // Token mint
  const tokenMint = bytesToField(data.slice(offset, offset + 32));

  // Recompute commitment for validation
  const commitment = computeCommitment(amount, ownerPubkey, randomness, tokenMint);

  return new Note({
    amount,
    ownerPubkey,
    randomness,
    tokenMint,
    commitment,
  });
}

/**
 * Expand key using SHA256 (simplified KDF)
 */
function expandKey(key: Uint8Array, nonce: Uint8Array, length: number): Uint8Array {
  const result = new Uint8Array(length);
  let offset = 0;
  let counter = 0;

  while (offset < length) {
    const input = new Uint8Array(key.length + nonce.length + 4);
    input.set(key, 0);
    input.set(nonce, key.length);
    new DataView(input.buffer).setUint32(key.length + nonce.length, counter++, true);

    const block = sha256(input);
    const toCopy = Math.min(block.length, length - offset);
    result.set(block.slice(0, toCopy), offset);
    offset += toCopy;
  }

  return result;
}

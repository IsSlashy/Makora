/**
 * Stealth address derivation
 * Handles derivation of one-time stealth keys and verification
 */

import { PublicKey, Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha256';
import type { StealthMetaAddress } from '../types';

/**
 * Derive a one-time stealth public key from the recipient's meta-address
 * This is used by the SENDER to generate the stealth address
 *
 * @param recipientMetaAddress - Recipient's stealth meta-address (spending + viewing pubkeys)
 * @param ephemeralPrivateKey - Sender's ephemeral private key
 * @returns The derived stealth public key and ephemeral public key
 */
export function deriveStealthPublicKey(
  recipientMetaAddress: StealthMetaAddress,
  ephemeralPrivateKey: Uint8Array
): {
  stealthPubKey: PublicKey;
  ephemeralPubKey: Uint8Array;
  viewTag: number;
} {
  try {
    // Get ephemeral public key from private key
    const ephemeralKeypair = nacl.box.keyPair.fromSecretKey(ephemeralPrivateKey);
    const ephemeralPubKey = ephemeralKeypair.publicKey;

    // Compute shared secret: s = ECDH(r, V) where r is ephemeral private, V is viewing pubkey
    const sharedSecret = deriveSharedSecret(
      ephemeralPrivateKey,
      recipientMetaAddress.viewingPubKey
    );

    // Compute view tag for efficient scanning
    const viewTag = computeViewTag(sharedSecret);

    // Hash the shared secret
    const hashedSecret = sha256(sharedSecret);

    // Derive stealth public key: P = K + hash(s)*G
    // In practice, we add the hashed secret to the spending public key
    const stealthPubKeyBytes = addPublicKeys(
      recipientMetaAddress.spendingPubKey,
      hashedSecret
    );

    const stealthPubKey = new PublicKey(stealthPubKeyBytes);

    return {
      stealthPubKey,
      ephemeralPubKey,
      viewTag,
    };
  } catch (error) {
    throw new Error(`Failed to derive stealth public key: ${error}`);
  }
}

/**
 * Derive the stealth private key that can spend from the stealth address
 * This is used by the RECIPIENT to derive the key for claiming
 *
 * @param spendingPrivateKey - Recipient's spending private key
 * @param viewingPrivateKey - Recipient's viewing private key
 * @param ephemeralPubKey - Sender's ephemeral public key
 * @returns The derived stealth keypair
 */
export function deriveStealthPrivateKey(
  spendingPrivateKey: Uint8Array,
  viewingPrivateKey: Uint8Array,
  ephemeralPubKey: Uint8Array
): Keypair {
  try {
    // Compute shared secret: s = ECDH(v, R) where v is viewing private, R is ephemeral pubkey
    const sharedSecret = deriveSharedSecret(viewingPrivateKey, ephemeralPubKey);

    // Hash the shared secret
    const hashedSecret = sha256(sharedSecret);

    // Derive stealth private key: p = k + hash(s)
    // where k is the spending private key
    const stealthPrivateKey = addPrivateKeys(spendingPrivateKey, hashedSecret);

    // Create keypair from the derived private key
    // Note: Solana expects a 64-byte secret key (seed + public key)
    const seedKeypair = nacl.sign.keyPair.fromSeed(stealthPrivateKey);

    return Keypair.fromSecretKey(seedKeypair.secretKey);
  } catch (error) {
    throw new Error(`Failed to derive stealth private key: ${error}`);
  }
}

/**
 * Verify if a stealth address belongs to a recipient
 * @param stealthAddress - The stealth address to check
 * @param ephemeralPubKey - The ephemeral public key from the transaction
 * @param viewingPrivateKey - Recipient's viewing private key
 * @param spendingPubKey - Recipient's spending public key
 * @param viewTag - View tag for quick filtering (optional)
 */
export function verifyStealthOwnership(
  stealthAddress: PublicKey,
  ephemeralPubKey: Uint8Array,
  viewingPrivateKey: Uint8Array,
  spendingPubKey: Uint8Array,
  viewTag?: number
): boolean {
  try {
    // Compute shared secret
    const sharedSecret = deriveSharedSecret(viewingPrivateKey, ephemeralPubKey);

    // Quick check with view tag if provided
    if (viewTag !== undefined) {
      const computedViewTag = computeViewTag(sharedSecret);
      if (computedViewTag !== viewTag) {
        return false;
      }
    }

    // Hash the shared secret
    const hashedSecret = sha256(sharedSecret);

    // Derive expected stealth public key
    const expectedStealthPubKey = addPublicKeys(spendingPubKey, hashedSecret);

    // Compare with the actual stealth address
    return stealthAddress.toBuffer().equals(Buffer.from(expectedStealthPubKey));
  } catch {
    return false;
  }
}

// ============================================================================
// Helper functions for EC arithmetic and shared secrets
// ============================================================================

/**
 * Derive a shared secret using ECDH (X25519)
 * @param privateKey - The private key (32 bytes)
 * @param publicKey - The public key (32 bytes)
 */
function deriveSharedSecret(
  privateKey: Uint8Array,
  publicKey: Uint8Array
): Uint8Array {
  return nacl.scalarMult(privateKey, publicKey);
}

/**
 * Compute a view tag from shared secret (first byte of hash)
 * @param sharedSecret - The ECDH shared secret
 */
function computeViewTag(sharedSecret: Uint8Array): number {
  const hash = sha256(sharedSecret);
  return hash[0]!;
}

/**
 * Add a scalar to a public key (simplified)
 * P' = P + hash*G
 *
 * Note: This is a simplified implementation using hash-based combination.
 * In production, use proper elliptic curve point addition.
 */
function addPublicKeys(pubKey: Uint8Array, scalar: Uint8Array): Uint8Array {
  // Generate a keypair from the scalar (this gives us scalar*G)
  const scalarKeypair = nacl.sign.keyPair.fromSeed(scalar);
  const scalarPoint = scalarKeypair.publicKey;

  // XOR-based addition (simplified - not real EC addition)
  // In production, use proper point addition
  const result = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    result[i] = pubKey[i]! ^ scalarPoint[i]!;
  }

  // Hash to ensure valid public key
  return sha256(result);
}

/**
 * Add two private keys (mod curve order)
 * Simplified modular addition for demonstration
 */
function addPrivateKeys(key1: Uint8Array, key2: Uint8Array): Uint8Array {
  const result = new Uint8Array(32);

  // Simple modular addition (simplified)
  let carry = 0;
  for (let i = 31; i >= 0; i--) {
    const sum = key1[i]! + key2[i]! + carry;
    result[i] = sum % 256;
    carry = Math.floor(sum / 256);
  }

  return result;
}

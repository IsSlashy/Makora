/**
 * Stealth address generation
 * Generates stealth meta-addresses and one-time stealth addresses
 */

import { PublicKey, Keypair } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { sha256 } from '@noble/hashes/sha256';
import bs58 from 'bs58';
import type { StealthMetaAddress, StealthAddress } from '../types';
import { deriveStealthPublicKey } from './derive';

/**
 * Generate a stealth meta-address from spending and viewing keypairs
 * @param spendingKeypair - Keypair for spending (private key stays with recipient)
 * @param viewingKeypair - Keypair for viewing/scanning (private key stays with recipient)
 */
export function generateStealthMetaAddress(
  spendingKeypair: Keypair,
  viewingKeypair: Keypair
): StealthMetaAddress {
  const spendingPubKey = spendingKeypair.publicKey.toBytes();
  const viewingPubKey = viewingKeypair.publicKey.toBytes();

  return {
    spendingPubKey,
    viewingPubKey,
    encoded: encodeStealthMetaAddress(spendingPubKey, viewingPubKey),
  };
}

/**
 * Parse an encoded stealth meta-address
 * @param encoded - The encoded stealth meta-address string
 */
export function parseStealthMetaAddress(encoded: string): StealthMetaAddress {
  try {
    const { spendingPubKey, viewingPubKey } = decodeStealthMetaAddress(encoded);
    return {
      spendingPubKey,
      viewingPubKey,
      encoded,
    };
  } catch (error) {
    throw new Error(`Invalid stealth meta-address format: ${error}`);
  }
}

/**
 * Generate a one-time stealth address for receiving a payment
 * This creates a fresh address that can only be spent by the meta-address owner
 *
 * @param recipientMetaAddress - The recipient's stealth meta-address
 */
export function generateStealthAddress(
  recipientMetaAddress: StealthMetaAddress | string
): StealthAddress & { ephemeralPrivateKey: Uint8Array } {
  try {
    // Parse meta-address if string
    const metaAddress =
      typeof recipientMetaAddress === 'string'
        ? parseStealthMetaAddress(recipientMetaAddress)
        : recipientMetaAddress;

    // Generate ephemeral keypair for this transaction
    const ephemeralKeypair = generateEphemeralKeypair();

    // Derive the stealth public key
    const { stealthPubKey, ephemeralPubKey, viewTag } = deriveStealthPublicKey(
      metaAddress,
      ephemeralKeypair.secretKey
    );

    return {
      address: stealthPubKey,
      ephemeralPubKey,
      viewTag,
      createdAt: new Date(),
      ephemeralPrivateKey: ephemeralKeypair.secretKey,
    };
  } catch (error) {
    throw new Error(`Failed to generate stealth address: ${error}`);
  }
}

/**
 * Create a shareable stealth address announcement
 * This is the data that gets published on-chain for the recipient to find
 *
 * @param stealthAddress - The generated stealth address
 * @param ephemeralPubKey - The ephemeral public key
 * @param viewTag - The view tag
 */
export function createStealthAnnouncement(
  stealthAddress: PublicKey,
  ephemeralPubKey: Uint8Array,
  viewTag: number
): Uint8Array {
  // Format: [view_tag (1 byte)] [ephemeral_pubkey (32 bytes)] [stealth_address (32 bytes)]
  const announcement = new Uint8Array(65);
  announcement[0] = viewTag;
  announcement.set(ephemeralPubKey, 1);
  announcement.set(stealthAddress.toBytes(), 33);
  return announcement;
}

/**
 * Parse a stealth announcement
 * @param announcement - The announcement data
 */
export function parseStealthAnnouncement(announcement: Uint8Array): {
  viewTag: number;
  ephemeralPubKey: Uint8Array;
  stealthAddress: PublicKey;
} {
  if (announcement.length !== 65) {
    throw new Error('Invalid announcement length');
  }

  return {
    viewTag: announcement[0]!,
    ephemeralPubKey: announcement.slice(1, 33),
    stealthAddress: new PublicKey(announcement.slice(33, 65)),
  };
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Encode stealth meta-address to string
 * Format: st:<base58(spendingPubKey)>:<base58(viewingPubKey)>
 */
function encodeStealthMetaAddress(
  spendingPubKey: Uint8Array,
  viewingPubKey: Uint8Array
): string {
  const spendingB58 = bs58.encode(spendingPubKey);
  const viewingB58 = bs58.encode(viewingPubKey);
  return `st:${spendingB58}:${viewingB58}`;
}

/**
 * Decode stealth meta-address from string
 */
function decodeStealthMetaAddress(encoded: string): {
  spendingPubKey: Uint8Array;
  viewingPubKey: Uint8Array;
} {
  const parts = encoded.split(':');
  if (parts.length !== 3 || parts[0] !== 'st') {
    throw new Error('Invalid stealth meta-address format');
  }

  const spendingPubKey = bs58.decode(parts[1]!);
  const viewingPubKey = bs58.decode(parts[2]!);

  if (spendingPubKey.length !== 32 || viewingPubKey.length !== 32) {
    throw new Error('Invalid public key length');
  }

  return { spendingPubKey, viewingPubKey };
}

/**
 * Generate a random ephemeral keypair
 */
function generateEphemeralKeypair(): nacl.BoxKeyPair {
  return nacl.box.keyPair();
}

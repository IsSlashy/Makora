/**
 * Stealth payment scanner
 * Scans for incoming stealth payments using viewing key
 */

import { Connection, PublicKey } from '@solana/web3.js';
import type { StealthPayment } from '../types';
import { verifyStealthOwnership } from './derive';
import { sha256 } from '@noble/hashes/sha256';
import nacl from 'tweetnacl';

/**
 * Options for scanning stealth payments
 */
export interface ScanOptions {
  /** Start slot for scanning */
  fromSlot?: number;
  /** End slot for scanning */
  toSlot?: number;
  /** Only scan for specific token mints */
  tokenMints?: PublicKey[];
  /** Include already claimed payments */
  includeClaimed?: boolean;
  /** Maximum number of payments to scan */
  limit?: number;
}

/**
 * Scanner for detecting incoming stealth payments
 */
export class StealthScanner {
  private connection: Connection;
  private viewingPrivateKey: Uint8Array;
  private spendingPubKey: Uint8Array;
  private lastScannedSlot: number = 0;

  constructor(
    connection: Connection,
    viewingPrivateKey: Uint8Array,
    spendingPubKey: Uint8Array
  ) {
    this.connection = connection;
    this.viewingPrivateKey = viewingPrivateKey;
    this.spendingPubKey = spendingPubKey;
  }

  /**
   * Scan for incoming stealth payments
   * @param options - Scan options
   */
  async scan(options: ScanOptions = {}): Promise<StealthPayment[]> {
    const {
      fromSlot = this.lastScannedSlot,
      toSlot,
      tokenMints,
      includeClaimed = false,
      limit = 100,
    } = options;

    try {
      // Get recent signatures for the announcement program account
      // In production, this would query the Makora program's announcement account
      const announcements = await this.fetchAnnouncements(fromSlot, toSlot, limit);

      const payments: StealthPayment[] = [];

      for (const announcement of announcements) {
        const payment = await this.processAnnouncement(announcement, tokenMints);
        if (payment) {
          if (includeClaimed || !payment.claimed) {
            payments.push(payment);
          }
        }
      }

      // Update last scanned slot
      if (payments.length > 0) {
        const maxBlockTime = Math.max(...payments.map((p) => p.blockTime));
        this.lastScannedSlot = maxBlockTime;
      }

      return payments;
    } catch (error) {
      throw new Error(`Failed to scan for stealth payments: ${error}`);
    }
  }

  /**
   * Check if a specific transaction contains a payment for this wallet
   * @param signature - Transaction signature to check
   */
  async checkTransaction(signature: string): Promise<StealthPayment | null> {
    try {
      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        return null;
      }

      return this.processTransaction(tx, signature);
    } catch (error) {
      throw new Error(`Failed to check transaction ${signature}: ${error}`);
    }
  }

  /**
   * Quick check using view tag for efficient scanning
   * @param viewTag - The view tag from the announcement
   * @param ephemeralPubKey - The ephemeral public key
   */
  checkViewTag(viewTag: number, ephemeralPubKey: Uint8Array): boolean {
    const sharedSecret = nacl.scalarMult(this.viewingPrivateKey, ephemeralPubKey);
    const computedTag = computeViewTag(sharedSecret);
    return computedTag === viewTag;
  }

  /**
   * Verify ownership of a stealth payment
   * @param ephemeralPubKey - Ephemeral public key from the announcement
   * @param stealthAddress - The stealth address
   */
  verifyOwnership(
    ephemeralPubKey: Uint8Array,
    stealthAddress: PublicKey
  ): boolean {
    return verifyStealthOwnership(
      stealthAddress,
      ephemeralPubKey,
      this.viewingPrivateKey,
      this.spendingPubKey
    );
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  /**
   * Fetch stealth announcements from the blockchain
   */
  private async fetchAnnouncements(
    fromSlot: number,
    toSlot: number | undefined,
    limit: number
  ): Promise<AnnouncementData[]> {
    // In production, this would:
    // 1. Query the Makora program's announcement PDA
    // 2. Parse the memo/log data for stealth announcements
    // 3. Return parsed announcement data

    // For now, return empty array - actual implementation depends on program structure
    return [];
  }

  /**
   * Process a stealth announcement and check if it belongs to this wallet
   */
  private async processAnnouncement(
    announcement: AnnouncementData,
    tokenMints?: PublicKey[]
  ): Promise<StealthPayment | null> {
    // Quick filter using view tag
    if (!this.checkViewTag(announcement.viewTag, announcement.ephemeralPubKey)) {
      return null;
    }

    // Full verification
    const isOwner = verifyStealthOwnership(
      announcement.stealthAddress,
      announcement.ephemeralPubKey,
      this.viewingPrivateKey,
      this.spendingPubKey,
      announcement.viewTag
    );

    if (!isOwner) {
      return null;
    }

    // Check token mint filter
    if (tokenMints && announcement.tokenMint) {
      const mintMatches = tokenMints.some((mint) =>
        mint.equals(announcement.tokenMint!)
      );
      if (!mintMatches) {
        return null;
      }
    }

    // Check if already claimed
    const claimed = await this.checkIfClaimed(announcement.stealthAddress);

    return {
      stealthAddress: announcement.stealthAddress,
      ephemeralPubKey: announcement.ephemeralPubKey,
      amount: announcement.amount,
      tokenMint: announcement.tokenMint,
      signature: announcement.signature,
      blockTime: announcement.blockTime,
      claimed,
      viewTag: announcement.viewTag,
    };
  }

  /**
   * Process a transaction to extract stealth payment data
   */
  private async processTransaction(
    tx: any,
    signature: string
  ): Promise<StealthPayment | null> {
    // Parse transaction logs/memo for stealth announcement
    const logs = tx.meta?.logMessages || [];

    for (const log of logs) {
      // Look for Makora program log entries
      if (log.includes('Makora:StealthTransfer')) {
        // Parse the announcement data from logs
        const announcementData = this.parseLogAnnouncement(log);
        if (announcementData) {
          // Check view tag
          if (
            !this.checkViewTag(
              announcementData.viewTag,
              announcementData.ephemeralPubKey
            )
          ) {
            continue;
          }

          // Verify ownership
          const isOwner = verifyStealthOwnership(
            announcementData.stealthAddress,
            announcementData.ephemeralPubKey,
            this.viewingPrivateKey,
            this.spendingPubKey
          );

          if (isOwner) {
            const claimed = await this.checkIfClaimed(
              announcementData.stealthAddress
            );

            return {
              stealthAddress: announcementData.stealthAddress,
              ephemeralPubKey: announcementData.ephemeralPubKey,
              amount: announcementData.amount,
              tokenMint: announcementData.tokenMint,
              signature,
              blockTime: tx.blockTime || 0,
              claimed,
              viewTag: announcementData.viewTag,
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Parse announcement data from log entry
   */
  private parseLogAnnouncement(log: string): AnnouncementData | null {
    // Implementation depends on the log format from the Makora program
    // This is a placeholder
    return null;
  }

  /**
   * Check if a stealth address has already been claimed
   */
  private async checkIfClaimed(stealthAddress: PublicKey): Promise<boolean> {
    try {
      const balance = await this.connection.getBalance(stealthAddress);
      // If balance is very low (just rent), consider it claimed
      return balance < 890880; // Minimum rent exemption
    } catch {
      return false;
    }
  }
}

/**
 * Internal type for announcement data
 */
interface AnnouncementData {
  stealthAddress: PublicKey;
  ephemeralPubKey: Uint8Array;
  viewTag: number;
  amount: bigint;
  tokenMint: PublicKey | null;
  signature: string;
  blockTime: number;
}

/**
 * Compute a view tag from shared secret
 */
function computeViewTag(sharedSecret: Uint8Array): number {
  const hash = sha256(sharedSecret);
  return hash[0]!;
}

/**
 * Scan for stealth payments using viewing key (convenience function)
 * @param connection - Solana connection
 * @param viewingPrivateKey - Viewing private key for scanning
 * @param spendingPubKey - Spending public key for verification
 * @param options - Scan options
 */
export async function scanForPayments(
  connection: Connection,
  viewingPrivateKey: Uint8Array,
  spendingPubKey: Uint8Array,
  options: ScanOptions = {}
): Promise<StealthPayment[]> {
  const scanner = new StealthScanner(connection, viewingPrivateKey, spendingPubKey);
  return scanner.scan(options);
}

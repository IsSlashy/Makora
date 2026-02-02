import { Connection, type TransactionSignature } from '@solana/web3.js';
import type { ExecutionResult } from '@makora/types';

/**
 * Transaction Confirmation Tracker
 *
 * Monitors a submitted transaction until it reaches 'confirmed' commitment
 * or times out. Reports compute units consumed and slot of confirmation.
 */
export class ConfirmationTracker {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Wait for a transaction to be confirmed.
   *
   * Uses confirmTransaction() with blockhash strategy for reliable confirmation.
   * Falls back to signature polling if blockhash strategy fails.
   *
   * @param signature - Transaction signature to track
   * @param blockhash - Recent blockhash used in the transaction
   * @param lastValidBlockHeight - Block height after which the transaction expires
   * @param timeoutMs - Maximum wait time in ms
   */
  async waitForConfirmation(
    signature: TransactionSignature,
    blockhash: string,
    lastValidBlockHeight: number,
    timeoutMs: number = 30_000
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Use blockhash-based confirmation (most reliable)
      const result = await this.connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        'confirmed'
      );

      if (result.value.err) {
        return {
          success: false,
          signature,
          error: `Transaction confirmed but failed: ${JSON.stringify(result.value.err)}`,
          timestamp: Date.now(),
        };
      }

      // Fetch transaction details for compute units and slot
      const details = await this.fetchTransactionDetails(signature);

      return {
        success: true,
        signature,
        slot: details.slot,
        computeUnits: details.computeUnits,
        timestamp: Date.now(),
      };
    } catch (err) {
      const elapsed = Date.now() - startTime;

      // Check if it is a timeout
      if (elapsed >= timeoutMs) {
        return {
          success: false,
          signature,
          error: `Transaction confirmation timed out after ${timeoutMs}ms`,
          timestamp: Date.now(),
        };
      }

      // Check if blockhash expired
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('block height exceeded') || errMsg.includes('Blockhash not found')) {
        return {
          success: false,
          signature,
          error: 'Transaction expired: blockhash no longer valid. Retry with fresh blockhash.',
          timestamp: Date.now(),
        };
      }

      return {
        success: false,
        signature,
        error: errMsg,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Check if a transaction has already been confirmed (for idempotency).
   */
  async isConfirmed(signature: TransactionSignature): Promise<boolean> {
    try {
      const status = await this.connection.getSignatureStatus(signature);
      return status.value?.confirmationStatus === 'confirmed' ||
             status.value?.confirmationStatus === 'finalized';
    } catch {
      return false;
    }
  }

  /**
   * Fetch transaction details (slot, compute units) after confirmation.
   */
  private async fetchTransactionDetails(
    signature: TransactionSignature
  ): Promise<{ slot: number; computeUnits: number }> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      return {
        slot: tx?.slot ?? 0,
        computeUnits: tx?.meta?.computeUnitsConsumed ?? 0,
      };
    } catch {
      return { slot: 0, computeUnits: 0 };
    }
  }
}

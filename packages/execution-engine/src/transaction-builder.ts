import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import type { ExecutionConfig } from './types.js';

/**
 * Transaction Builder
 *
 * Constructs VersionedTransactions with proper compute budget instructions.
 * Every transaction includes:
 * 1. SetComputeUnitLimit -- explicit CU budget (prevents default 200k limit)
 * 2. SetComputeUnitPrice -- priority fee for faster inclusion
 * 3. User instructions
 */
export class TransactionBuilder {
  private connection: Connection;
  private config: ExecutionConfig;

  constructor(connection: Connection, config: ExecutionConfig) {
    this.connection = connection;
    this.config = config;
  }

  /**
   * Build a VersionedTransaction from instructions.
   *
   * Adds ComputeBudget instructions at the beginning, fetches a fresh blockhash,
   * and creates a v0 message (supports address lookup tables in the future).
   *
   * @param instructions - User instructions (from protocol adapters)
   * @param payer - Transaction fee payer
   * @param computeUnits - Override compute unit limit (optional)
   * @param priorityFee - Override priority fee in microlamports (optional)
   */
  async build(
    instructions: TransactionInstruction[],
    payer: PublicKey,
    computeUnits?: number,
    priorityFee?: number
  ): Promise<{
    transaction: VersionedTransaction;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const cuLimit = computeUnits ?? this.config.maxComputeUnits;
    const cuPrice = priorityFee ?? this.config.priorityFeeMicroLamports;

    // Build compute budget instructions
    const computeInstructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({
        units: cuLimit,
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: cuPrice,
      }),
    ];

    // Combine: compute budget first, then user instructions
    const allInstructions = [...computeInstructions, ...instructions];

    // Fetch fresh blockhash
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');

    // Create v0 message
    const messageV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: allInstructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);

    return {
      transaction,
      blockhash,
      lastValidBlockHeight,
    };
  }

  /**
   * Rebuild a pre-built VersionedTransaction with a fresh blockhash.
   *
   * Used for retries when the original blockhash has expired.
   * NOTE: This only works for transactions where we have the original instructions.
   * For Jupiter's pre-built transactions, we must re-fetch from Jupiter.
   */
  async refreshBlockhash(
    transaction: VersionedTransaction
  ): Promise<{
    transaction: VersionedTransaction;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');

    // Create a new transaction with the same message but fresh blockhash
    // VersionedTransaction messages are immutable, so we need to reconstruct
    const message = transaction.message;

    // For V0 messages, we can update the blockhash directly on the compiled message
    // by modifying the recentBlockhash field
    const newMessage = new TransactionMessage({
      payerKey: message.staticAccountKeys[0],
      recentBlockhash: blockhash,
      instructions: message.compiledInstructions.map((ix) => {
        const programId = message.staticAccountKeys[ix.programIdIndex];
        const keys = ix.accountKeyIndexes.map((idx) => ({
          pubkey: message.staticAccountKeys[idx] ?? PublicKey.default,
          isSigner: message.isAccountSigner(idx),
          isWritable: message.isAccountWritable(idx),
        }));

        return new TransactionInstruction({
          programId,
          keys,
          data: Buffer.from(ix.data),
        });
      }),
    }).compileToV0Message();

    const newTransaction = new VersionedTransaction(newMessage);

    return {
      transaction: newTransaction,
      blockhash,
      lastValidBlockHeight,
    };
  }

  /**
   * Simulate a transaction to check for errors before sending.
   *
   * @returns null if simulation succeeds, error message if it fails.
   */
  async simulate(
    transaction: VersionedTransaction
  ): Promise<{ success: boolean; error?: string; unitsConsumed?: number }> {
    try {
      const result = await this.connection.simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });

      if (result.value.err) {
        return {
          success: false,
          error: JSON.stringify(result.value.err),
          unitsConsumed: result.value.unitsConsumed ?? undefined,
        };
      }

      return {
        success: true,
        unitsConsumed: result.value.unitsConsumed ?? undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

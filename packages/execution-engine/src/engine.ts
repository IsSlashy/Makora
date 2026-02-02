import {
  Connection,
  Keypair,
  VersionedTransaction,
  type TransactionSignature,
} from '@solana/web3.js';
import type { ExecutionResult, ProposedAction } from '@makora/types';
import { TransactionBuilder } from './transaction-builder.js';
import { ConfirmationTracker } from './confirmation.js';
import {
  type ExecutionConfig,
  type ExecutionRequest,
  type RiskValidator,
  type ExecutionState,
  type ExecutionStateCallback,
  DEFAULT_EXECUTION_CONFIG,
} from './types.js';

/**
 * Execution Engine
 *
 * Manages the complete lifecycle of a Solana transaction:
 * 1. Build -- construct VersionedTransaction with compute budget
 * 2. Simulate -- dry-run to catch errors before paying fees
 * 3. Risk Check -- validate via risk manager (VETO point)
 * 4. Sign -- sign with the provided keypair
 * 5. Send -- submit to the network
 * 6. Confirm -- wait for confirmation with timeout
 * 7. Retry -- if blockhash expired, retry with fresh blockhash
 *
 * The engine is stateless: each execute() call is independent.
 * State callbacks are provided for UI/CLI progress reporting.
 */
export class ExecutionEngine {
  private connection: Connection;
  private config: ExecutionConfig;
  private builder: TransactionBuilder;
  private tracker: ConfirmationTracker;
  private riskValidator?: RiskValidator;
  private stateCallback?: ExecutionStateCallback;

  constructor(
    connection: Connection,
    config: Partial<ExecutionConfig> = {},
    riskValidator?: RiskValidator
  ) {
    this.connection = connection;
    this.config = { ...DEFAULT_EXECUTION_CONFIG, ...config };
    this.builder = new TransactionBuilder(connection, this.config);
    this.tracker = new ConfirmationTracker(connection);
    this.riskValidator = riskValidator;
  }

  /**
   * Set or update the risk validator.
   * Called by the risk manager during initialization.
   */
  setRiskValidator(validator: RiskValidator): void {
    this.riskValidator = validator;
  }

  /**
   * Set a callback to receive execution state updates.
   * Useful for CLI spinners or dashboard progress indicators.
   */
  onStateChange(callback: ExecutionStateCallback): void {
    this.stateCallback = callback;
  }

  /**
   * Execute a transaction request.
   *
   * Full lifecycle: build -> simulate -> risk check -> sign -> send -> confirm -> retry
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await this.executeAttempt(request, attempt);

        if (result.success) {
          return result;
        }

        // Check if error is retryable
        if (result.error && this.isRetryableError(result.error)) {
          lastError = result.error;
          this.emitState({
            phase: 'failed',
            error: result.error,
            retriesLeft: this.config.maxRetries - attempt,
          });

          // Small delay before retry
          await this.sleep(1000 * attempt); // Progressive backoff
          continue;
        }

        // Non-retryable error
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);

        if (attempt < this.config.maxRetries && this.isRetryableError(lastError)) {
          this.emitState({
            phase: 'failed',
            error: lastError,
            retriesLeft: this.config.maxRetries - attempt,
          });
          await this.sleep(1000 * attempt);
          continue;
        }

        return {
          success: false,
          error: lastError,
          timestamp: Date.now(),
        };
      }
    }

    return {
      success: false,
      error: `All ${this.config.maxRetries} attempts failed. Last error: ${lastError}`,
      timestamp: Date.now(),
    };
  }

  /**
   * Execute a pre-built VersionedTransaction (e.g., from Jupiter).
   *
   * Skips the build phase. Still runs simulation, risk check, and confirmation.
   */
  async executePreBuilt(
    transaction: VersionedTransaction,
    signer: Keypair,
    description: string,
    action?: ProposedAction
  ): Promise<ExecutionResult> {
    return this.execute({
      instructions: [],
      preBuiltTransaction: transaction,
      signer,
      description,
      action,
    });
  }

  /**
   * Get the current execution configuration.
   */
  getConfig(): ExecutionConfig {
    return { ...this.config };
  }

  /**
   * Update execution configuration.
   */
  updateConfig(updates: Partial<ExecutionConfig>): void {
    this.config = { ...this.config, ...updates };
    this.builder = new TransactionBuilder(this.connection, this.config);
  }

  // ---- Private methods ----

  /**
   * A single execution attempt.
   */
  private async executeAttempt(
    request: ExecutionRequest,
    attempt: number
  ): Promise<ExecutionResult> {
    // Step 1: Build or use pre-built transaction
    this.emitState({ phase: 'building', description: request.description });

    let transaction: VersionedTransaction;
    let blockhash: string;
    let lastValidBlockHeight: number;

    if (request.preBuiltTransaction) {
      // Use pre-built transaction (e.g., from Jupiter)
      // For retries, we may need to refresh the blockhash
      if (attempt > 1) {
        const refreshed = await this.builder.refreshBlockhash(request.preBuiltTransaction);
        transaction = refreshed.transaction;
        blockhash = refreshed.blockhash;
        lastValidBlockHeight = refreshed.lastValidBlockHeight;
      } else {
        transaction = request.preBuiltTransaction;
        // Extract blockhash from the existing transaction
        const bh = await this.connection.getLatestBlockhash('confirmed');
        blockhash = bh.blockhash;
        lastValidBlockHeight = bh.lastValidBlockHeight;
      }
    } else {
      // Build from instructions
      const built = await this.builder.build(
        request.instructions,
        request.signer.publicKey,
        request.computeUnits,
        request.priorityFeeMicroLamports
      );
      transaction = built.transaction;
      blockhash = built.blockhash;
      lastValidBlockHeight = built.lastValidBlockHeight;
    }

    // Step 2: Simulate (optional)
    if (this.config.simulateBeforeSend) {
      this.emitState({ phase: 'simulating', description: request.description });

      // Need to sign before simulation
      transaction.sign([request.signer]);

      const simResult = await this.builder.simulate(transaction);
      if (!simResult.success) {
        return {
          success: false,
          error: `Simulation failed: ${simResult.error}`,
          computeUnits: simResult.unitsConsumed,
          timestamp: Date.now(),
        };
      }

      // Transaction is already signed from simulation
    } else {
      // Sign the transaction
      transaction.sign([request.signer]);
    }

    // Step 3: Risk check (if validator is configured)
    if (this.riskValidator && request.action) {
      this.emitState({ phase: 'risk_check', description: request.description });

      const assessment = await this.riskValidator.validate(request.action);
      if (!assessment.approved) {
        this.emitState({ phase: 'vetoed', reason: assessment.summary });
        return {
          success: false,
          error: `RISK VETO: ${assessment.summary}`,
          timestamp: Date.now(),
        };
      }
    }

    // Step 4: Send
    this.emitState({
      phase: 'sending',
      description: request.description,
      attempt,
    });

    const signature = await this.connection.sendTransaction(transaction, {
      skipPreflight: this.config.skipPreflight,
      maxRetries: 0, // We handle retries ourselves
    });

    // Step 5: Confirm
    this.emitState({
      phase: 'confirming',
      description: request.description,
      signature,
    });

    const result = await this.tracker.waitForConfirmation(
      signature,
      blockhash,
      lastValidBlockHeight,
      this.config.confirmationTimeoutMs
    );

    if (result.success) {
      this.emitState({ phase: 'confirmed', result });
    }

    return result;
  }

  /**
   * Check if an error is retryable.
   */
  private isRetryableError(error: string): boolean {
    const retryablePatterns = [
      'block height exceeded',
      'Blockhash not found',
      'blockhash',
      'Transaction simulation failed',
      'NodeBehind',
      'Too many requests',
      '429',
      'ECONNRESET',
      'ETIMEDOUT',
      'socket hang up',
    ];

    const lowerError = error.toLowerCase();
    return retryablePatterns.some((p) => lowerError.includes(p.toLowerCase()));
  }

  /**
   * Emit a state change to the callback.
   */
  private emitState(state: ExecutionState): void {
    if (this.stateCallback) {
      this.stateCallback(state);
    }
  }

  /**
   * Sleep helper for retry backoff.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

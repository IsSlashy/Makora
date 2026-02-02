/**
 * @makora/execution-engine - Transaction execution for Makora
 *
 * Manages the complete lifecycle of Solana transactions:
 * build -> simulate -> risk check -> sign -> send -> confirm -> retry
 *
 * Features:
 * - VersionedTransaction with explicit compute budget
 * - Pre-flight simulation to catch errors before paying fees
 * - Risk validator hook (VETO point for risk manager)
 * - Automatic retry with fresh blockhash on expiry
 * - State callbacks for progress reporting
 */

export { ExecutionEngine } from './engine.js';
export { TransactionBuilder } from './transaction-builder.js';
export { ConfirmationTracker } from './confirmation.js';
export {
  type ExecutionConfig,
  type ExecutionRequest,
  type RiskValidator,
  type ExecutionState,
  type ExecutionStateCallback,
  DEFAULT_EXECUTION_CONFIG,
} from './types.js';

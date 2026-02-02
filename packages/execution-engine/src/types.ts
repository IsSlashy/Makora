import type { TransactionInstruction, VersionedTransaction, Keypair } from '@solana/web3.js';
import type { ExecutionResult, RiskAssessment, ProposedAction } from '@makora/types';

/** Configuration for the execution engine */
export interface ExecutionConfig {
  /** Maximum compute units per transaction */
  maxComputeUnits: number;
  /** Priority fee in microlamports per compute unit */
  priorityFeeMicroLamports: number;
  /** Maximum retries for failed transactions */
  maxRetries: number;
  /** Timeout for transaction confirmation in ms */
  confirmationTimeoutMs: number;
  /** Whether to simulate before sending */
  simulateBeforeSend: boolean;
  /** Whether to skip preflight checks (faster but riskier) */
  skipPreflight: boolean;
}

/** Default execution configuration */
export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  maxComputeUnits: 400_000,
  priorityFeeMicroLamports: 50_000, // 0.05 lamports per CU
  maxRetries: 3,
  confirmationTimeoutMs: 30_000,
  simulateBeforeSend: true,
  skipPreflight: false,
};

/** What the execution engine receives to process */
export interface ExecutionRequest {
  /** Transaction instructions to execute */
  instructions: TransactionInstruction[];
  /** Or a pre-built versioned transaction (e.g., from Jupiter) */
  preBuiltTransaction?: VersionedTransaction;
  /** Signing keypair */
  signer: Keypair;
  /** Human-readable description for logging */
  description: string;
  /** Associated action (for audit trail) */
  action?: ProposedAction;
  /** Override compute units for this specific transaction */
  computeUnits?: number;
  /** Override priority fee for this specific transaction */
  priorityFeeMicroLamports?: number;
}

/**
 * Risk validator interface -- the hook point for the risk manager.
 * The execution engine calls this BEFORE sending any transaction.
 * If the validator rejects, the transaction is NOT sent.
 *
 * This interface is defined here; the actual implementation is in @makora/risk-manager (Plan 06).
 */
export interface RiskValidator {
  /**
   * Validate a proposed action before execution.
   * Returns a RiskAssessment. If approved is false, the execution engine
   * MUST NOT send the transaction.
   */
  validate(action: ProposedAction): Promise<RiskAssessment>;
}

/** Transaction execution state for monitoring */
export type ExecutionState =
  | { phase: 'building'; description: string }
  | { phase: 'simulating'; description: string }
  | { phase: 'risk_check'; description: string }
  | { phase: 'sending'; description: string; attempt: number }
  | { phase: 'confirming'; description: string; signature: string }
  | { phase: 'confirmed'; result: ExecutionResult }
  | { phase: 'failed'; error: string; retriesLeft: number }
  | { phase: 'vetoed'; reason: string };

/** Callback for execution state changes */
export type ExecutionStateCallback = (state: ExecutionState) => void;

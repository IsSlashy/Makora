import type { PublicKey } from '@solana/web3.js';
import type { AgentMode } from './common.js';
import type { RiskLimits } from './risk.js';

// ============================================================================
// Vault Program Types (matches on-chain state)
// ============================================================================

/** On-chain vault account state */
export interface VaultAccount {
  /** Wallet owner */
  owner: PublicKey;
  /** Agent's signing authority */
  agentAuthority: PublicKey;
  /** Total SOL deposited (lamports) */
  totalDeposited: bigint;
  /** Total SOL withdrawn (lamports) */
  totalWithdrawn: bigint;
  /** Current agent mode */
  mode: AgentMode;
  /** Risk limits stored on-chain */
  riskLimits: RiskLimits;
  /** Unix timestamp of vault creation */
  createdAt: number;
  /** Unix timestamp of last action */
  lastActionAt: number;
  /** PDA bump seed */
  bump: number;
}

/** Vault deposit parameters */
export interface VaultDepositParams {
  amount: bigint;
}

/** Vault withdraw parameters */
export interface VaultWithdrawParams {
  amount: bigint;
}

import type { PublicKey, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';

// ============================================================================
// Core Primitives
// ============================================================================

/** Unique identifier for a protocol adapter */
export type ProtocolId = 'jupiter' | 'raydium' | 'marinade' | 'kamino' | 'privacy';

/** Action types the agent can perform */
export type ActionType = 'swap' | 'stake' | 'unstake' | 'deposit' | 'withdraw' | 'provide_liquidity' | 'remove_liquidity' | 'shield' | 'unshield' | 'transfer';

/** Agent operating mode */
export type AgentMode = 'advisory' | 'auto';

/** OODA cycle phase */
export type OODAPhase = 'observe' | 'orient' | 'decide' | 'act';

/** Network cluster */
export type SolanaCluster = 'devnet' | 'mainnet-beta' | 'localnet';

// ============================================================================
// Token Types
// ============================================================================

/** Known token mint addresses (devnet and mainnet) */
export interface TokenInfo {
  symbol: string;
  name: string;
  mint: PublicKey;
  decimals: number;
  logoUri?: string;
  coingeckoId?: string;
}

/** Token balance with USD value */
export interface TokenBalance {
  token: TokenInfo;
  /** Raw balance in smallest unit (lamports for SOL) */
  rawBalance: bigint;
  /** Human-readable balance (e.g., 1.5 SOL) */
  uiBalance: number;
  /** USD value at current market price */
  usdValue: number;
  /** Price per token in USD */
  priceUsd: number;
}

/** Token price from an oracle or API */
export interface TokenPrice {
  mint: PublicKey;
  symbol: string;
  priceUsd: number;
  /** Confidence interval (for Pyth) */
  confidence?: number;
  /** Unix timestamp in seconds */
  timestamp: number;
  /** Source of the price data */
  source: 'pyth' | 'jupiter' | 'birdeye' | 'manual';
}

// ============================================================================
// Portfolio Types
// ============================================================================

/** Full portfolio state for the agent */
export interface PortfolioState {
  /** Wallet public key */
  owner: PublicKey;
  /** All token balances with USD values */
  balances: TokenBalance[];
  /** Total portfolio value in USD */
  totalValueUsd: number;
  /** SOL balance (convenience, always present) */
  solBalance: number;
  /** Timestamp of last update */
  lastUpdated: number;
}

/** Portfolio allocation entry (percentage-based) */
export interface AllocationEntry {
  token: TokenInfo;
  /** Current allocation as percentage (0-100) */
  currentPct: number;
  /** Target allocation as percentage (0-100) */
  targetPct?: number;
  /** USD value of this position */
  usdValue: number;
}

// ============================================================================
// Transaction Types
// ============================================================================

/** Result of executing an action on-chain */
export interface ExecutionResult {
  success: boolean;
  /** Transaction signature (base58) */
  signature?: string;
  /** Error message if failed */
  error?: string;
  /** Slot of confirmation */
  slot?: number;
  /** Compute units consumed */
  computeUnits?: number;
  /** Timestamp of confirmation */
  timestamp?: number;
}

/** Transaction status for monitoring */
export interface TransactionStatus {
  signature: string;
  status: 'pending' | 'confirmed' | 'finalized' | 'failed';
  slot?: number;
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

/** Makora global configuration */
export interface MakoraConfig {
  /** Solana cluster */
  cluster: SolanaCluster;
  /** Primary RPC endpoint */
  rpcUrl: string;
  /** Fallback RPC endpoint */
  rpcFallback?: string;
  /** Path to wallet keypair file */
  walletPath: string;
  /** Agent operating mode */
  mode: AgentMode;
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

import type { Connection, Keypair, PublicKey } from '@solana/web3.js';
import type {
  AgentMode,
  OODAPhase,
  PortfolioState,
  RiskLimits,
  SolanaCluster,
} from '@makora/types';
import type {
  AgentEvent,
  AgentEventHandler,
  DecisionCycleResult,
  ProposedAction,
  ValidatedAction,
  MarketData,
} from '@makora/types';
import type { StrategyEvaluation } from '@makora/strategy-engine';

// ============================================================================
// Agent Configuration
// ============================================================================

/** Full agent configuration */
export interface AgentConfig {
  /** Solana connection */
  connection: Connection;
  /** Agent's signing keypair */
  signer: Keypair;
  /** Wallet public key to manage */
  walletPublicKey: PublicKey;
  /** Solana cluster */
  cluster: SolanaCluster;
  /** Initial agent mode */
  mode: AgentMode;
  /** Risk limits */
  riskLimits: RiskLimits;
  /** OODA loop interval in ms (how often to run a cycle) */
  cycleIntervalMs: number;
  /** Whether to auto-start the OODA loop */
  autoStart: boolean;
  /** RPC URL */
  rpcUrl: string;
}

/** Default agent configuration */
export const DEFAULT_AGENT_CONFIG: Omit<AgentConfig, 'connection' | 'signer' | 'walletPublicKey' | 'rpcUrl'> = {
  cluster: 'devnet',
  mode: 'advisory',
  riskLimits: {
    maxPositionSizePct: 25,
    maxSlippageBps: 100,
    maxDailyLossPct: 5,
    minSolReserve: 0.05,
    maxProtocolExposurePct: 50,
  },
  cycleIntervalMs: 30_000, // 30 seconds
  autoStart: false,
};

// ============================================================================
// NL Parser Types
// ============================================================================

/** Parsed user intent from natural language */
export type ParsedIntent =
  | { type: 'swap'; amount: number; amountIsPercent: boolean; fromToken: string; toToken: string }
  | { type: 'stake'; amount: number; amountIsPercent: boolean; token: string }
  | { type: 'unstake'; amount: number; amountIsPercent: boolean; token: string }
  | { type: 'portfolio'; query: 'status' | 'allocation' | 'history' }
  | { type: 'strategy'; query: 'current' | 'opportunities' | 'rebalance' }
  | { type: 'mode'; mode: AgentMode }
  | { type: 'help' }
  | { type: 'unknown'; rawInput: string };

// ============================================================================
// User Confirmation Types
// ============================================================================

/** Callback for requesting user confirmation (advisory mode) */
export type ConfirmationCallback = (
  actions: ValidatedAction[],
  explanation: string,
) => Promise<boolean>;

/** No-op confirmation that always approves (for auto mode testing) */
export const AUTO_CONFIRM: ConfirmationCallback = async () => true;

/** No-op confirmation that always rejects (for testing) */
export const ALWAYS_REJECT: ConfirmationCallback = async () => false;

// ============================================================================
// Decision Log Types
// ============================================================================

/** A single logged decision cycle entry */
export interface DecisionLogEntry {
  /** Unique cycle ID */
  cycleId: string;
  /** Timestamp */
  timestamp: number;
  /** Agent mode at the time */
  mode: AgentMode;
  /** OODA phase durations in ms */
  phaseDurations: {
    observe: number;
    orient: number;
    decide: number;
    act: number;
    total: number;
  };
  /** Portfolio snapshot at observation */
  portfolioSnapshot: {
    totalValueUsd: number;
    solBalance: number;
    tokenCount: number;
  };
  /** Market condition summary */
  marketSummary: string;
  /** Strategy evaluation summary */
  strategySummary: string;
  /** Actions proposed */
  proposedActions: Array<{
    id: string;
    type: string;
    protocol: string;
    description: string;
  }>;
  /** Actions approved by risk manager */
  approvedActions: Array<{
    id: string;
    riskScore: number;
    summary: string;
  }>;
  /** Actions rejected by risk manager */
  rejectedActions: Array<{
    id: string;
    reason: string;
  }>;
  /** Actions executed (auto mode only) */
  executedActions: Array<{
    id: string;
    success: boolean;
    signature?: string;
    error?: string;
  }>;
  /** Whether user confirmed (advisory mode only) */
  userConfirmed?: boolean;
  /** Full decision rationale */
  rationale: string;
}

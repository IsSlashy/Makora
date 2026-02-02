import type { PublicKey } from '@solana/web3.js';
import type {
  ActionType,
  AgentMode,
  ExecutionResult,
  OODAPhase,
  PortfolioState,
  ProtocolId,
  TokenInfo,
} from './common.js';
import type { RiskAssessment } from './risk.js';

// ============================================================================
// Agent Action Types
// ============================================================================

/** A proposed action from the strategy engine (not yet validated) */
export interface ProposedAction {
  id: string;
  type: ActionType;
  protocol: ProtocolId;
  description: string;
  /** Why this action is being proposed */
  rationale: string;
  /** Expected outcome description */
  expectedOutcome: string;
  /** Input token */
  inputToken: TokenInfo;
  /** Output token (for swaps) */
  outputToken?: TokenInfo;
  /** Amount in smallest unit */
  amount: bigint;
  /** Maximum slippage in bps */
  maxSlippageBps: number;
  /** Expected USD value change */
  expectedValueChange: number;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Timestamp of proposal */
  timestamp: number;
}

/** An action that has passed risk validation */
export interface ValidatedAction extends ProposedAction {
  riskAssessment: RiskAssessment;
  /** Whether the risk manager approved this action */
  approved: boolean;
}

/** Result of an agent decision cycle */
export interface DecisionCycleResult {
  /** Current OODA phase */
  phase: OODAPhase;
  /** Actions proposed in this cycle */
  proposedActions: ProposedAction[];
  /** Actions approved by risk manager */
  approvedActions: ValidatedAction[];
  /** Actions rejected by risk manager */
  rejectedActions: ValidatedAction[];
  /** Execution results (only in auto mode) */
  executionResults?: ExecutionResult[];
  /** Duration of this cycle in ms */
  cycleTimeMs: number;
  /** Timestamp */
  timestamp: number;
}

// ============================================================================
// Market Data Types
// ============================================================================

/** Market conditions snapshot from the data feed */
export interface MarketData {
  /** SOL price in USD */
  solPriceUsd: number;
  /** 24h price change percentage */
  solChange24hPct: number;
  /** Market volatility indicator (0-100, higher = more volatile) */
  volatilityIndex: number;
  /** Total value locked across monitored protocols */
  totalTvlUsd: number;
  /** Timestamp */
  timestamp: number;
  /** Per-token prices */
  prices: Map<string, number>;
}

/** OHLCV candle data for charting */
export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

// ============================================================================
// Agent Event Types
// ============================================================================

/** Events emitted by the agent core */
export type AgentEvent =
  | { type: 'mode_changed'; mode: AgentMode }
  | { type: 'cycle_started'; phase: OODAPhase }
  | { type: 'cycle_completed'; result: DecisionCycleResult }
  | { type: 'action_proposed'; action: ProposedAction }
  | { type: 'action_approved'; action: ValidatedAction }
  | { type: 'action_rejected'; action: ValidatedAction; reason: string }
  | { type: 'action_executed'; action: ValidatedAction; result: ExecutionResult }
  | { type: 'error'; message: string; details?: unknown };

/** Handler for agent events */
export type AgentEventHandler = (event: AgentEvent) => void;

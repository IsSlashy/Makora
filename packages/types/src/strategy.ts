import type { ProtocolId, ActionType, TokenInfo } from './common.js';
import type { ProposedAction, MarketData } from './agent.js';
import type { PortfolioState } from './common.js';

// ============================================================================
// Strategy Types
// ============================================================================

/** Strategy type classification */
export type StrategyType = 'yield' | 'trading' | 'rebalance' | 'liquidity';

/** Strategy signal from the strategy engine */
export interface StrategySignal {
  strategyId: string;
  strategyName: string;
  type: StrategyType;
  /** Confidence level 0-100 */
  confidence: number;
  /** Suggested actions */
  actions: ProposedAction[];
  /** Human-readable explanation */
  explanation: string;
  /** Expected annual yield (if applicable) */
  expectedApy?: number;
  /** Risk score 0-100 (higher = riskier) */
  riskScore: number;
}

/** Strategy definition */
export interface Strategy {
  id: string;
  name: string;
  type: StrategyType;
  description: string;
  /** Which protocols this strategy uses */
  protocols: ProtocolId[];
  /** Whether this strategy is currently active */
  isActive: boolean;
  /** Strategy-specific parameters */
  parameters: Record<string, number | string | boolean>;
}

/** Strategy evaluation context */
export interface StrategyContext {
  portfolio: PortfolioState;
  marketData: MarketData;
  /** Current timestamp */
  timestamp: number;
}

/** Yield opportunity across protocols */
export interface YieldOpportunity {
  protocol: ProtocolId;
  type: 'staking' | 'lending' | 'lp' | 'vault';
  token: TokenInfo;
  tokenB?: TokenInfo;
  apy: number;
  tvlUsd: number;
  riskScore: number;
  description: string;
}

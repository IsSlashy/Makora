import type {
  PortfolioState,
  AllocationEntry,
  TokenInfo,
  ProtocolId,
} from '@makora/types';
import type { MarketData, ProposedAction } from '@makora/types';
import type { StrategySignal, YieldOpportunity, StrategyType } from '@makora/types';

// ============================================================================
// Market Analysis Types
// ============================================================================

/** Volatility regime classification */
export type VolatilityRegime = 'low' | 'moderate' | 'high' | 'extreme';

/** Market trend direction */
export type TrendDirection = 'bullish' | 'neutral' | 'bearish';

/** Comprehensive market condition assessment */
export interface MarketCondition {
  /** Current volatility regime */
  volatilityRegime: VolatilityRegime;
  /** Price trend direction */
  trendDirection: TrendDirection;
  /** Volatility index (0-100) from MarketData */
  volatilityIndex: number;
  /** 24h price change percentage */
  priceChange24h: number;
  /** Recommended strategy type based on conditions */
  recommendedStrategyType: StrategyType;
  /** Confidence in the assessment (0-100) */
  confidence: number;
  /** Human-readable summary */
  summary: string;
  /** Timestamp */
  timestamp: number;
}

// ============================================================================
// Target Allocation Types
// ============================================================================

/** Target portfolio allocation for rebalancing */
export interface TargetAllocation {
  /** Token symbol -> target percentage (must sum to 100) */
  targets: Map<string, number>;
  /** Tolerance in percentage points before rebalancing triggers */
  tolerancePct: number;
  /** Minimum trade size in USD to avoid dust trades */
  minTradeSizeUsd: number;
}

/** Rebalance action with computed amounts */
export interface RebalanceAction {
  /** The proposed action to execute */
  action: ProposedAction;
  /** Current allocation percentage for this token */
  currentPct: number;
  /** Target allocation percentage */
  targetPct: number;
  /** Deviation from target (current - target) */
  deviationPct: number;
}

// ============================================================================
// Strategy Configuration
// ============================================================================

/** Configuration for the strategy engine */
export interface StrategyEngineConfig {
  /** Default strategy to use when no market data is available */
  defaultStrategyType: StrategyType;
  /** How often to re-evaluate strategies (ms) */
  evaluationIntervalMs: number;
  /** Maximum number of actions to propose per cycle */
  maxActionsPerCycle: number;
  /** Minimum confidence threshold to propose an action (0-100) */
  minConfidenceThreshold: number;
  /** Yield sources to consider */
  yieldSources: YieldSourceConfig[];
}

/** Configuration for a yield source */
export interface YieldSourceConfig {
  protocol: ProtocolId;
  type: 'staking' | 'lending' | 'lp' | 'vault';
  enabled: boolean;
  /** Hardcoded or fetched APY (fetched at runtime when possible) */
  baseApy: number;
  /** Risk multiplier (1.0 = baseline, >1.0 = riskier, <1.0 = safer) */
  riskMultiplier: number;
  /** Minimum TVL in USD to consider this source */
  minTvlUsd: number;
}

/** Default engine configuration */
export const DEFAULT_ENGINE_CONFIG: StrategyEngineConfig = {
  defaultStrategyType: 'yield',
  evaluationIntervalMs: 30_000, // 30 seconds
  maxActionsPerCycle: 5,
  minConfidenceThreshold: 40,
  yieldSources: [
    {
      protocol: 'marinade',
      type: 'staking',
      enabled: true,
      baseApy: 7.2,
      riskMultiplier: 0.3,
      minTvlUsd: 100_000_000,
    },
    {
      protocol: 'jupiter',
      type: 'lending',
      enabled: true,
      baseApy: 5.5,
      riskMultiplier: 0.5,
      minTvlUsd: 50_000_000,
    },
    {
      protocol: 'raydium',
      type: 'lp',
      enabled: true,
      baseApy: 15.0,
      riskMultiplier: 1.2,
      minTvlUsd: 10_000_000,
    },
    {
      protocol: 'kamino',
      type: 'vault',
      enabled: true,
      baseApy: 12.0,
      riskMultiplier: 0.8,
      minTvlUsd: 20_000_000,
    },
  ],
};

/** Interface that all strategy implementations must satisfy */
export interface StrategyImplementation {
  readonly id: string;
  readonly name: string;
  readonly type: StrategyType;
  readonly description: string;

  /**
   * Evaluate the current portfolio and market conditions.
   * Return a StrategySignal with proposed actions, confidence, and explanation.
   */
  evaluate(
    portfolio: PortfolioState,
    marketCondition: MarketCondition,
    yieldOpportunities: YieldOpportunity[],
  ): StrategySignal;
}

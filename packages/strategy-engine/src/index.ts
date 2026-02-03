/**
 * @makora/strategy-engine - Adaptive strategy engine for Makora
 *
 * Evaluates portfolio state against market conditions and produces
 * ranked, actionable strategy signals.
 *
 * Components:
 * - StrategyEngine: main orchestrator (evaluate -> rank -> recommend)
 * - MarketAnalyzer: classifies market conditions (volatility, trend)
 * - YieldOptimizer: finds best risk-adjusted yield across protocols
 * - Rebalancer: computes trades to match target allocation
 * - Strategies: conservative, balanced, aggressive implementations
 */

export { StrategyEngine, type StrategyEvaluation } from './engine.js';
export { MarketAnalyzer } from './market-analyzer.js';
export { YieldOptimizer } from './yield-optimizer.js';
export { Rebalancer, DEFAULT_TARGET_ALLOCATION } from './rebalancer.js';
export { ConservativeStrategy } from './strategies/conservative.js';
export { BalancedStrategy } from './strategies/balanced.js';
export { AggressiveStrategy } from './strategies/aggressive.js';
export {
  type MarketCondition,
  type VolatilityRegime,
  type TrendDirection,
  type TargetAllocation,
  type RebalanceAction,
  type StrategyEngineConfig,
  type YieldSourceConfig,
  type StrategyImplementation,
  DEFAULT_ENGINE_CONFIG,
} from './types.js';

import type {
  PortfolioState,
  YieldOpportunity,
} from '@makora/types';
import type { MarketData, ProposedAction } from '@makora/types';
import type { StrategySignal, StrategyType } from '@makora/types';
import { MarketAnalyzer } from './market-analyzer.js';
import { YieldOptimizer } from './yield-optimizer.js';
import { Rebalancer, DEFAULT_TARGET_ALLOCATION } from './rebalancer.js';
import { ConservativeStrategy } from './strategies/conservative.js';
import { BalancedStrategy } from './strategies/balanced.js';
import { AggressiveStrategy } from './strategies/aggressive.js';
import type {
  StrategyEngineConfig,
  StrategyImplementation,
  MarketCondition,
  TargetAllocation,
} from './types.js';
import { DEFAULT_ENGINE_CONFIG } from './types.js';

/**
 * Evaluation result from the strategy engine.
 * Contains multiple ranked signals for the agent core to choose from.
 */
export interface StrategyEvaluation {
  /** Ranked strategy signals (best first based on market conditions) */
  signals: StrategySignal[];
  /** The recommended signal (first in the list) */
  recommended: StrategySignal;
  /** Market condition assessment */
  marketCondition: MarketCondition;
  /** Available yield opportunities */
  yieldOpportunities: YieldOpportunity[];
  /** Timestamp of this evaluation */
  timestamp: number;
  /** Duration of evaluation in ms */
  evaluationTimeMs: number;
}

/**
 * Strategy Engine (STRAT-01, STRAT-02, STRAT-03)
 *
 * The central intelligence that evaluates portfolio state against market
 * conditions and produces ranked, actionable strategy signals.
 *
 * Flow:
 * 1. MarketAnalyzer assesses market conditions (volatility, trend)
 * 2. YieldOptimizer finds available yield opportunities
 * 3. All strategy implementations evaluate the situation
 * 4. Signals are ranked by suitability to market conditions
 * 5. Top signal's actions feed into the agent core's decision phase
 *
 * Adaptation logic:
 * - High/extreme volatility -> Conservative wins (staking-only, safe)
 * - Moderate volatility -> Balanced wins (maintain allocation)
 * - Low volatility + bullish -> Aggressive wins (LP + vaults)
 * - The engine never forces a strategy -- it ranks by confidence
 */
export class StrategyEngine {
  private config: StrategyEngineConfig;
  private marketAnalyzer: MarketAnalyzer;
  private yieldOptimizer: YieldOptimizer;
  private rebalancer: Rebalancer;
  private strategies: StrategyImplementation[];

  /** Last evaluation result (cached for the dashboard) */
  private lastEvaluation: StrategyEvaluation | null = null;

  constructor(config: Partial<StrategyEngineConfig> = {}) {
    this.config = { ...DEFAULT_ENGINE_CONFIG, ...config };
    this.marketAnalyzer = new MarketAnalyzer();
    this.yieldOptimizer = new YieldOptimizer(this.config.yieldSources);
    this.rebalancer = new Rebalancer();

    // Register all strategy implementations
    this.strategies = [
      new ConservativeStrategy(),
      new BalancedStrategy(),
      new AggressiveStrategy(),
    ];
  }

  /**
   * Evaluate the current portfolio and market conditions.
   *
   * This is the main entry point. The agent core calls this during
   * the OODA Orient phase.
   *
   * @param portfolio - Current portfolio state from data feed
   * @param marketData - Current market data from data feed
   * @returns Ranked strategy signals with the recommended signal first
   */
  evaluate(portfolio: PortfolioState, marketData: MarketData): StrategyEvaluation {
    const startTime = Date.now();

    // Step 1: Analyze market conditions
    const marketCondition = this.marketAnalyzer.analyze(marketData);

    // Step 2: Find yield opportunities
    const yieldOpportunities = this.yieldOptimizer.findOpportunities(
      portfolio,
      marketCondition,
    );

    // Step 3: Evaluate all strategies
    const signals: StrategySignal[] = [];

    for (const strategy of this.strategies) {
      try {
        const signal = strategy.evaluate(portfolio, marketCondition, yieldOpportunities);

        // Filter out signals below confidence threshold
        if (signal.confidence >= this.config.minConfidenceThreshold) {
          // Cap actions per signal
          if (signal.actions.length > this.config.maxActionsPerCycle) {
            signal.actions = signal.actions.slice(0, this.config.maxActionsPerCycle);
          }
          signals.push(signal);
        }
      } catch (err) {
        console.warn(`Strategy ${strategy.id} evaluation failed:`, err);
      }
    }

    // Step 4: Rank signals by market suitability
    this.rankSignals(signals, marketCondition);

    // Ensure we always have at least one signal
    if (signals.length === 0) {
      signals.push(this.buildNoOpSignal(marketCondition));
    }

    const evaluation: StrategyEvaluation = {
      signals,
      recommended: signals[0],
      marketCondition,
      yieldOpportunities,
      timestamp: Date.now(),
      evaluationTimeMs: Date.now() - startTime,
    };

    this.lastEvaluation = evaluation;
    return evaluation;
  }

  /**
   * Get the last evaluation result (for dashboard/CLI display).
   */
  getLastEvaluation(): StrategyEvaluation | null {
    return this.lastEvaluation;
  }

  /**
   * Get the market analyzer (for direct market queries).
   */
  getMarketAnalyzer(): MarketAnalyzer {
    return this.marketAnalyzer;
  }

  /**
   * Get the yield optimizer (for direct yield queries).
   */
  getYieldOptimizer(): YieldOptimizer {
    return this.yieldOptimizer;
  }

  /**
   * Get the rebalancer (for direct rebalancing queries).
   */
  getRebalancer(): Rebalancer {
    return this.rebalancer;
  }

  /**
   * Update engine configuration.
   */
  updateConfig(updates: Partial<StrategyEngineConfig>): void {
    this.config = { ...this.config, ...updates };
    if (updates.yieldSources) {
      this.yieldOptimizer = new YieldOptimizer(updates.yieldSources);
    }
  }

  /**
   * Get all registered strategies.
   */
  getStrategies(): Array<{ id: string; name: string; type: StrategyType; description: string }> {
    return this.strategies.map((s) => ({
      id: s.id,
      name: s.name,
      type: s.type,
      description: s.description,
    }));
  }

  // ---- Private ----

  /**
   * Rank signals by how well they match the current market conditions.
   * Mutates the array in place (sorts).
   *
   * Ranking logic:
   * - Each strategy type has a "fitness" score for the current market condition
   * - Confidence acts as a tiebreaker
   * - Final score = fitness * 0.6 + confidence * 0.4
   */
  private rankSignals(signals: StrategySignal[], marketCondition: MarketCondition): void {
    const fitnessScores = new Map<string, number>();

    for (const signal of signals) {
      const fitness = this.computeFitness(signal.type, marketCondition);
      fitnessScores.set(signal.strategyId, fitness);
    }

    signals.sort((a, b) => {
      const fitnessA = fitnessScores.get(a.strategyId) ?? 0;
      const fitnessB = fitnessScores.get(b.strategyId) ?? 0;

      const scoreA = fitnessA * 0.6 + a.confidence * 0.4;
      const scoreB = fitnessB * 0.6 + b.confidence * 0.4;

      return scoreB - scoreA; // Descending
    });
  }

  /**
   * Compute fitness of a strategy type for the current market conditions.
   * Returns 0-100.
   */
  private computeFitness(strategyType: StrategyType, condition: MarketCondition): number {
    // Fitness matrix: [strategyType][volatilityRegime] -> base fitness
    const fitnessMatrix: Record<StrategyType, Record<string, number>> = {
      yield: { low: 60, moderate: 70, high: 90, extreme: 100 },
      rebalance: { low: 70, moderate: 85, high: 60, extreme: 30 },
      liquidity: { low: 90, moderate: 65, high: 35, extreme: 10 },
      trading: { low: 50, moderate: 60, high: 40, extreme: 15 },
    };

    let fitness = fitnessMatrix[strategyType]?.[condition.volatilityRegime] ?? 50;

    // Trend adjustments
    if (condition.trendDirection === 'bullish') {
      if (strategyType === 'liquidity') fitness += 15;
      if (strategyType === 'yield') fitness -= 5;
    }
    if (condition.trendDirection === 'bearish') {
      if (strategyType === 'yield') fitness += 10;
      if (strategyType === 'liquidity') fitness -= 15;
    }

    return Math.min(100, Math.max(0, fitness));
  }

  /**
   * Build a no-op signal when no strategy has actionable suggestions.
   */
  private buildNoOpSignal(marketCondition: MarketCondition): StrategySignal {
    return {
      strategyId: 'hold',
      strategyName: 'Hold Position',
      type: 'yield',
      confidence: 30,
      actions: [],
      explanation: `No actionable strategies at this time. ${marketCondition.summary} Portfolio is stable.`,
      expectedApy: 0,
      riskScore: 0,
    };
  }
}

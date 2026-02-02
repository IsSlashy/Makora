---
phase: 03-agent-intelligence
plan: 07
type: execute
wave: 1
depends_on: [04, 05, 06]
files_modified:
  - packages/strategy-engine/package.json
  - packages/strategy-engine/tsconfig.json
  - packages/strategy-engine/src/index.ts
  - packages/strategy-engine/src/engine.ts
  - packages/strategy-engine/src/yield-optimizer.ts
  - packages/strategy-engine/src/rebalancer.ts
  - packages/strategy-engine/src/market-analyzer.ts
  - packages/strategy-engine/src/strategies/conservative.ts
  - packages/strategy-engine/src/strategies/balanced.ts
  - packages/strategy-engine/src/strategies/aggressive.ts
  - packages/strategy-engine/src/strategies/index.ts
  - packages/strategy-engine/src/types.ts
autonomous: true
must_haves:
  truths:
    - "`pnpm build` compiles @makora/strategy-engine without errors"
    - "StrategyEngine.evaluate(portfolio, marketData) returns ranked StrategySignal[] with expectedApy and riskScore"
    - "YieldOptimizer.findOpportunities() returns YieldOpportunity[] sorted by risk-adjusted yield"
    - "Rebalancer.computeRebalance(portfolio, targetAllocation) returns ProposedAction[] that move portfolio toward target"
    - "MarketAnalyzer.analyze() returns MarketCondition with volatilityRegime and trendDirection"
    - "Conservative strategy proposes staking-only actions with riskScore < 30"
    - "Aggressive strategy proposes LP + vault actions with higher expected APY"
    - "Engine adapts strategy selection based on market volatility (high vol -> conservative)"
  artifacts:
    - packages/strategy-engine/dist/index.js
---

# Plan 07: Strategy Engine (@makora/strategy-engine)

## Objective

Build the adaptive strategy engine that evaluates portfolio state against market conditions and produces ranked, actionable `StrategySignal[]` with yield estimates and risk scores. This engine is the "brain" that tells the agent core WHAT to do.

After this plan completes:
- The engine evaluates a portfolio and returns ranked strategy signals with expected APY and risk scores
- The yield optimizer finds the best risk-adjusted yield across Jupiter, Marinade, Raydium, and Kamino
- The rebalancer computes concrete `ProposedAction[]` to move a portfolio toward a target allocation
- The engine adapts its strategy selection based on market volatility (high vol = conservative, low vol = aggressive)

## Context

- **Data flow**: `PortfolioReader` (from `@makora/data-feed`) feeds portfolio state. `JupiterPriceFeed` feeds price data. The strategy engine consumes both and produces `StrategySignal[]` (defined in `@makora/types/strategy.ts`).
- **Output consumer**: The agent core (Plan 08) calls `engine.evaluate()` during the OODA Orient phase, then passes the top signal's actions to the risk manager for validation.
- **Type contracts**: `StrategySignal`, `Strategy`, `StrategyContext`, `YieldOpportunity` are already defined in `@makora/types/strategy.ts`. `ProposedAction` is in `@makora/types/agent.ts`. `PortfolioState`, `AllocationEntry` are in `@makora/types/common.ts`.
- **Protocol awareness**: The engine knows about protocols (Jupiter, Marinade, Raydium, Kamino) at a data level only (yield rates, TVL, APY). It does NOT call adapters directly -- it produces `ProposedAction` objects that the agent core passes to the protocol router.
- **Adaptive behavior**: The engine selects strategies based on a `MarketCondition` assessment. In high volatility, it favors conservative strategies (staking). In low volatility, it can recommend LP or vault strategies.

## Tasks

### Task 1: Package Setup

**File: `P:\solana-agent-hackathon\packages\strategy-engine\package.json`**

```json
{
  "name": "@makora/strategy-engine",
  "version": "0.1.0",
  "private": true,
  "description": "Adaptive strategy engine for Makora - evaluates market conditions and produces ranked DeFi strategies",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "src"],
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts --clean",
    "dev": "tsup src/index.ts --format cjs,esm --dts --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@makora/types": "workspace:*",
    "@solana/web3.js": "^1.98.4"
  },
  "devDependencies": {
    "tsup": "^8.0.1",
    "typescript": "^5.3.0",
    "rimraf": "^5.0.0",
    "vitest": "^4.0.17"
  }
}
```

**File: `P:\solana-agent-hackathon\packages\strategy-engine\tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

### Task 2: Internal Types

Types local to the strategy engine that are NOT exported from `@makora/types`.

**File: `P:\solana-agent-hackathon\packages\strategy-engine\src\types.ts`**

```typescript
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
```

### Task 3: Market Analyzer

Assesses current market conditions to inform strategy selection.

**File: `P:\solana-agent-hackathon\packages\strategy-engine\src\market-analyzer.ts`**

```typescript
import type { MarketData } from '@makora/types';
import type { StrategyType } from '@makora/types';
import type { MarketCondition, VolatilityRegime, TrendDirection } from './types.js';

/**
 * Market Analyzer
 *
 * Assesses current market conditions from MarketData to produce a
 * MarketCondition that drives strategy selection. This is the "Orient"
 * phase of the OODA loop -- converting raw observations into a situational
 * assessment.
 *
 * Classification rules:
 * - Volatility: based on volatilityIndex (0-100)
 *   - low: 0-20
 *   - moderate: 21-45
 *   - high: 46-70
 *   - extreme: 71-100
 *
 * - Trend: based on 24h price change
 *   - bullish: > +3%
 *   - neutral: -3% to +3%
 *   - bearish: < -3%
 *
 * - Strategy recommendation:
 *   - extreme volatility -> yield (staking = safe haven)
 *   - high volatility + bearish -> yield (defensive)
 *   - low volatility + bullish -> liquidity (maximize exposure)
 *   - moderate conditions -> rebalance (maintain allocation)
 */
export class MarketAnalyzer {
  /**
   * Analyze market conditions from a MarketData snapshot.
   */
  analyze(marketData: MarketData): MarketCondition {
    const volatilityRegime = this.classifyVolatility(marketData.volatilityIndex);
    const trendDirection = this.classifyTrend(marketData.solChange24hPct);
    const recommendedStrategyType = this.recommendStrategy(volatilityRegime, trendDirection);
    const confidence = this.calculateConfidence(marketData);

    const summary = this.buildSummary(volatilityRegime, trendDirection, recommendedStrategyType);

    return {
      volatilityRegime,
      trendDirection,
      volatilityIndex: marketData.volatilityIndex,
      priceChange24h: marketData.solChange24hPct,
      recommendedStrategyType,
      confidence,
      summary,
      timestamp: Date.now(),
    };
  }

  /**
   * Build a synthetic MarketData from minimal inputs.
   * Useful when full market data is not available (e.g., on startup).
   */
  buildDefaultMarketData(solPriceUsd: number): MarketData {
    return {
      solPriceUsd,
      solChange24hPct: 0,
      volatilityIndex: 30, // moderate default
      totalTvlUsd: 0,
      timestamp: Date.now(),
      prices: new Map([['So11111111111111111111111111111111', solPriceUsd]]),
    };
  }

  // ---- Private ----

  private classifyVolatility(index: number): VolatilityRegime {
    if (index <= 20) return 'low';
    if (index <= 45) return 'moderate';
    if (index <= 70) return 'high';
    return 'extreme';
  }

  private classifyTrend(change24hPct: number): TrendDirection {
    if (change24hPct > 3) return 'bullish';
    if (change24hPct < -3) return 'bearish';
    return 'neutral';
  }

  private recommendStrategy(
    volatility: VolatilityRegime,
    trend: TrendDirection
  ): StrategyType {
    // Extreme volatility -> always go defensive (yield/staking)
    if (volatility === 'extreme') return 'yield';

    // High volatility + bearish -> defensive
    if (volatility === 'high' && trend === 'bearish') return 'yield';

    // High volatility + bullish -> could be opportunity, but stay cautious
    if (volatility === 'high' && trend === 'bullish') return 'rebalance';

    // Low volatility + bullish -> maximize exposure
    if (volatility === 'low' && trend === 'bullish') return 'liquidity';

    // Low volatility + neutral/bearish -> yield (stable environment)
    if (volatility === 'low') return 'yield';

    // Moderate everything -> rebalance to maintain target
    return 'rebalance';
  }

  private calculateConfidence(marketData: MarketData): number {
    // Confidence is higher when data is fresh and consistent
    let confidence = 60; // baseline

    // Penalize stale data (> 60 seconds old)
    const ageMs = Date.now() - marketData.timestamp;
    if (ageMs > 60_000) confidence -= 15;
    if (ageMs > 300_000) confidence -= 25;

    // Higher confidence when volatility is clearly in a regime (not borderline)
    const vol = marketData.volatilityIndex;
    if (vol < 10 || vol > 80) confidence += 15; // clear regime
    if (vol > 18 && vol < 22) confidence -= 10; // borderline low/moderate
    if (vol > 43 && vol < 47) confidence -= 10; // borderline moderate/high

    // Higher confidence when trend is strong
    const absChange = Math.abs(marketData.solChange24hPct);
    if (absChange > 8) confidence += 10;
    if (absChange < 1) confidence += 5; // clearly neutral

    return Math.min(100, Math.max(0, confidence));
  }

  private buildSummary(
    volatility: VolatilityRegime,
    trend: TrendDirection,
    strategy: StrategyType
  ): string {
    const volDesc = {
      low: 'Low volatility',
      moderate: 'Moderate volatility',
      high: 'High volatility',
      extreme: 'Extreme volatility',
    }[volatility];

    const trendDesc = {
      bullish: 'bullish trend',
      neutral: 'neutral market',
      bearish: 'bearish trend',
    }[trend];

    const strategyDesc = {
      yield: 'defensive yield strategies (staking, lending)',
      rebalance: 'portfolio rebalancing to maintain targets',
      liquidity: 'increased liquidity provision for higher yields',
      trading: 'active trading positions',
    }[strategy];

    return `${volDesc} with ${trendDesc}. Recommending ${strategyDesc}.`;
  }
}
```

### Task 4: Yield Optimizer

Finds the best risk-adjusted yield opportunities across all protocols.

**File: `P:\solana-agent-hackathon\packages\strategy-engine\src\yield-optimizer.ts`**

```typescript
import { PublicKey } from '@solana/web3.js';
import type {
  PortfolioState,
  ProtocolId,
  TokenInfo,
  YieldOpportunity,
} from '@makora/types';
import type { YieldSourceConfig, MarketCondition } from './types.js';

/**
 * Yield Optimizer (STRAT-02)
 *
 * Finds the highest risk-adjusted yield across all configured protocols.
 * Ranks opportunities by a Sharpe-like score: (APY - riskPenalty) / riskScore.
 *
 * Yield sources:
 * - Marinade: SOL liquid staking (~7.2% APY, very low risk)
 * - Jupiter: lending markets (~5.5% APY, low risk)
 * - Raydium: LP positions (~15% APY, medium-high risk due to IL)
 * - Kamino: automated vaults (~12% APY, medium risk)
 *
 * Risk adjustment:
 * - Each source has a riskMultiplier (0.0 - 2.0)
 * - Risk-adjusted score = APY / (1 + riskMultiplier * volatilityFactor)
 * - In high volatility, LP/vault risk is amplified; staking stays attractive
 */
export class YieldOptimizer {
  private yieldSources: YieldSourceConfig[];

  constructor(yieldSources: YieldSourceConfig[]) {
    this.yieldSources = yieldSources;
  }

  /**
   * Find all yield opportunities ranked by risk-adjusted return.
   *
   * @param portfolio - Current portfolio state (to know available tokens)
   * @param marketCondition - Current market assessment (for risk adjustment)
   * @returns Sorted yield opportunities, best first
   */
  findOpportunities(
    portfolio: PortfolioState,
    marketCondition: MarketCondition
  ): YieldOpportunity[] {
    const opportunities: YieldOpportunity[] = [];

    for (const source of this.yieldSources) {
      if (!source.enabled) continue;

      const opportunity = this.buildOpportunity(source, portfolio, marketCondition);
      if (opportunity) {
        opportunities.push(opportunity);
      }
    }

    // Sort by risk-adjusted yield (highest first)
    opportunities.sort((a, b) => {
      const scoreA = this.riskAdjustedScore(a, marketCondition);
      const scoreB = this.riskAdjustedScore(b, marketCondition);
      return scoreB - scoreA;
    });

    return opportunities;
  }

  /**
   * Get the single best yield opportunity for idle SOL.
   */
  bestForIdleSol(
    portfolio: PortfolioState,
    marketCondition: MarketCondition
  ): YieldOpportunity | null {
    const opportunities = this.findOpportunities(portfolio, marketCondition);

    // Filter to opportunities that accept SOL as input
    const solOpportunities = opportunities.filter(
      (o) => o.token.symbol === 'SOL' || o.type === 'staking'
    );

    return solOpportunities[0] ?? null;
  }

  /**
   * Calculate the risk-adjusted score for an opportunity.
   * Higher is better.
   */
  riskAdjustedScore(
    opportunity: YieldOpportunity,
    marketCondition: MarketCondition
  ): number {
    // Volatility factor: 0.0 (low vol) to 2.0 (extreme vol)
    const volFactor = marketCondition.volatilityIndex / 50;

    // Risk-adjusted return
    const riskPenalty = opportunity.riskScore * volFactor * 0.1;
    const adjustedApy = opportunity.apy - riskPenalty;

    // Normalize by risk (higher risk should need proportionally higher APY)
    const riskDivisor = 1 + (opportunity.riskScore / 100);
    return adjustedApy / riskDivisor;
  }

  /**
   * Update yield source APYs with fresh data.
   * Call this when new protocol data is available.
   */
  updateYieldRates(updates: Array<{ protocol: ProtocolId; apy: number }>): void {
    for (const update of updates) {
      const source = this.yieldSources.find((s) => s.protocol === update.protocol);
      if (source) {
        source.baseApy = update.apy;
      }
    }
  }

  // ---- Private ----

  private buildOpportunity(
    source: YieldSourceConfig,
    portfolio: PortfolioState,
    marketCondition: MarketCondition
  ): YieldOpportunity | null {
    // Build the token info for this opportunity
    const token = this.getTokenForSource(source, portfolio);
    if (!token) return null;

    // Compute risk score (0-100) based on source type and market conditions
    const riskScore = this.computeRiskScore(source, marketCondition);

    // Build description
    const description = this.describeOpportunity(source, riskScore);

    return {
      protocol: source.protocol,
      type: source.type,
      token,
      apy: source.baseApy,
      tvlUsd: source.minTvlUsd, // Use minTvl as a proxy; real data in production
      riskScore,
      description,
    };
  }

  private getTokenForSource(
    source: YieldSourceConfig,
    portfolio: PortfolioState
  ): TokenInfo | null {
    switch (source.type) {
      case 'staking':
        // Staking uses SOL
        return portfolio.balances.find((b) => b.token.symbol === 'SOL')?.token ?? null;
      case 'lending':
        // Lending can use SOL or USDC
        return (
          portfolio.balances.find((b) => b.token.symbol === 'USDC')?.token ??
          portfolio.balances.find((b) => b.token.symbol === 'SOL')?.token ??
          null
        );
      case 'lp':
        // LP uses SOL (SOL/USDC pair)
        return portfolio.balances.find((b) => b.token.symbol === 'SOL')?.token ?? null;
      case 'vault':
        // Vault can accept various tokens
        return portfolio.balances.find((b) => b.token.symbol === 'SOL')?.token ?? null;
      default:
        return null;
    }
  }

  private computeRiskScore(
    source: YieldSourceConfig,
    marketCondition: MarketCondition
  ): number {
    // Base risk by type
    const baseRisk: Record<string, number> = {
      staking: 10,
      lending: 25,
      vault: 40,
      lp: 60,
    };

    let risk = baseRisk[source.type] ?? 50;

    // Apply source-specific multiplier
    risk *= source.riskMultiplier;

    // Amplify risk in volatile markets
    if (marketCondition.volatilityRegime === 'high') {
      risk *= 1.3;
    } else if (marketCondition.volatilityRegime === 'extreme') {
      risk *= 1.8;
    }

    // Reduce risk in calm markets
    if (marketCondition.volatilityRegime === 'low') {
      risk *= 0.8;
    }

    return Math.min(100, Math.max(0, Math.round(risk)));
  }

  private describeOpportunity(source: YieldSourceConfig, riskScore: number): string {
    const riskLabel =
      riskScore < 20 ? 'Very Low Risk' :
      riskScore < 40 ? 'Low Risk' :
      riskScore < 60 ? 'Medium Risk' :
      riskScore < 80 ? 'High Risk' :
      'Very High Risk';

    const typeDesc: Record<string, string> = {
      staking: 'Liquid staking',
      lending: 'Lending market',
      lp: 'Liquidity provision',
      vault: 'Automated vault',
    };

    const protocolNames: Record<string, string> = {
      marinade: 'Marinade Finance',
      jupiter: 'Jupiter',
      raydium: 'Raydium',
      kamino: 'Kamino Finance',
    };

    return `${typeDesc[source.type] ?? source.type} via ${protocolNames[source.protocol] ?? source.protocol} — ${source.baseApy.toFixed(1)}% APY (${riskLabel})`;
  }
}
```

### Task 5: Portfolio Rebalancer

Computes concrete rebalancing actions to move a portfolio toward target allocation.

**File: `P:\solana-agent-hackathon\packages\strategy-engine\src\rebalancer.ts`**

```typescript
import { PublicKey } from '@solana/web3.js';
import { randomUUID } from 'crypto';
import type {
  PortfolioState,
  AllocationEntry,
  TokenInfo,
  ActionType,
  ProtocolId,
} from '@makora/types';
import type { ProposedAction } from '@makora/types';
import type { TargetAllocation, RebalanceAction } from './types.js';

/**
 * Default target allocation for a balanced Solana portfolio.
 *
 * Conservative default:
 * - 50% SOL (base asset)
 * - 30% mSOL (staked SOL via Marinade -- yield-bearing)
 * - 20% USDC (stablecoin -- hedge)
 */
export const DEFAULT_TARGET_ALLOCATION: TargetAllocation = {
  targets: new Map([
    ['SOL', 50],
    ['mSOL', 30],
    ['USDC', 20],
  ]),
  tolerancePct: 5, // Rebalance when off by >5%
  minTradeSizeUsd: 5, // Ignore trades smaller than $5
};

/**
 * Portfolio Rebalancer (STRAT-03)
 *
 * Computes the trades needed to move the current portfolio toward a target
 * allocation. Produces a list of ProposedAction objects ready for risk
 * validation and execution.
 *
 * Algorithm:
 * 1. Calculate current allocation percentages for each token
 * 2. Compare each against its target
 * 3. Tokens above target -> sell (swap to under-target tokens)
 * 4. Tokens below target -> buy (receive from over-target swaps)
 * 5. Filter out trades below minTradeSizeUsd (dust)
 * 6. Order: sells first, then buys (to free up capital)
 *
 * Special handling:
 * - mSOL is acquired via Marinade stake (not Jupiter swap)
 * - SOL reserves for gas are never touched
 */
export class Rebalancer {
  /**
   * Compute rebalancing actions for the portfolio.
   *
   * @param portfolio - Current portfolio state
   * @param target - Target allocation (defaults to conservative)
   * @param walletPublicKey - User's wallet for building actions
   * @returns RebalanceAction[] ordered by execution priority
   */
  computeRebalance(
    portfolio: PortfolioState,
    target: TargetAllocation = DEFAULT_TARGET_ALLOCATION,
    walletPublicKey?: PublicKey,
  ): RebalanceAction[] {
    if (portfolio.totalValueUsd === 0) {
      return []; // Nothing to rebalance
    }

    // Step 1: Build current allocation map
    const currentAllocation = this.buildCurrentAllocation(portfolio);

    // Step 2: Compute deviations
    const deviations = this.computeDeviations(currentAllocation, target);

    // Step 3: Filter deviations outside tolerance
    const actionableDeviations = deviations.filter(
      (d) => Math.abs(d.deviationPct) > target.tolerancePct
    );

    if (actionableDeviations.length === 0) {
      return []; // Portfolio is within tolerance
    }

    // Step 4: Generate actions
    const actions = this.generateActions(
      actionableDeviations,
      portfolio,
      target,
      walletPublicKey,
    );

    // Step 5: Sort (sells first, then buys)
    actions.sort((a, b) => {
      // Over-allocated (sells) before under-allocated (buys)
      if (a.deviationPct > 0 && b.deviationPct <= 0) return -1;
      if (a.deviationPct <= 0 && b.deviationPct > 0) return 1;
      // Within same category, larger deviations first
      return Math.abs(b.deviationPct) - Math.abs(a.deviationPct);
    });

    return actions;
  }

  /**
   * Check if the portfolio needs rebalancing.
   */
  needsRebalance(
    portfolio: PortfolioState,
    target: TargetAllocation = DEFAULT_TARGET_ALLOCATION,
  ): boolean {
    return this.computeRebalance(portfolio, target).length > 0;
  }

  /**
   * Get the current allocation as a human-readable table.
   */
  getAllocationTable(
    portfolio: PortfolioState,
    target: TargetAllocation = DEFAULT_TARGET_ALLOCATION,
  ): AllocationEntry[] {
    const entries: AllocationEntry[] = [];

    for (const balance of portfolio.balances) {
      const currentPct = portfolio.totalValueUsd > 0
        ? (balance.usdValue / portfolio.totalValueUsd) * 100
        : 0;

      const targetPct = target.targets.get(balance.token.symbol);

      entries.push({
        token: balance.token,
        currentPct: Math.round(currentPct * 10) / 10,
        targetPct,
        usdValue: balance.usdValue,
      });
    }

    // Sort by current allocation descending
    entries.sort((a, b) => b.currentPct - a.currentPct);

    return entries;
  }

  // ---- Private ----

  private buildCurrentAllocation(
    portfolio: PortfolioState
  ): Map<string, { pct: number; balance: typeof portfolio.balances[0] }> {
    const allocation = new Map<string, { pct: number; balance: typeof portfolio.balances[0] }>();

    for (const balance of portfolio.balances) {
      const pct = portfolio.totalValueUsd > 0
        ? (balance.usdValue / portfolio.totalValueUsd) * 100
        : 0;

      allocation.set(balance.token.symbol, { pct, balance });
    }

    return allocation;
  }

  private computeDeviations(
    current: Map<string, { pct: number; balance: any }>,
    target: TargetAllocation
  ): Array<{
    symbol: string;
    currentPct: number;
    targetPct: number;
    deviationPct: number;
    balance: any;
  }> {
    const deviations: Array<{
      symbol: string;
      currentPct: number;
      targetPct: number;
      deviationPct: number;
      balance: any;
    }> = [];

    // Check all target tokens
    for (const [symbol, targetPct] of target.targets) {
      const currentEntry = current.get(symbol);
      const currentPct = currentEntry?.pct ?? 0;

      deviations.push({
        symbol,
        currentPct,
        targetPct,
        deviationPct: currentPct - targetPct,
        balance: currentEntry?.balance ?? null,
      });
    }

    // Check tokens in portfolio but NOT in target (should be 0%)
    for (const [symbol, entry] of current) {
      if (!target.targets.has(symbol) && entry.pct > 0) {
        deviations.push({
          symbol,
          currentPct: entry.pct,
          targetPct: 0,
          deviationPct: entry.pct, // Entirely over-allocated
          balance: entry.balance,
        });
      }
    }

    return deviations;
  }

  private generateActions(
    deviations: Array<{
      symbol: string;
      currentPct: number;
      targetPct: number;
      deviationPct: number;
      balance: any;
    }>,
    portfolio: PortfolioState,
    target: TargetAllocation,
    walletPublicKey?: PublicKey,
  ): RebalanceAction[] {
    const actions: RebalanceAction[] = [];
    const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');

    for (const deviation of deviations) {
      // Over-allocated: need to reduce
      if (deviation.deviationPct > target.tolerancePct && deviation.balance) {
        const excessUsd = (deviation.deviationPct / 100) * portfolio.totalValueUsd;

        // Skip tiny trades
        if (excessUsd < target.minTradeSizeUsd) continue;

        const action = this.buildReduceAction(
          deviation,
          excessUsd,
          portfolio,
          solBalance?.token,
          walletPublicKey,
        );

        if (action) {
          actions.push(action);
        }
      }

      // Under-allocated: need to increase
      if (deviation.deviationPct < -target.tolerancePct) {
        const deficitUsd = Math.abs(deviation.deviationPct / 100) * portfolio.totalValueUsd;

        // Skip tiny trades
        if (deficitUsd < target.minTradeSizeUsd) continue;

        const action = this.buildIncreaseAction(
          deviation,
          deficitUsd,
          portfolio,
          solBalance?.token,
          walletPublicKey,
        );

        if (action) {
          actions.push(action);
        }
      }
    }

    return actions;
  }

  private buildReduceAction(
    deviation: { symbol: string; currentPct: number; targetPct: number; deviationPct: number; balance: any },
    excessUsd: number,
    portfolio: PortfolioState,
    solToken: TokenInfo | undefined,
    walletPublicKey?: PublicKey,
  ): RebalanceAction | null {
    const balance = deviation.balance;
    if (!balance || !solToken) return null;

    // Calculate amount to sell
    const pricePerToken = balance.priceUsd || 1;
    const tokensToSell = excessUsd / pricePerToken;
    const rawAmount = BigInt(Math.floor(tokensToSell * (10 ** balance.token.decimals)));

    // Cap at available balance (leave some for gas if SOL)
    const maxRaw = deviation.symbol === 'SOL'
      ? balance.rawBalance - BigInt(50_000_000) // Keep 0.05 SOL for gas
      : balance.rawBalance;

    const amount = rawAmount > maxRaw ? maxRaw : rawAmount;
    if (amount <= 0n) return null;

    // Special case: mSOL -> unstake via Marinade instead of swap
    const isMsolUnstake = deviation.symbol === 'mSOL';
    const actionType: ActionType = isMsolUnstake ? 'unstake' : 'swap';
    const protocol: ProtocolId = isMsolUnstake ? 'marinade' : 'jupiter';

    const action: ProposedAction = {
      id: randomUUID(),
      type: actionType,
      protocol,
      description: isMsolUnstake
        ? `Unstake ${(Number(amount) / 1e9).toFixed(4)} mSOL via Marinade`
        : `Swap ${(Number(amount) / (10 ** balance.token.decimals)).toFixed(4)} ${deviation.symbol} to SOL via Jupiter`,
      rationale: `Portfolio rebalancing: ${deviation.symbol} is ${deviation.deviationPct.toFixed(1)}% over target allocation of ${deviation.targetPct}%`,
      expectedOutcome: `Reduce ${deviation.symbol} allocation from ${deviation.currentPct.toFixed(1)}% toward ${deviation.targetPct}%`,
      inputToken: balance.token,
      outputToken: solToken,
      amount,
      maxSlippageBps: 50,
      expectedValueChange: -excessUsd * 0.003, // ~0.3% swap fee estimate
      priority: 1, // Sells first
      timestamp: Date.now(),
    };

    return {
      action,
      currentPct: deviation.currentPct,
      targetPct: deviation.targetPct,
      deviationPct: deviation.deviationPct,
    };
  }

  private buildIncreaseAction(
    deviation: { symbol: string; currentPct: number; targetPct: number; deviationPct: number; balance: any },
    deficitUsd: number,
    portfolio: PortfolioState,
    solToken: TokenInfo | undefined,
    walletPublicKey?: PublicKey,
  ): RebalanceAction | null {
    if (!solToken) return null;

    const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');
    if (!solBalance || solBalance.usdValue < deficitUsd) return null;

    // Calculate SOL amount needed
    const solPriceUsd = solBalance.priceUsd || 1;
    const solNeeded = deficitUsd / solPriceUsd;
    const rawAmount = BigInt(Math.floor(solNeeded * 1e9));

    // Cap at available SOL (keep gas reserve)
    const maxSol = solBalance.rawBalance - BigInt(50_000_000);
    const amount = rawAmount > maxSol ? maxSol : rawAmount;
    if (amount <= 0n) return null;

    // Special case: mSOL -> stake via Marinade
    const isMsolStake = deviation.symbol === 'mSOL';
    const actionType: ActionType = isMsolStake ? 'stake' : 'swap';
    const protocol: ProtocolId = isMsolStake ? 'marinade' : 'jupiter';

    // Find or create the target token
    const targetToken: TokenInfo = deviation.balance?.token ?? {
      symbol: deviation.symbol,
      name: deviation.symbol,
      mint: PublicKey.default,
      decimals: deviation.symbol === 'USDC' ? 6 : 9,
    };

    const action: ProposedAction = {
      id: randomUUID(),
      type: actionType,
      protocol,
      description: isMsolStake
        ? `Stake ${(Number(amount) / 1e9).toFixed(4)} SOL via Marinade for mSOL`
        : `Swap ${(Number(amount) / 1e9).toFixed(4)} SOL to ${deviation.symbol} via Jupiter`,
      rationale: `Portfolio rebalancing: ${deviation.symbol} is ${Math.abs(deviation.deviationPct).toFixed(1)}% below target allocation of ${deviation.targetPct}%`,
      expectedOutcome: `Increase ${deviation.symbol} allocation from ${deviation.currentPct.toFixed(1)}% toward ${deviation.targetPct}%`,
      inputToken: solToken,
      outputToken: targetToken,
      amount,
      maxSlippageBps: 50,
      expectedValueChange: -deficitUsd * 0.003,
      priority: 2, // Buys after sells
      timestamp: Date.now(),
    };

    return {
      action,
      currentPct: deviation.currentPct,
      targetPct: deviation.targetPct,
      deviationPct: deviation.deviationPct,
    };
  }
}
```

### Task 6: Strategy Implementations

Three concrete strategies: conservative, balanced, aggressive.

**File: `P:\solana-agent-hackathon\packages\strategy-engine\src\strategies\conservative.ts`**

```typescript
import { randomUUID } from 'crypto';
import type { PortfolioState, YieldOpportunity, ProtocolId, ActionType } from '@makora/types';
import type { StrategySignal } from '@makora/types';
import type { ProposedAction } from '@makora/types';
import type { StrategyImplementation, MarketCondition } from '../types.js';

/**
 * Conservative Strategy
 *
 * Focuses on capital preservation through low-risk yield:
 * - Liquid staking via Marinade (mSOL)
 * - Stable lending via Jupiter
 * - NO LP positions (impermanent loss risk)
 * - NO aggressive vault strategies
 *
 * Trigger: High/extreme volatility, or user preference
 * Risk target: < 30/100
 */
export class ConservativeStrategy implements StrategyImplementation {
  readonly id = 'conservative';
  readonly name = 'Conservative Yield';
  readonly type = 'yield' as const;
  readonly description = 'Capital preservation through liquid staking and stable lending. Low risk, steady returns.';

  evaluate(
    portfolio: PortfolioState,
    marketCondition: MarketCondition,
    yieldOpportunities: YieldOpportunity[],
  ): StrategySignal {
    const actions: ProposedAction[] = [];
    let totalExpectedApy = 0;
    let actionCount = 0;

    // Filter to low-risk opportunities only (staking and lending)
    const safeOpportunities = yieldOpportunities.filter(
      (o) => o.type === 'staking' || (o.type === 'lending' && o.riskScore < 30)
    );

    // Check for idle SOL (not staked, not in positions)
    const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');
    const msolBalance = portfolio.balances.find((b) => b.token.symbol === 'mSOL');

    // If significant idle SOL exists (>20% of portfolio not staked), suggest staking
    const idleSolPct = solBalance
      ? (solBalance.usdValue / Math.max(portfolio.totalValueUsd, 1)) * 100
      : 0;

    if (idleSolPct > 20 && solBalance && solBalance.rawBalance > BigInt(100_000_000)) {
      const stakingOp = safeOpportunities.find((o) => o.type === 'staking');
      if (stakingOp) {
        // Stake 50% of idle SOL (keep 50% liquid for flexibility)
        const stakeAmount = solBalance.rawBalance / 2n;
        const reserveAmount = BigInt(50_000_000); // 0.05 SOL gas reserve
        const safeStakeAmount = stakeAmount > solBalance.rawBalance - reserveAmount
          ? solBalance.rawBalance - reserveAmount
          : stakeAmount;

        if (safeStakeAmount > 0n) {
          actions.push({
            id: randomUUID(),
            type: 'stake' as ActionType,
            protocol: 'marinade' as ProtocolId,
            description: `Stake ${(Number(safeStakeAmount) / 1e9).toFixed(4)} SOL via Marinade for ${stakingOp.apy.toFixed(1)}% APY`,
            rationale: `${idleSolPct.toFixed(0)}% of portfolio is idle SOL earning 0% yield. Liquid staking via Marinade provides ${stakingOp.apy.toFixed(1)}% APY with instant unstaking available.`,
            expectedOutcome: `Earn ~${stakingOp.apy.toFixed(1)}% APY on staked SOL. mSOL is liquid and can be used in DeFi.`,
            inputToken: solBalance.token,
            amount: safeStakeAmount,
            maxSlippageBps: 10,
            expectedValueChange: 0, // Staking is value-neutral at execution
            priority: 1,
            timestamp: Date.now(),
          });

          totalExpectedApy += stakingOp.apy;
          actionCount++;
        }
      }
    }

    // Calculate weighted expected APY
    const weightedApy = actionCount > 0 ? totalExpectedApy / actionCount : 0;

    // Compute overall risk score (conservative = always low)
    const riskScore = Math.min(25, ...safeOpportunities.map((o) => o.riskScore));

    // Build confidence based on market alignment
    let confidence = 50;
    if (marketCondition.volatilityRegime === 'high' || marketCondition.volatilityRegime === 'extreme') {
      confidence += 25; // Conservative is the right move in high vol
    }
    if (marketCondition.trendDirection === 'bearish') {
      confidence += 15; // Defensive is right in downtrends
    }
    if (actions.length > 0) {
      confidence += 10; // Actionable signals are more useful
    }
    confidence = Math.min(100, confidence);

    const explanation = actions.length > 0
      ? `Market shows ${marketCondition.volatilityRegime} volatility with ${marketCondition.trendDirection} trend. ` +
        `Conservative strategy recommends staking idle SOL for steady yield. ` +
        `${actions.length} action(s) proposed with expected ${weightedApy.toFixed(1)}% APY at risk score ${riskScore}/100.`
      : `Market shows ${marketCondition.volatilityRegime} volatility. ` +
        `Portfolio is already well-positioned for conservative yield. No action needed.`;

    return {
      strategyId: this.id,
      strategyName: this.name,
      type: this.type,
      confidence,
      actions,
      explanation,
      expectedApy: weightedApy,
      riskScore,
    };
  }
}
```

**File: `P:\solana-agent-hackathon\packages\strategy-engine\src\strategies\balanced.ts`**

```typescript
import { randomUUID } from 'crypto';
import type { PortfolioState, YieldOpportunity, ProtocolId, ActionType } from '@makora/types';
import type { StrategySignal, ProposedAction } from '@makora/types';
import type { StrategyImplementation, MarketCondition } from '../types.js';
import { Rebalancer, DEFAULT_TARGET_ALLOCATION } from '../rebalancer.js';

/**
 * Balanced Strategy
 *
 * Maintains a target allocation across SOL, mSOL, and USDC.
 * Rebalances when any token drifts >5% from target.
 * Also suggests yield opportunities for well-balanced portfolios.
 *
 * Default allocation: 50% SOL, 30% mSOL, 20% USDC
 *
 * Trigger: Moderate volatility, neutral market conditions
 * Risk target: 30-50/100
 */
export class BalancedStrategy implements StrategyImplementation {
  readonly id = 'balanced';
  readonly name = 'Balanced Portfolio';
  readonly type = 'rebalance' as const;
  readonly description = 'Maintains target allocation across SOL, mSOL, and USDC. Rebalances when drift exceeds 5%.';

  private rebalancer = new Rebalancer();

  evaluate(
    portfolio: PortfolioState,
    marketCondition: MarketCondition,
    yieldOpportunities: YieldOpportunity[],
  ): StrategySignal {
    // Check if rebalancing is needed
    const rebalanceActions = this.rebalancer.computeRebalance(
      portfolio,
      DEFAULT_TARGET_ALLOCATION,
    );

    const actions: ProposedAction[] = rebalanceActions.map((ra) => ra.action);

    // If portfolio is balanced, look for yield improvements
    if (actions.length === 0) {
      const yieldAction = this.suggestYieldImprovement(
        portfolio,
        yieldOpportunities,
        marketCondition,
      );
      if (yieldAction) {
        actions.push(yieldAction);
      }
    }

    // Compute risk score
    const riskScore = this.computeRiskScore(rebalanceActions.length, marketCondition);

    // Compute expected APY (weighted by portfolio allocation)
    const expectedApy = this.estimatePortfolioApy(portfolio, yieldOpportunities);

    // Confidence
    let confidence = 55;
    if (marketCondition.volatilityRegime === 'moderate') confidence += 20;
    if (marketCondition.trendDirection === 'neutral') confidence += 10;
    if (actions.length > 0) confidence += 10;
    confidence = Math.min(100, confidence);

    // Build allocation table for explanation
    const allocationTable = this.rebalancer.getAllocationTable(portfolio, DEFAULT_TARGET_ALLOCATION);
    const allocDesc = allocationTable
      .filter((e) => e.currentPct > 0)
      .map((e) => `${e.token.symbol}: ${e.currentPct.toFixed(1)}% (target: ${e.targetPct ?? 0}%)`)
      .join(', ');

    const explanation = actions.length > 0
      ? `Portfolio allocation: ${allocDesc}. ` +
        `${rebalanceActions.length > 0 ? `Rebalancing needed: ${rebalanceActions.length} trade(s) to restore target allocation.` : ''} ` +
        `Expected blended APY: ${expectedApy.toFixed(1)}%.`
      : `Portfolio is within target allocation (${allocDesc}). No rebalancing needed. ` +
        `Current blended APY estimate: ${expectedApy.toFixed(1)}%.`;

    return {
      strategyId: this.id,
      strategyName: this.name,
      type: this.type,
      confidence,
      actions,
      explanation,
      expectedApy,
      riskScore,
    };
  }

  // ---- Private ----

  private suggestYieldImprovement(
    portfolio: PortfolioState,
    yieldOpportunities: YieldOpportunity[],
    marketCondition: MarketCondition,
  ): ProposedAction | null {
    // If there is idle SOL (not staked) and a staking opportunity, suggest it
    const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');
    const msolBalance = portfolio.balances.find((b) => b.token.symbol === 'mSOL');

    if (!solBalance || solBalance.usdValue < 10) return null; // Minimum $10

    // Check if SOL is over-allocated compared to mSOL target
    const solPct = (solBalance.usdValue / Math.max(portfolio.totalValueUsd, 1)) * 100;
    const msolPct = msolBalance
      ? (msolBalance.usdValue / Math.max(portfolio.totalValueUsd, 1)) * 100
      : 0;

    // If mSOL is under-target and SOL is over-target, suggest staking
    if (solPct > 55 && msolPct < 25) {
      const stakingOp = yieldOpportunities.find((o) => o.type === 'staking');
      if (!stakingOp) return null;

      const stakeAmount = solBalance.rawBalance / 4n; // Stake 25% of SOL
      const reserveAmount = BigInt(50_000_000);
      const safeAmount = stakeAmount > solBalance.rawBalance - reserveAmount
        ? solBalance.rawBalance - reserveAmount
        : stakeAmount;

      if (safeAmount <= 0n) return null;

      return {
        id: randomUUID(),
        type: 'stake',
        protocol: 'marinade',
        description: `Stake ${(Number(safeAmount) / 1e9).toFixed(4)} SOL via Marinade for ${stakingOp.apy.toFixed(1)}% APY`,
        rationale: `SOL allocation (${solPct.toFixed(0)}%) exceeds target. Staking to mSOL improves yield while counting toward mSOL target allocation.`,
        expectedOutcome: `Move SOL allocation closer to 50% target and mSOL closer to 30% target.`,
        inputToken: solBalance.token,
        amount: safeAmount,
        maxSlippageBps: 10,
        expectedValueChange: 0,
        priority: 3,
        timestamp: Date.now(),
      };
    }

    return null;
  }

  private computeRiskScore(
    rebalanceCount: number,
    marketCondition: MarketCondition,
  ): number {
    let risk = 35; // Balanced baseline

    // More trades = more risk
    risk += rebalanceCount * 5;

    // Market conditions
    if (marketCondition.volatilityRegime === 'high') risk += 10;
    if (marketCondition.volatilityRegime === 'extreme') risk += 20;
    if (marketCondition.trendDirection === 'bearish') risk += 5;

    return Math.min(100, Math.max(0, risk));
  }

  private estimatePortfolioApy(
    portfolio: PortfolioState,
    yieldOpportunities: YieldOpportunity[],
  ): number {
    let weightedApy = 0;

    for (const balance of portfolio.balances) {
      const weight = portfolio.totalValueUsd > 0
        ? balance.usdValue / portfolio.totalValueUsd
        : 0;

      // mSOL earns staking yield
      if (balance.token.symbol === 'mSOL') {
        const stakingApy = yieldOpportunities.find((o) => o.type === 'staking')?.apy ?? 7.2;
        weightedApy += weight * stakingApy;
      }
      // SOL earns 0% idle
      // USDC earns lending yield (if in a lending position)
    }

    return weightedApy;
  }
}
```

**File: `P:\solana-agent-hackathon\packages\strategy-engine\src\strategies\aggressive.ts`**

```typescript
import { randomUUID } from 'crypto';
import type { PortfolioState, YieldOpportunity, ProtocolId, ActionType } from '@makora/types';
import type { StrategySignal, ProposedAction } from '@makora/types';
import type { StrategyImplementation, MarketCondition } from '../types.js';

/**
 * Aggressive Strategy
 *
 * Maximizes yield through LP positions and automated vaults.
 * Higher risk tolerance -- accepts impermanent loss for higher APY.
 *
 * Actions:
 * - Raydium LP for SOL/USDC pairs (~15% APY)
 * - Kamino vaults for automated yield (~12% APY)
 * - Marinade staking as base layer
 *
 * Trigger: Low volatility + bullish trend (ideal LP conditions)
 * Risk target: 50-75/100
 */
export class AggressiveStrategy implements StrategyImplementation {
  readonly id = 'aggressive';
  readonly name = 'Aggressive Yield';
  readonly type = 'liquidity' as const;
  readonly description = 'Maximizes yield through LP positions and automated vaults. Higher risk for higher returns.';

  evaluate(
    portfolio: PortfolioState,
    marketCondition: MarketCondition,
    yieldOpportunities: YieldOpportunity[],
  ): StrategySignal {
    const actions: ProposedAction[] = [];
    const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');

    // Sort yield opportunities by APY descending
    const sortedOpportunities = [...yieldOpportunities].sort((a, b) => b.apy - a.apy);

    // Propose LP position if conditions are favorable
    const lpOp = sortedOpportunities.find((o) => o.type === 'lp');
    if (lpOp && solBalance && solBalance.rawBalance > BigInt(500_000_000)) {
      // Allocate 30% of SOL to LP
      const lpAmount = (solBalance.rawBalance * 30n) / 100n;
      const reserveAmount = BigInt(50_000_000);
      const safeAmount = lpAmount > solBalance.rawBalance - reserveAmount
        ? solBalance.rawBalance - reserveAmount
        : lpAmount;

      if (safeAmount > 0n) {
        actions.push({
          id: randomUUID(),
          type: 'provide_liquidity',
          protocol: 'raydium',
          description: `Provide ${(Number(safeAmount) / 1e9).toFixed(4)} SOL as liquidity on Raydium SOL/USDC pool for ${lpOp.apy.toFixed(1)}% APY`,
          rationale: `${marketCondition.volatilityRegime} volatility with ${marketCondition.trendDirection} trend creates favorable LP conditions. Impermanent loss risk is acceptable for ${lpOp.apy.toFixed(1)}% APY.`,
          expectedOutcome: `Earn ~${lpOp.apy.toFixed(1)}% APY from trading fees and rewards. Position can be withdrawn anytime.`,
          inputToken: solBalance.token,
          amount: safeAmount,
          maxSlippageBps: 100,
          expectedValueChange: 0,
          priority: 1,
          timestamp: Date.now(),
        });
      }
    }

    // Propose vault deposit for remaining idle SOL
    const vaultOp = sortedOpportunities.find((o) => o.type === 'vault');
    if (vaultOp && solBalance && solBalance.rawBalance > BigInt(1_000_000_000)) {
      // Allocate 20% of SOL to vault
      const vaultAmount = (solBalance.rawBalance * 20n) / 100n;
      const reserveAmount = BigInt(50_000_000);
      const safeAmount = vaultAmount > solBalance.rawBalance - reserveAmount
        ? solBalance.rawBalance - reserveAmount
        : vaultAmount;

      if (safeAmount > 0n) {
        actions.push({
          id: randomUUID(),
          type: 'deposit',
          protocol: 'kamino',
          description: `Deposit ${(Number(safeAmount) / 1e9).toFixed(4)} SOL into Kamino automated vault for ${vaultOp.apy.toFixed(1)}% APY`,
          rationale: `Kamino vaults auto-compound rewards and manage positions. ${vaultOp.apy.toFixed(1)}% APY with automated management.`,
          expectedOutcome: `Earn ~${vaultOp.apy.toFixed(1)}% APY with automated vault management by Kamino.`,
          inputToken: solBalance.token,
          amount: safeAmount,
          maxSlippageBps: 100,
          expectedValueChange: 0,
          priority: 2,
          timestamp: Date.now(),
        });
      }
    }

    // Always suggest staking the rest
    const stakingOp = sortedOpportunities.find((o) => o.type === 'staking');
    if (stakingOp && solBalance && solBalance.rawBalance > BigInt(200_000_000)) {
      const stakeAmount = (solBalance.rawBalance * 20n) / 100n;
      const reserveAmount = BigInt(50_000_000);
      const safeAmount = stakeAmount > solBalance.rawBalance - reserveAmount
        ? solBalance.rawBalance - reserveAmount
        : stakeAmount;

      if (safeAmount > 0n) {
        actions.push({
          id: randomUUID(),
          type: 'stake',
          protocol: 'marinade',
          description: `Stake ${(Number(safeAmount) / 1e9).toFixed(4)} SOL via Marinade as base yield layer at ${stakingOp.apy.toFixed(1)}% APY`,
          rationale: `Base yield layer: liquid staking provides steady ${stakingOp.apy.toFixed(1)}% APY with instant liquidity for rebalancing.`,
          expectedOutcome: `Steady ${stakingOp.apy.toFixed(1)}% APY on staked SOL. mSOL remains liquid.`,
          inputToken: solBalance.token,
          amount: safeAmount,
          maxSlippageBps: 10,
          expectedValueChange: 0,
          priority: 3,
          timestamp: Date.now(),
        });
      }
    }

    // Compute blended APY
    const apys = sortedOpportunities.filter(
      (o) => o.type === 'lp' || o.type === 'vault' || o.type === 'staking'
    );
    const avgApy = apys.length > 0
      ? apys.reduce((sum, o) => sum + o.apy, 0) / apys.length
      : 0;

    // Risk score: aggressive = higher
    let riskScore = 55;
    if (marketCondition.volatilityRegime === 'high') riskScore += 15;
    if (marketCondition.volatilityRegime === 'extreme') riskScore += 30;
    riskScore = Math.min(100, riskScore);

    // Confidence: aggressive is most confident in calm + bullish conditions
    let confidence = 40;
    if (marketCondition.volatilityRegime === 'low') confidence += 25;
    if (marketCondition.trendDirection === 'bullish') confidence += 20;
    if (marketCondition.volatilityRegime === 'extreme') confidence -= 20;
    confidence = Math.min(100, Math.max(10, confidence));

    const explanation = `${marketCondition.summary} ` +
      `Aggressive strategy deploys capital across ${actions.length} position(s): ` +
      `${actions.map((a) => a.description).join('; ')}. ` +
      `Blended expected APY: ${avgApy.toFixed(1)}%. Risk score: ${riskScore}/100.`;

    return {
      strategyId: this.id,
      strategyName: this.name,
      type: this.type,
      confidence,
      actions,
      explanation,
      expectedApy: avgApy,
      riskScore,
    };
  }
}
```

**File: `P:\solana-agent-hackathon\packages\strategy-engine\src\strategies\index.ts`**

```typescript
export { ConservativeStrategy } from './conservative.js';
export { BalancedStrategy } from './balanced.js';
export { AggressiveStrategy } from './aggressive.js';
```

### Task 7: Strategy Engine (Main Orchestrator)

The top-level engine that coordinates market analysis, yield optimization, strategy selection, and action generation.

**File: `P:\solana-agent-hackathon\packages\strategy-engine\src\engine.ts`**

```typescript
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
```

### Task 8: Package Index

**File: `P:\solana-agent-hackathon\packages\strategy-engine\src\index.ts`**

```typescript
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
```

### Task 9: Install and Build

```bash
cd P:\solana-agent-hackathon
pnpm install
pnpm build
```

Build order:
1. `@makora/types` (leaf)
2. `@makora/strategy-engine` (depends on types)

## Verification

1. **Package compiles** -- `packages/strategy-engine/dist/` contains compiled JavaScript and type declarations.
2. **Engine evaluates portfolio** -- `engine.evaluate(portfolio, marketData)` returns a `StrategyEvaluation` with `signals.length >= 1`, each signal containing `strategyId`, `confidence`, `actions`, `expectedApy`, and `riskScore`.
3. **Yield optimizer returns sorted opportunities** -- `yieldOptimizer.findOpportunities(portfolio, condition)` returns `YieldOpportunity[]` sorted by risk-adjusted score with Marinade staking near the top in high-volatility conditions.
4. **Rebalancer detects drift** -- Given a portfolio with 80% SOL / 20% USDC and target 50/30/20, `rebalancer.computeRebalance()` returns actions to swap SOL to mSOL (stake) and maintain the target.
5. **Market analyzer classifies conditions** -- `analyzer.analyze({ volatilityIndex: 75, solChange24hPct: -8, ... })` returns `{ volatilityRegime: 'extreme', trendDirection: 'bearish', recommendedStrategyType: 'yield' }`.
6. **Conservative wins in high vol** -- When volatilityIndex > 70, the conservative strategy signal is ranked first (highest combined fitness + confidence score).
7. **Aggressive wins in low vol + bullish** -- When volatilityIndex < 20 and solChange24hPct > 5, the aggressive strategy signal is ranked first.
8. **Actions have complete ProposedAction fields** -- Every action in every signal has non-empty `id`, `type`, `protocol`, `description`, `rationale`, `expectedOutcome`, `inputToken`, `amount`, `maxSlippageBps`, and `priority`.
9. **No TypeScript errors** -- `pnpm typecheck` passes for the package.

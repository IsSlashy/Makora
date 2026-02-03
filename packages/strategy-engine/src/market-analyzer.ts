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

    const strategyDescMap: Record<StrategyType, string> = {
      yield: 'defensive yield strategies (staking, lending)',
      rebalance: 'portfolio rebalancing to maintain targets',
      liquidity: 'increased liquidity provision for higher yields',
      trading: 'active trading positions',
    };
    const strategyDesc = strategyDescMap[strategy];

    return `${volDesc} with ${trendDesc}. Recommending ${strategyDesc}.`;
  }
}

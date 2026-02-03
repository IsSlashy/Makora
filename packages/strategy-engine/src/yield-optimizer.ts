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

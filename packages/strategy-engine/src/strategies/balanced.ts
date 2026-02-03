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

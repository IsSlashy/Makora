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

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

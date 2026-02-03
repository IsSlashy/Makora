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

  /**
   * Get the maximum drift across all target allocations.
   */
  getMaxDrift(
    portfolio: PortfolioState,
    target: TargetAllocation = DEFAULT_TARGET_ALLOCATION,
  ): number {
    if (portfolio.totalValueUsd === 0) return 0;

    let maxDrift = 0;
    for (const [symbol, targetPct] of target.targets) {
      const balance = portfolio.balances.find(
        (b) => b.token.symbol === symbol,
      );
      const currentPct = balance
        ? (balance.usdValue / portfolio.totalValueUsd) * 100
        : 0;
      const drift = Math.abs(currentPct - targetPct);
      if (drift > maxDrift) maxDrift = drift;
    }

    return maxDrift;
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

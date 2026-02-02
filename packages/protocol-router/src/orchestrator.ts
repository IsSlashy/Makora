import { PublicKey } from '@solana/web3.js';
import type {
  ActionType,
  ProtocolId,
  PortfolioState,
  TokenInfo,
} from '@makora/types';
import type { RouteRequest } from './router.js';

/** High-level DeFi intent that may require multiple steps */
export interface DeFiIntent {
  /** What the user wants to achieve */
  type: 'move_to_yield' | 'rebalance' | 'exit_all' | 'compound' | 'custom';
  /** Amount in smallest units (optional, for percentage-based intents) */
  amount?: bigint;
  /** Percentage of portfolio (alternative to amount) */
  percentOfPortfolio?: number;
  /** Target tokens/protocols */
  targetProtocol?: ProtocolId;
  /** Source token */
  fromToken?: TokenInfo;
  /** Destination token */
  toToken?: TokenInfo;
}

/** An ordered step in a multi-step operation */
export interface OrchestrationStep {
  /** Step index (execution order) */
  index: number;
  /** Action to perform */
  actionType: ActionType;
  /** Target protocol */
  protocol: ProtocolId;
  /** Human-readable description */
  description: string;
  /** Parameters to pass to the router */
  routeRequest: RouteRequest;
  /** Whether this step depends on the previous step's output */
  dependsOnPrevious: boolean;
}

/** Result of orchestration planning */
export interface OrchestrationPlan {
  /** Original intent */
  intent: DeFiIntent;
  /** Ordered steps to execute */
  steps: OrchestrationStep[];
  /** Total number of transactions */
  transactionCount: number;
  /** Human-readable summary */
  summary: string;
  /** Estimated total time in ms */
  estimatedTimeMs: number;
}

/**
 * Multi-Step DeFi Orchestrator
 *
 * Decomposes high-level DeFi intents into ordered sequences of atomic actions.
 * For example:
 *   "Move 30% of portfolio to yield" ->
 *     1. Swap USDC -> SOL (if needed)
 *     2. Stake SOL -> mSOL (Marinade)
 *     3. Deposit mSOL into Kamino vault
 *
 * The orchestrator plans the sequence; the protocol router executes each step.
 *
 * DEFI-05: Multi-step DeFi orchestration
 */
export class DeFiOrchestrator {
  /**
   * Plan a multi-step operation from a high-level intent.
   *
   * @param intent - What the user wants to achieve
   * @param portfolio - Current portfolio state (for calculating amounts)
   * @param walletPublicKey - User's wallet
   * @returns Ordered plan of steps to execute
   */
  planExecution(
    intent: DeFiIntent,
    portfolio: PortfolioState,
    walletPublicKey: PublicKey
  ): OrchestrationPlan {
    switch (intent.type) {
      case 'move_to_yield':
        return this.planMoveToYield(intent, portfolio, walletPublicKey);
      case 'rebalance':
        return this.planRebalance(intent, portfolio, walletPublicKey);
      case 'exit_all':
        return this.planExitAll(intent, portfolio, walletPublicKey);
      case 'compound':
        return this.planCompound(intent, portfolio, walletPublicKey);
      default:
        throw new Error(`Unknown intent type: ${intent.type}`);
    }
  }

  /**
   * Plan: Move X% of portfolio to yield.
   *
   * Strategy:
   * 1. Calculate target amount from portfolio percentage
   * 2. If SOL available: stake SOL -> mSOL via Marinade
   * 3. If non-SOL tokens need converting: swap to SOL first, then stake
   */
  private planMoveToYield(
    intent: DeFiIntent,
    portfolio: PortfolioState,
    walletPublicKey: PublicKey
  ): OrchestrationPlan {
    const steps: OrchestrationStep[] = [];
    let stepIndex = 0;

    // Calculate target amount
    const pct = intent.percentOfPortfolio ?? 30;
    const targetUsd = portfolio.totalValueUsd * (pct / 100);

    // Find available SOL
    const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');
    const solValueUsd = solBalance?.usdValue ?? 0;
    const solLamports = solBalance?.rawBalance ?? 0n;

    // Find USDC balance (if we need to swap)
    const usdcBalance = portfolio.balances.find((b) => b.token.symbol === 'USDC');
    const usdcValueUsd = usdcBalance?.usdValue ?? 0;

    // Keep minimum SOL reserve (0.05 SOL for rent/gas)
    const minReserveLamports = 50_000_000n; // 0.05 SOL

    if (solValueUsd >= targetUsd) {
      // Case 1: Enough SOL -- just stake it
      const stakeAmountLamports = this.calculateLamportsFromUsd(
        targetUsd,
        solBalance!.priceUsd,
        9
      );
      const safeAmount = stakeAmountLamports > solLamports - minReserveLamports
        ? solLamports - minReserveLamports
        : stakeAmountLamports;

      steps.push({
        index: stepIndex++,
        actionType: 'stake',
        protocol: 'marinade',
        description: `Stake ${this.formatLamports(safeAmount, 9)} SOL via Marinade for mSOL yield`,
        routeRequest: {
          actionType: 'stake',
          protocol: 'marinade',
          params: {
            amount: safeAmount,
            userPublicKey: walletPublicKey,
          },
        },
        dependsOnPrevious: false,
      });
    } else if (solValueUsd + usdcValueUsd >= targetUsd) {
      // Case 2: Need to swap some USDC to SOL first, then stake all
      const neededFromUsdc = targetUsd - solValueUsd;
      const usdcToSwap = this.calculateLamportsFromUsd(
        neededFromUsdc,
        usdcBalance!.priceUsd,
        6 // USDC has 6 decimals
      );

      // Step 1: Swap USDC -> SOL
      steps.push({
        index: stepIndex++,
        actionType: 'swap',
        protocol: 'jupiter',
        description: `Swap ${this.formatLamports(usdcToSwap, 6)} USDC to SOL via Jupiter`,
        routeRequest: {
          actionType: 'swap',
          protocol: 'jupiter',
          params: {
            inputToken: usdcBalance!.token.mint,
            outputToken: solBalance!.token.mint,
            amount: usdcToSwap,
            maxSlippageBps: 50,
            userPublicKey: walletPublicKey,
          },
        },
        dependsOnPrevious: false,
      });

      // Step 2: Stake all available SOL -> mSOL
      const stakeAmountLamports = solLamports > minReserveLamports
        ? solLamports - minReserveLamports
        : 0n;

      if (stakeAmountLamports > 0n) {
        steps.push({
          index: stepIndex++,
          actionType: 'stake',
          protocol: 'marinade',
          description: `Stake SOL via Marinade for mSOL yield`,
          routeRequest: {
            actionType: 'stake',
            protocol: 'marinade',
            params: {
              amount: stakeAmountLamports,
              userPublicKey: walletPublicKey,
            },
          },
          dependsOnPrevious: true, // Need the SOL from swap first
        });
      }
    } else {
      // Case 3: Not enough liquid assets for the target amount
      // Stake whatever SOL is available
      const availableLamports = solLamports > minReserveLamports
        ? solLamports - minReserveLamports
        : 0n;

      if (availableLamports > 0n) {
        steps.push({
          index: stepIndex++,
          actionType: 'stake',
          protocol: 'marinade',
          description: `Stake ${this.formatLamports(availableLamports, 9)} SOL via Marinade (partial -- not enough for full ${pct}%)`,
          routeRequest: {
            actionType: 'stake',
            protocol: 'marinade',
            params: {
              amount: availableLamports,
              userPublicKey: walletPublicKey,
            },
          },
          dependsOnPrevious: false,
        });
      }
    }

    return {
      intent,
      steps,
      transactionCount: steps.length,
      summary: `Move ${pct}% of portfolio to yield: ${steps.map((s) => s.description).join(' -> ')}`,
      estimatedTimeMs: steps.length * 15_000, // ~15s per transaction
    };
  }

  /**
   * Plan: Rebalance portfolio to target allocation.
   */
  private planRebalance(
    intent: DeFiIntent,
    portfolio: PortfolioState,
    walletPublicKey: PublicKey
  ): OrchestrationPlan {
    // Simplified rebalance: if over-allocated in one token, swap excess to SOL
    const steps: OrchestrationStep[] = [];
    let stepIndex = 0;

    // For now, a basic rebalance just ensures no single token is > 50% of portfolio
    for (const balance of portfolio.balances) {
      if (balance.token.symbol === 'SOL') continue; // SOL is the base, skip

      const allocationPct = (balance.usdValue / portfolio.totalValueUsd) * 100;

      if (allocationPct > 50) {
        // Over-allocated: swap excess to SOL
        const excessPct = allocationPct - 50;
        const excessAmount = BigInt(
          Math.floor(Number(balance.rawBalance) * (excessPct / allocationPct))
        );

        const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');
        if (!solBalance) continue;

        steps.push({
          index: stepIndex++,
          actionType: 'swap',
          protocol: 'jupiter',
          description: `Rebalance: swap excess ${balance.token.symbol} to SOL`,
          routeRequest: {
            actionType: 'swap',
            protocol: 'jupiter',
            params: {
              inputToken: balance.token.mint,
              outputToken: solBalance.token.mint,
              amount: excessAmount,
              maxSlippageBps: 50,
              userPublicKey: walletPublicKey,
            },
          },
          dependsOnPrevious: false,
        });
      }
    }

    return {
      intent,
      steps,
      transactionCount: steps.length,
      summary: steps.length > 0
        ? `Rebalance: ${steps.length} swap(s) to normalize allocation`
        : 'Portfolio is already balanced -- no action needed',
      estimatedTimeMs: steps.length * 15_000,
    };
  }

  /**
   * Plan: Exit all DeFi positions to SOL/USDC.
   */
  private planExitAll(
    intent: DeFiIntent,
    portfolio: PortfolioState,
    walletPublicKey: PublicKey
  ): OrchestrationPlan {
    const steps: OrchestrationStep[] = [];
    let stepIndex = 0;

    // Unstake mSOL if any
    const msolBalance = portfolio.balances.find((b) => b.token.symbol === 'mSOL');
    if (msolBalance && msolBalance.rawBalance > 0n) {
      steps.push({
        index: stepIndex++,
        actionType: 'unstake',
        protocol: 'marinade',
        description: `Unstake ${this.formatLamports(msolBalance.rawBalance, 9)} mSOL via Marinade`,
        routeRequest: {
          actionType: 'unstake',
          protocol: 'marinade',
          params: {
            amount: msolBalance.rawBalance,
            userPublicKey: walletPublicKey,
          },
        },
        dependsOnPrevious: false,
      });
    }

    // Swap any non-SOL/non-USDC tokens to SOL
    for (const balance of portfolio.balances) {
      if (balance.token.symbol === 'SOL' || balance.token.symbol === 'USDC') continue;
      if (balance.token.symbol === 'mSOL') continue; // Handled above
      if (balance.rawBalance === 0n) continue;

      const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');
      if (!solBalance) continue;

      steps.push({
        index: stepIndex++,
        actionType: 'swap',
        protocol: 'jupiter',
        description: `Exit: swap ${balance.token.symbol} to SOL`,
        routeRequest: {
          actionType: 'swap',
          protocol: 'jupiter',
          params: {
            inputToken: balance.token.mint,
            outputToken: solBalance.token.mint,
            amount: balance.rawBalance,
            maxSlippageBps: 100,
            userPublicKey: walletPublicKey,
          },
        },
        dependsOnPrevious: stepIndex > 1, // After unstake completes
      });
    }

    return {
      intent,
      steps,
      transactionCount: steps.length,
      summary: steps.length > 0
        ? `Exit all positions: ${steps.length} transaction(s)`
        : 'No DeFi positions to exit',
      estimatedTimeMs: steps.length * 15_000,
    };
  }

  /**
   * Plan: Compound staking rewards.
   */
  private planCompound(
    _intent: DeFiIntent,
    _portfolio: PortfolioState,
    _walletPublicKey: PublicKey
  ): OrchestrationPlan {
    // mSOL compounds automatically (price appreciation) so this is a no-op for Marinade
    // For other protocols, this would harvest rewards and re-deposit

    return {
      intent: _intent,
      steps: [],
      transactionCount: 0,
      summary: 'Marinade mSOL compounds automatically via price appreciation. No action needed.',
      estimatedTimeMs: 0,
    };
  }

  // ---- Utility helpers ----

  private calculateLamportsFromUsd(
    targetUsd: number,
    pricePerToken: number,
    decimals: number
  ): bigint {
    if (pricePerToken === 0) return 0n;
    const tokenAmount = targetUsd / pricePerToken;
    return BigInt(Math.floor(tokenAmount * 10 ** decimals));
  }

  private formatLamports(lamports: bigint, decimals: number): string {
    const value = Number(lamports) / 10 ** decimals;
    return value.toFixed(4);
  }
}

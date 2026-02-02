import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import type { RiskCheck, RiskLimits, PortfolioState, ProposedAction } from '@makora/types';

/**
 * SOL Reserve Check (RISK-02)
 *
 * Ensures the user always keeps a minimum SOL balance for rent and transaction fees.
 * Without this, the wallet could become unusable (rent-exempt accounts get garbage collected).
 */
export function checkSolReserve(
  action: ProposedAction,
  portfolio: PortfolioState,
  limits: RiskLimits
): RiskCheck {
  const currentSolBalance = portfolio.solBalance;
  const minReserveSol = limits.minSolReserve;

  // Estimate SOL cost of this action
  // For SOL-spending actions (stake, swap SOL->X), the action directly reduces SOL
  let solSpent = 0;

  if (action.inputToken.symbol === 'SOL') {
    solSpent = Number(action.amount) / LAMPORTS_PER_SOL;
  }

  // Always add estimated transaction fee (0.000005 SOL per signature, plus compute)
  const estimatedTxFeeSol = 0.001; // Conservative estimate
  const projectedSolBalance = currentSolBalance - solSpent - estimatedTxFeeSol;

  if (projectedSolBalance < minReserveSol) {
    return {
      name: 'SOL Reserve',
      passed: false,
      value: Math.round(projectedSolBalance * 10000) / 10000,
      limit: minReserveSol,
      message:
        `After this action, SOL balance would be ${projectedSolBalance.toFixed(4)} SOL. ` +
        `Minimum reserve required: ${minReserveSol} SOL (for rent + tx fees). ` +
        `Reduce the amount by at least ${(minReserveSol - projectedSolBalance).toFixed(4)} SOL.`,
    };
  }

  return {
    name: 'SOL Reserve',
    passed: true,
    value: Math.round(projectedSolBalance * 10000) / 10000,
    limit: minReserveSol,
    message: `Projected SOL balance ${projectedSolBalance.toFixed(4)} SOL exceeds minimum reserve (${minReserveSol} SOL).`,
  };
}

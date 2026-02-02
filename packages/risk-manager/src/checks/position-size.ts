import type { RiskCheck, RiskLimits, PortfolioState, ProposedAction } from '@makora/types';

/**
 * Position Size Check (RISK-02)
 *
 * Ensures no single action represents more than maxPositionSizePct of the portfolio.
 * Example: if maxPositionSizePct = 25, a swap of 50% of portfolio value is rejected.
 */
export function checkPositionSize(
  action: ProposedAction,
  portfolio: PortfolioState,
  limits: RiskLimits
): RiskCheck {
  const actionValueUsd = Math.abs(action.expectedValueChange);
  const portfolioValue = portfolio.totalValueUsd;

  // If portfolio is empty or very small, allow the action
  // (can't divide by zero, and small portfolios need initial actions)
  if (portfolioValue < 1) {
    return {
      name: 'Position Size',
      passed: true,
      value: 0,
      limit: limits.maxPositionSizePct,
      message: 'Portfolio value too small for position size check. Allowed.',
    };
  }

  const positionSizePct = (actionValueUsd / portfolioValue) * 100;

  if (positionSizePct > limits.maxPositionSizePct) {
    return {
      name: 'Position Size',
      passed: false,
      value: Math.round(positionSizePct * 100) / 100,
      limit: limits.maxPositionSizePct,
      message:
        `Action value ($${actionValueUsd.toFixed(2)}) is ${positionSizePct.toFixed(1)}% of portfolio ($${portfolioValue.toFixed(2)}). ` +
        `Maximum allowed: ${limits.maxPositionSizePct}%. ` +
        `Reduce the amount to at most $${(portfolioValue * limits.maxPositionSizePct / 100).toFixed(2)}.`,
    };
  }

  return {
    name: 'Position Size',
    passed: true,
    value: Math.round(positionSizePct * 100) / 100,
    limit: limits.maxPositionSizePct,
    message: `Position size ${positionSizePct.toFixed(1)}% is within limit (${limits.maxPositionSizePct}%).`,
  };
}

import type { RiskCheck, RiskLimits, PortfolioState, ProposedAction, CircuitBreakerState } from '@makora/types';

/**
 * Daily Loss Check (RISK-03)
 *
 * Tracks cumulative daily losses and rejects actions that would push
 * total daily loss beyond the configured limit.
 *
 * This works hand-in-hand with the circuit breaker.
 */
export function checkDailyLoss(
  action: ProposedAction,
  portfolio: PortfolioState,
  limits: RiskLimits,
  circuitBreakerState: CircuitBreakerState
): RiskCheck {
  const portfolioValue = portfolio.totalValueUsd;

  // If portfolio is empty, skip this check
  if (portfolioValue < 1) {
    return {
      name: 'Daily Loss',
      passed: true,
      value: 0,
      limit: limits.maxDailyLossPct,
      message: 'Portfolio value too small for daily loss check. Allowed.',
    };
  }

  const maxDailyLossUsd = portfolioValue * (limits.maxDailyLossPct / 100);
  const currentLossUsd = circuitBreakerState.dailyLossUsd;

  // Check if this action could potentially cause a loss
  // We use expectedValueChange as an estimate -- negative = potential loss
  const potentialLossUsd = action.expectedValueChange < 0
    ? Math.abs(action.expectedValueChange)
    : 0;

  const projectedTotalLoss = currentLossUsd + potentialLossUsd;
  const projectedLossPct = (projectedTotalLoss / portfolioValue) * 100;

  if (projectedTotalLoss > maxDailyLossUsd) {
    return {
      name: 'Daily Loss',
      passed: false,
      value: Math.round(projectedLossPct * 100) / 100,
      limit: limits.maxDailyLossPct,
      message:
        `Projected daily loss $${projectedTotalLoss.toFixed(2)} (${projectedLossPct.toFixed(1)}%) would exceed ` +
        `daily limit of $${maxDailyLossUsd.toFixed(2)} (${limits.maxDailyLossPct}%). ` +
        `Current daily loss: $${currentLossUsd.toFixed(2)}. ` +
        `Wait for the daily reset (midnight UTC) or increase the daily loss limit.`,
    };
  }

  return {
    name: 'Daily Loss',
    passed: true,
    value: Math.round(projectedLossPct * 100) / 100,
    limit: limits.maxDailyLossPct,
    message: `Projected daily loss ${projectedLossPct.toFixed(1)}% is within limit (${limits.maxDailyLossPct}%).`,
  };
}

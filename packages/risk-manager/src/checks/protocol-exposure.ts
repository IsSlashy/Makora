import type { RiskCheck, RiskLimits, PortfolioState, ProposedAction, Position } from '@makora/types';

/**
 * Protocol Exposure Check (RISK-02)
 *
 * Ensures no single protocol holds more than maxProtocolExposurePct of the portfolio.
 * Diversification across protocols reduces smart contract risk.
 */
export function checkProtocolExposure(
  action: ProposedAction,
  portfolio: PortfolioState,
  limits: RiskLimits,
  positions: Position[]
): RiskCheck {
  const portfolioValue = portfolio.totalValueUsd;

  // If portfolio is empty, skip
  if (portfolioValue < 1) {
    return {
      name: 'Protocol Exposure',
      passed: true,
      value: 0,
      limit: limits.maxProtocolExposurePct,
      message: 'Portfolio value too small for protocol exposure check. Allowed.',
    };
  }

  // Calculate current exposure per protocol
  const protocolExposure = new Map<string, number>();

  for (const position of positions) {
    const current = protocolExposure.get(position.protocolId) ?? 0;
    protocolExposure.set(position.protocolId, current + position.usdValue);
  }

  // Add the proposed action to the target protocol
  const targetProtocol = action.protocol;
  const currentExposure = protocolExposure.get(targetProtocol) ?? 0;
  const actionValueUsd = Math.abs(action.expectedValueChange);
  const projectedExposure = currentExposure + actionValueUsd;
  const projectedExposurePct = (projectedExposure / portfolioValue) * 100;

  if (projectedExposurePct > limits.maxProtocolExposurePct) {
    return {
      name: 'Protocol Exposure',
      passed: false,
      value: Math.round(projectedExposurePct * 100) / 100,
      limit: limits.maxProtocolExposurePct,
      message:
        `Exposure to ${targetProtocol} would be $${projectedExposure.toFixed(2)} ` +
        `(${projectedExposurePct.toFixed(1)}% of portfolio). ` +
        `Maximum allowed per protocol: ${limits.maxProtocolExposurePct}%. ` +
        `Current ${targetProtocol} exposure: $${currentExposure.toFixed(2)}.`,
    };
  }

  return {
    name: 'Protocol Exposure',
    passed: true,
    value: Math.round(projectedExposurePct * 100) / 100,
    limit: limits.maxProtocolExposurePct,
    message: `${targetProtocol} exposure ${projectedExposurePct.toFixed(1)}% is within limit (${limits.maxProtocolExposurePct}%).`,
  };
}

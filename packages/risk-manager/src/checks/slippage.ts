import type { RiskCheck, RiskLimits, ProposedAction } from '@makora/types';

/**
 * Slippage Check (RISK-02)
 *
 * Ensures the requested slippage tolerance does not exceed the configured maximum.
 * High slippage = high risk of unfavorable execution.
 */
export function checkSlippage(
  action: ProposedAction,
  limits: RiskLimits
): RiskCheck {
  const slippageBps = action.maxSlippageBps;

  if (slippageBps > limits.maxSlippageBps) {
    return {
      name: 'Slippage',
      passed: false,
      value: slippageBps,
      limit: limits.maxSlippageBps,
      message:
        `Slippage tolerance ${slippageBps} bps (${(slippageBps / 100).toFixed(2)}%) exceeds maximum allowed ` +
        `${limits.maxSlippageBps} bps (${(limits.maxSlippageBps / 100).toFixed(2)}%). ` +
        `Reduce slippage or increase the limit in risk parameters.`,
    };
  }

  return {
    name: 'Slippage',
    passed: true,
    value: slippageBps,
    limit: limits.maxSlippageBps,
    message: `Slippage ${slippageBps} bps is within limit (${limits.maxSlippageBps} bps).`,
  };
}

import type { RiskAssessment, RiskCheck, CircuitBreakerState } from '@makora/types';

/**
 * Format a risk assessment as a human-readable string.
 * Used by CLI and agent advisory mode.
 */
export function formatRiskAssessment(assessment: RiskAssessment): string {
  const lines: string[] = [];

  // Header
  const status = assessment.approved ? 'APPROVED' : 'REJECTED';
  lines.push(`Risk Assessment: ${status} (score: ${assessment.riskScore}/100)`);
  lines.push(`Summary: ${assessment.summary}`);
  lines.push('');

  // Individual checks
  lines.push('Checks:');
  for (const check of assessment.checks) {
    const icon = check.passed ? '[PASS]' : '[FAIL]';
    lines.push(`  ${icon} ${check.name}: ${check.message}`);
    lines.push(`         Value: ${check.value} | Limit: ${check.limit}`);
  }

  return lines.join('\n');
}

/**
 * Format a risk assessment as a compact one-liner.
 * Used in transaction logs and auto mode.
 */
export function formatRiskSummary(assessment: RiskAssessment): string {
  const status = assessment.approved ? 'OK' : 'VETOED';
  const failedChecks = assessment.checks.filter((c) => !c.passed);

  if (failedChecks.length === 0) {
    return `[RISK ${status}] Score ${assessment.riskScore}/100 -- all checks passed`;
  }

  const failedNames = failedChecks.map((c) => c.name).join(', ');
  return `[RISK ${status}] Score ${assessment.riskScore}/100 -- failed: ${failedNames}`;
}

/**
 * Format circuit breaker state for display.
 */
export function formatCircuitBreakerState(state: CircuitBreakerState): string {
  if (!state.isActive) {
    return `Circuit Breaker: INACTIVE | Daily loss: $${state.dailyLossUsd.toFixed(2)} | Failed TXs: ${state.failedTxCount}`;
  }

  const activatedTime = state.activatedAt
    ? new Date(state.activatedAt).toLocaleTimeString()
    : 'unknown';

  return (
    `Circuit Breaker: ACTIVE (tripped at ${activatedTime})\n` +
    `  Reason: ${state.reason}\n` +
    `  Daily loss: $${state.dailyLossUsd.toFixed(2)}\n` +
    `  Failed TXs: ${state.failedTxCount}\n` +
    `  Auto-resets at midnight UTC`
  );
}

/**
 * Get a risk level label from a risk score.
 */
export function getRiskLevel(score: number): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  if (score <= 25) return 'LOW';
  if (score <= 50) return 'MEDIUM';
  if (score <= 75) return 'HIGH';
  return 'CRITICAL';
}

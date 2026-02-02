// ============================================================================
// Risk Management Types
// ============================================================================

/** Risk parameter limits */
export interface RiskLimits {
  /** Maximum position size as percentage of portfolio (e.g., 50 = 50%) */
  maxPositionSizePct: number;
  /** Maximum slippage in basis points (e.g., 100 = 1%) */
  maxSlippageBps: number;
  /** Maximum daily loss as percentage of portfolio */
  maxDailyLossPct: number;
  /** Minimum SOL to keep for rent/gas (in SOL, not lamports) */
  minSolReserve: number;
  /** Maximum exposure to any single protocol (percentage) */
  maxProtocolExposurePct: number;
}

/** Default risk limits (conservative) */
export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPositionSizePct: 25,
  maxSlippageBps: 100,
  maxDailyLossPct: 5,
  minSolReserve: 0.05,
  maxProtocolExposurePct: 50,
};

/** Risk assessment for a proposed action */
export interface RiskAssessment {
  /** Whether the action passes risk checks */
  approved: boolean;
  /** Overall risk score 0-100 */
  riskScore: number;
  /** Individual check results */
  checks: RiskCheck[];
  /** Human-readable summary */
  summary: string;
}

/** Individual risk check result */
export interface RiskCheck {
  name: string;
  passed: boolean;
  /** Current value */
  value: number;
  /** Limit that was checked against */
  limit: number;
  message: string;
}

/** Circuit breaker state */
export interface CircuitBreakerState {
  isActive: boolean;
  activatedAt?: number;
  reason?: string;
  /** Cumulative daily loss in USD */
  dailyLossUsd: number;
  /** Number of failed transactions today */
  failedTxCount: number;
}

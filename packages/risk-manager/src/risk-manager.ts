import type {
  RiskLimits,
  RiskAssessment,
  RiskCheck,
  PortfolioState,
  ProposedAction,
  Position,
  CircuitBreakerState,
  ExecutionResult,
} from '@makora/types';
import { DEFAULT_RISK_LIMITS } from '@makora/types';
import {
  checkPositionSize,
  checkSlippage,
  checkDailyLoss,
  checkSolReserve,
  checkProtocolExposure,
} from './checks/index.js';
import { CircuitBreaker } from './circuit-breaker.js';

/**
 * RiskValidator interface (mirrors the one in @makora/execution-engine/src/types.ts).
 *
 * We re-declare it here to avoid a circular dependency between the two packages.
 * Both interfaces are structurally identical, so TypeScript treats them as compatible.
 */
export interface RiskValidator {
  validate(action: ProposedAction): Promise<RiskAssessment>;
}

/** Callback for risk events */
export type RiskEventCallback = (event: RiskEvent) => void;

/** Risk events emitted by the manager */
export type RiskEvent =
  | { type: 'check_passed'; action: ProposedAction; assessment: RiskAssessment }
  | { type: 'check_failed'; action: ProposedAction; assessment: RiskAssessment }
  | { type: 'circuit_breaker_tripped'; state: CircuitBreakerState }
  | { type: 'circuit_breaker_reset'; state: CircuitBreakerState }
  | { type: 'limits_updated'; limits: RiskLimits };

/**
 * Risk Manager (RISK-01, RISK-02, RISK-03, RISK-04)
 *
 * Central risk management system with VETO power over all agent actions.
 *
 * Responsibilities:
 * 1. Validate all proposed actions against configurable risk limits (RISK-02)
 * 2. Enforce VETO: reject actions that violate limits (RISK-01)
 * 3. Track daily losses and trigger circuit breaker (RISK-03)
 * 4. Provide risk assessments for display (RISK-04)
 *
 * Architecture:
 * - Implements RiskValidator interface (structurally compatible with execution engine)
 * - Composes individual check functions (pure, testable)
 * - Owns the circuit breaker instance
 * - Receives portfolio state updates from the data feed
 */
export class RiskManager implements RiskValidator {
  private limits: RiskLimits;
  private circuitBreaker: CircuitBreaker;
  private portfolio: PortfolioState | null = null;
  private positions: Position[] = [];
  private eventCallback?: RiskEventCallback;

  constructor(
    initialPortfolioValue: number = 0,
    limits: RiskLimits = DEFAULT_RISK_LIMITS
  ) {
    this.limits = { ...limits };
    this.circuitBreaker = new CircuitBreaker(limits, initialPortfolioValue);
  }

  /**
   * Validate a proposed action against all risk checks.
   *
   * This is the main VETO point. Returns a RiskAssessment with:
   * - approved: boolean (false = VETO)
   * - riskScore: 0-100 (higher = riskier)
   * - checks: individual check results
   * - summary: human-readable reason
   *
   * CRITICAL: The execution engine calls this before every transaction.
   * If approved is false, the transaction MUST NOT be sent.
   */
  async validate(action: ProposedAction): Promise<RiskAssessment> {
    // Check circuit breaker first -- if tripped, reject everything
    if (this.circuitBreaker.isTripped()) {
      const cbState = this.circuitBreaker.getState();
      return {
        approved: false,
        riskScore: 100,
        checks: [],
        summary: `CIRCUIT BREAKER ACTIVE: ${cbState.reason ?? 'Daily loss limit exceeded'}. All execution halted.`,
      };
    }

    // Use empty portfolio if none is set (allows initialization)
    const portfolio = this.portfolio ?? {
      owner: action.inputToken.mint, // placeholder
      balances: [],
      totalValueUsd: 0,
      solBalance: 0,
      lastUpdated: Date.now(),
    };

    // Run all checks
    const checks: RiskCheck[] = [
      checkPositionSize(action, portfolio, this.limits),
      checkSlippage(action, this.limits),
      checkDailyLoss(action, portfolio, this.limits, this.circuitBreaker.getState()),
      checkSolReserve(action, portfolio, this.limits),
      checkProtocolExposure(action, portfolio, this.limits, this.positions),
    ];

    // Calculate aggregate risk score (0-100)
    const riskScore = this.calculateRiskScore(checks, action);

    // Determine approval: all checks must pass
    const approved = checks.every((check) => check.passed);

    // Build summary
    const failedChecks = checks.filter((c) => !c.passed);
    const summary = approved
      ? `All ${checks.length} risk checks passed. Risk score: ${riskScore}/100.`
      : `REJECTED: ${failedChecks.length} check(s) failed: ${failedChecks.map((c) => c.name).join(', ')}. ` +
        failedChecks.map((c) => c.message).join(' ');

    const assessment: RiskAssessment = {
      approved,
      riskScore,
      checks,
      summary,
    };

    // Emit event
    if (this.eventCallback) {
      const eventType = approved ? 'check_passed' : 'check_failed';
      this.eventCallback({ type: eventType, action, assessment });
    }

    return assessment;
  }

  /**
   * Record the result of an executed transaction.
   * Updates the circuit breaker with loss tracking.
   *
   * Call this AFTER every transaction, whether it succeeded or failed.
   */
  recordExecution(
    result: ExecutionResult,
    prePortfolioValue: number,
    postPortfolioValue: number
  ): void {
    this.circuitBreaker.recordExecution(result, prePortfolioValue, postPortfolioValue);

    // Check if circuit breaker tripped
    if (this.circuitBreaker.isTripped() && this.eventCallback) {
      this.eventCallback({
        type: 'circuit_breaker_tripped',
        state: this.circuitBreaker.getState(),
      });
    }
  }

  /**
   * Record a known loss (for estimated/simulated losses).
   */
  recordLoss(lossUsd: number): void {
    this.circuitBreaker.recordLoss(lossUsd);
  }

  /**
   * Update portfolio state.
   * Call this whenever the portfolio is refreshed (before each OODA cycle).
   */
  updatePortfolio(portfolio: PortfolioState): void {
    this.portfolio = portfolio;
  }

  /**
   * Update positions from all protocols.
   * Call this alongside updatePortfolio.
   */
  updatePositions(positions: Position[]): void {
    this.positions = positions;
  }

  /**
   * Get current risk limits.
   */
  getLimits(): RiskLimits {
    return { ...this.limits };
  }

  /**
   * Update risk limits.
   * Validates that new limits are reasonable before applying.
   */
  setLimits(newLimits: Partial<RiskLimits>): void {
    // Validate limits
    if (newLimits.maxPositionSizePct !== undefined) {
      if (newLimits.maxPositionSizePct < 1 || newLimits.maxPositionSizePct > 100) {
        throw new Error('maxPositionSizePct must be between 1 and 100');
      }
    }
    if (newLimits.maxSlippageBps !== undefined) {
      if (newLimits.maxSlippageBps < 1 || newLimits.maxSlippageBps > 5000) {
        throw new Error('maxSlippageBps must be between 1 and 5000 (50%)');
      }
    }
    if (newLimits.maxDailyLossPct !== undefined) {
      if (newLimits.maxDailyLossPct < 0.1 || newLimits.maxDailyLossPct > 100) {
        throw new Error('maxDailyLossPct must be between 0.1 and 100');
      }
    }
    if (newLimits.minSolReserve !== undefined) {
      if (newLimits.minSolReserve < 0.001) {
        throw new Error('minSolReserve must be at least 0.001 SOL');
      }
    }
    if (newLimits.maxProtocolExposurePct !== undefined) {
      if (newLimits.maxProtocolExposurePct < 10 || newLimits.maxProtocolExposurePct > 100) {
        throw new Error('maxProtocolExposurePct must be between 10 and 100');
      }
    }

    this.limits = { ...this.limits, ...newLimits };
    this.circuitBreaker.updateLimits(this.limits);

    if (this.eventCallback) {
      this.eventCallback({ type: 'limits_updated', limits: this.limits });
    }
  }

  /**
   * Get the circuit breaker state.
   */
  getCircuitBreakerState(): CircuitBreakerState {
    return this.circuitBreaker.getState();
  }

  /**
   * Manually reset the circuit breaker.
   * Only call from user-initiated actions (not from the agent).
   */
  resetCircuitBreaker(): void {
    const portfolioValue = this.portfolio?.totalValueUsd ?? 0;
    this.circuitBreaker.manualReset(portfolioValue);

    if (this.eventCallback) {
      this.eventCallback({
        type: 'circuit_breaker_reset',
        state: this.circuitBreaker.getState(),
      });
    }
  }

  /**
   * Register an event callback for risk events.
   */
  onEvent(callback: RiskEventCallback): void {
    this.eventCallback = callback;
  }

  /**
   * Get a snapshot of the current risk state.
   * Useful for dashboard display (RISK-04).
   */
  getRiskSnapshot(): {
    limits: RiskLimits;
    circuitBreaker: CircuitBreakerState;
    portfolioValueUsd: number;
    isOperational: boolean;
  } {
    return {
      limits: this.getLimits(),
      circuitBreaker: this.getCircuitBreakerState(),
      portfolioValueUsd: this.portfolio?.totalValueUsd ?? 0,
      isOperational: !this.circuitBreaker.isTripped(),
    };
  }

  // ---- Private helpers ----

  /**
   * Calculate an aggregate risk score (0-100) from individual checks.
   *
   * Scoring:
   * - Each failed check adds 20-30 points
   * - Checks close to their limits add proportional points
   * - High slippage adds extra risk
   * - Large position sizes add extra risk
   */
  private calculateRiskScore(checks: RiskCheck[], action: ProposedAction): number {
    let score = 0;

    for (const check of checks) {
      if (!check.passed) {
        // Failed check: high risk contribution
        score += 25;
      } else {
        // Passed but how close to the limit?
        const utilization = check.limit > 0 ? check.value / check.limit : 0;

        if (utilization > 0.8) {
          // >80% of limit: moderate risk
          score += 10;
        } else if (utilization > 0.5) {
          // >50% of limit: some risk
          score += 5;
        }
      }
    }

    // Bonus risk for high slippage actions
    if (action.maxSlippageBps > 200) {
      score += 10;
    }

    // Bonus risk for large amounts relative to common thresholds
    const amountSol = Number(action.amount) / 1e9; // Approximate SOL
    if (amountSol > 100) {
      score += 15;
    } else if (amountSol > 10) {
      score += 5;
    }

    // Clamp to 0-100
    return Math.min(100, Math.max(0, score));
  }
}

import type { CircuitBreakerState, RiskLimits, ExecutionResult } from '@makora/types';

/**
 * Circuit Breaker (RISK-03)
 *
 * Monitors cumulative daily losses and failed transactions.
 * When triggered, ALL execution halts until manually reset or daily auto-reset (midnight UTC).
 *
 * Trigger conditions:
 * 1. Daily loss exceeds maxDailyLossPct of portfolio
 * 2. More than 5 consecutive failed transactions
 *
 * The circuit breaker is a HARD stop -- it cannot be bypassed by the agent.
 * Only the user can manually reset it (via CLI or dashboard).
 */
export class CircuitBreaker {
  private state: CircuitBreakerState;
  private limits: RiskLimits;
  private portfolioValueAtStartOfDay: number;
  private lastResetDate: string; // ISO date string (YYYY-MM-DD)
  private consecutiveFailures: number = 0;
  private readonly MAX_CONSECUTIVE_FAILURES = 5;

  constructor(limits: RiskLimits, portfolioValueUsd: number) {
    this.limits = limits;
    this.portfolioValueAtStartOfDay = portfolioValueUsd;
    this.lastResetDate = this.getCurrentDateUTC();
    this.state = {
      isActive: false,
      dailyLossUsd: 0,
      failedTxCount: 0,
    };
  }

  /**
   * Get the current circuit breaker state.
   */
  getState(): CircuitBreakerState {
    // Check for auto-reset (midnight UTC)
    this.checkAutoReset();
    return { ...this.state };
  }

  /**
   * Check if the circuit breaker is currently active (tripped).
   * If active, NO transactions should be executed.
   */
  isTripped(): boolean {
    this.checkAutoReset();
    return this.state.isActive;
  }

  /**
   * Record the result of an executed transaction.
   * Updates loss tracking and checks if the breaker should trip.
   *
   * @param result - Execution result from the engine
   * @param preExecutionPortfolioValue - Portfolio value BEFORE the transaction
   * @param postExecutionPortfolioValue - Portfolio value AFTER the transaction
   */
  recordExecution(
    result: ExecutionResult,
    preExecutionPortfolioValue: number,
    postExecutionPortfolioValue: number
  ): void {
    this.checkAutoReset();

    if (!result.success) {
      this.state.failedTxCount++;
      this.consecutiveFailures++;

      // Trip on consecutive failures
      if (this.consecutiveFailures >= this.MAX_CONSECUTIVE_FAILURES) {
        this.trip(
          `${this.MAX_CONSECUTIVE_FAILURES} consecutive transaction failures. ` +
          `Possible network issue or misconfigured parameters.`
        );
      }
      return;
    }

    // Reset consecutive failure counter on success
    this.consecutiveFailures = 0;

    // Calculate loss from this transaction
    const lossDelta = preExecutionPortfolioValue - postExecutionPortfolioValue;

    if (lossDelta > 0) {
      // Portfolio decreased in value -- record as loss
      this.state.dailyLossUsd += lossDelta;

      // Check if daily loss limit is exceeded
      const maxDailyLossUsd = this.portfolioValueAtStartOfDay * (this.limits.maxDailyLossPct / 100);

      if (this.state.dailyLossUsd >= maxDailyLossUsd) {
        this.trip(
          `Daily loss $${this.state.dailyLossUsd.toFixed(2)} exceeds limit of ` +
          `$${maxDailyLossUsd.toFixed(2)} (${this.limits.maxDailyLossPct}% of ` +
          `$${this.portfolioValueAtStartOfDay.toFixed(2)} portfolio). ` +
          `All execution halted until daily reset (midnight UTC) or manual reset.`
        );
      }
    }
  }

  /**
   * Manually record a loss (for simulated or estimated losses).
   * Used when we know a loss occurred but don't have pre/post portfolio values.
   */
  recordLoss(lossUsd: number): void {
    this.checkAutoReset();

    this.state.dailyLossUsd += lossUsd;

    const maxDailyLossUsd = this.portfolioValueAtStartOfDay * (this.limits.maxDailyLossPct / 100);

    if (this.state.dailyLossUsd >= maxDailyLossUsd) {
      this.trip(
        `Daily loss $${this.state.dailyLossUsd.toFixed(2)} exceeds limit of ` +
        `$${maxDailyLossUsd.toFixed(2)} (${this.limits.maxDailyLossPct}% of ` +
        `$${this.portfolioValueAtStartOfDay.toFixed(2)} portfolio).`
      );
    }
  }

  /**
   * Manually reset the circuit breaker.
   * Only call this from user-initiated actions (CLI reset, dashboard button).
   */
  manualReset(newPortfolioValueUsd?: number): void {
    if (newPortfolioValueUsd !== undefined) {
      this.portfolioValueAtStartOfDay = newPortfolioValueUsd;
    }
    this.state = {
      isActive: false,
      dailyLossUsd: 0,
      failedTxCount: 0,
    };
    this.consecutiveFailures = 0;
    this.lastResetDate = this.getCurrentDateUTC();
  }

  /**
   * Update the risk limits.
   */
  updateLimits(limits: RiskLimits): void {
    this.limits = limits;
  }

  /**
   * Update the portfolio value baseline (called at start of day or after manual reset).
   */
  updatePortfolioBaseline(portfolioValueUsd: number): void {
    this.portfolioValueAtStartOfDay = portfolioValueUsd;
  }

  // ---- Private helpers ----

  /**
   * Trip the circuit breaker.
   */
  private trip(reason: string): void {
    this.state.isActive = true;
    this.state.activatedAt = Date.now();
    this.state.reason = reason;

    console.error(`[CIRCUIT BREAKER] TRIPPED: ${reason}`);
  }

  /**
   * Check if it is a new day (UTC) and auto-reset if so.
   */
  private checkAutoReset(): void {
    const today = this.getCurrentDateUTC();

    if (today !== this.lastResetDate) {
      // New day -- auto-reset
      this.state = {
        isActive: false,
        dailyLossUsd: 0,
        failedTxCount: 0,
      };
      this.consecutiveFailures = 0;
      this.lastResetDate = today;
    }
  }

  /**
   * Get current date in UTC as YYYY-MM-DD.
   */
  private getCurrentDateUTC(): string {
    return new Date().toISOString().split('T')[0];
  }
}

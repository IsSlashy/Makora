---
phase: 02-core-defi
plan: 06
type: execute
wave: 2
depends_on: [04, 05]
files_modified:
  - packages/risk-manager/package.json
  - packages/risk-manager/tsconfig.json
  - packages/risk-manager/src/index.ts
  - packages/risk-manager/src/risk-manager.ts
  - packages/risk-manager/src/circuit-breaker.ts
  - packages/risk-manager/src/checks/position-size.ts
  - packages/risk-manager/src/checks/slippage.ts
  - packages/risk-manager/src/checks/daily-loss.ts
  - packages/risk-manager/src/checks/sol-reserve.ts
  - packages/risk-manager/src/checks/protocol-exposure.ts
  - packages/risk-manager/src/checks/index.ts
  - packages/risk-manager/src/display.ts
autonomous: true
must_haves:
  truths:
    - "`pnpm build` compiles @makora/risk-manager without errors"
    - "Risk manager implements RiskValidator interface from @makora/execution-engine"
    - "Risk manager rejects a transaction that exceeds max position size (25% default) and returns a human-readable rejection reason"
    - "Risk manager rejects a transaction with slippage exceeding max slippage (100bps default)"
    - "Risk manager rejects a transaction that would leave less than 0.05 SOL reserve"
    - "Risk manager rejects a transaction that would put >50% of portfolio in one protocol"
    - "Circuit breaker triggers and halts all execution when daily loss exceeds threshold"
    - "Circuit breaker auto-resets at midnight UTC"
    - "Risk assessment includes a 0-100 risk score and individual check results"
    - "Risk parameters are configurable at runtime (setLimits)"
    - "RiskManager plugs directly into ExecutionEngine via setRiskValidator()"
  artifacts:
    - packages/risk-manager/dist/index.js
---

# Plan 06: Risk Manager + Circuit Breaker (RISK-01, RISK-02, RISK-03, RISK-04)

## Objective

Build the risk management system that enforces safety constraints on all agent actions. The risk manager has **VETO power** -- this is a hard architectural constraint, not a soft check. No transaction executes without passing risk validation.

After this plan completes:
- Risk manager validates all actions against configurable limits
- Actions exceeding position size, slippage, or SOL reserve limits are rejected with clear reasons
- Circuit breaker auto-halts execution when daily loss exceeds threshold
- Risk manager plugs into the execution engine as a `RiskValidator`
- Every transaction includes a risk assessment (for display in advisory mode)

## Context

- **VETO power** (RISK-01): The risk manager is the ONLY gate between action proposal and execution. The execution engine calls `riskValidator.validate()` before sending ANY transaction. If `approved === false`, the transaction is NOT sent. This is enforced at the engine level (Plan 05), not optional middleware.
- **RiskValidator interface**: Defined in `@makora/execution-engine/src/types.ts` as:
  ```typescript
  interface RiskValidator {
    validate(action: ProposedAction): Promise<RiskAssessment>;
  }
  ```
- **Risk types**: Already defined in `@makora/types/src/risk.ts`:
  - `RiskLimits` -- configurable parameters (maxPositionSizePct, maxSlippageBps, maxDailyLossPct, minSolReserve, maxProtocolExposurePct)
  - `DEFAULT_RISK_LIMITS` -- conservative defaults (25%, 100bps, 5%, 0.05 SOL, 50%)
  - `RiskAssessment` -- result of validation (approved, riskScore, checks, summary)
  - `RiskCheck` -- individual check result (name, passed, value, limit, message)
  - `CircuitBreakerState` -- breaker state (isActive, activatedAt, reason, dailyLossUsd, failedTxCount)
- **Integration point**: After building, the risk manager is registered with the execution engine:
  ```typescript
  const riskManager = new RiskManager(portfolio, connection);
  executionEngine.setRiskValidator(riskManager);
  ```
- **Portfolio state**: The risk manager needs current portfolio data to evaluate position sizes. It receives a `PortfolioReader` from `@makora/data-feed` or gets portfolio state injected.

## Tasks

### Task 1: Risk Manager Package Setup

**File: `P:\solana-agent-hackathon\packages\risk-manager\package.json`**

```json
{
  "name": "@makora/risk-manager",
  "version": "0.1.0",
  "private": true,
  "description": "Risk management and circuit breaker for Makora - VETO power over all agent actions",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "src"],
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts --clean",
    "dev": "tsup src/index.ts --format cjs,esm --dts --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@makora/types": "workspace:*",
    "@solana/web3.js": "^1.98.4"
  },
  "devDependencies": {
    "tsup": "^8.0.1",
    "typescript": "^5.3.0",
    "rimraf": "^5.0.0"
  }
}
```

**File: `P:\solana-agent-hackathon\packages\risk-manager\tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

### Task 2: Individual Risk Checks

Each check is a pure function: takes an action + context, returns a `RiskCheck`. This makes them independently testable and composable.

**File: `P:\solana-agent-hackathon\packages\risk-manager\src\checks\position-size.ts`**

```typescript
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
```

**File: `P:\solana-agent-hackathon\packages\risk-manager\src\checks\slippage.ts`**

```typescript
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
```

**File: `P:\solana-agent-hackathon\packages\risk-manager\src\checks\daily-loss.ts`**

```typescript
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
```

**File: `P:\solana-agent-hackathon\packages\risk-manager\src\checks\sol-reserve.ts`**

```typescript
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
```

**File: `P:\solana-agent-hackathon\packages\risk-manager\src\checks\protocol-exposure.ts`**

```typescript
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
```

**File: `P:\solana-agent-hackathon\packages\risk-manager\src\checks\index.ts`**

```typescript
/**
 * Risk check functions.
 *
 * Each check is a pure function: (action, context) -> RiskCheck
 * This makes them independently testable and composable.
 */

export { checkPositionSize } from './position-size.js';
export { checkSlippage } from './slippage.js';
export { checkDailyLoss } from './daily-loss.js';
export { checkSolReserve } from './sol-reserve.js';
export { checkProtocolExposure } from './protocol-exposure.js';
```

### Task 3: Circuit Breaker

The circuit breaker monitors cumulative losses and halts execution when limits are exceeded.

**File: `P:\solana-agent-hackathon\packages\risk-manager\src\circuit-breaker.ts`**

```typescript
import type { CircuitBreakerState, RiskLimits, PortfolioState, ExecutionResult } from '@makora/types';

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
```

### Task 4: Risk Assessment Display Helper

Formats risk assessments for human-readable display in CLI and logs.

**File: `P:\solana-agent-hackathon\packages\risk-manager\src\display.ts`**

```typescript
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
```

### Task 5: Risk Manager (Core)

The main risk manager class that implements the `RiskValidator` interface and orchestrates all checks.

**File: `P:\solana-agent-hackathon\packages\risk-manager\src\risk-manager.ts`**

```typescript
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
```

### Task 6: Risk Manager Package Index

**File: `P:\solana-agent-hackathon\packages\risk-manager\src\index.ts`**

```typescript
/**
 * @makora/risk-manager - Risk management with VETO power for Makora
 *
 * The risk manager validates ALL agent actions before execution.
 * It enforces configurable limits and has absolute VETO power.
 *
 * Components:
 * - RiskManager: main validator implementing RiskValidator interface
 * - CircuitBreaker: auto-halts execution on excessive losses
 * - Risk checks: position size, slippage, daily loss, SOL reserve, protocol exposure
 * - Display helpers: format risk assessments for CLI/dashboard
 *
 * Integration:
 *   const riskManager = new RiskManager(portfolioValue, limits);
 *   executionEngine.setRiskValidator(riskManager);
 *
 * RISK-01: VETO power -- hard architectural constraint
 * RISK-02: Configurable risk parameters
 * RISK-03: Circuit breaker
 * RISK-04: Risk assessment display
 */

export { RiskManager, type RiskValidator, type RiskEventCallback, type RiskEvent } from './risk-manager.js';
export { CircuitBreaker } from './circuit-breaker.js';
export {
  checkPositionSize,
  checkSlippage,
  checkDailyLoss,
  checkSolReserve,
  checkProtocolExposure,
} from './checks/index.js';
export {
  formatRiskAssessment,
  formatRiskSummary,
  formatCircuitBreakerState,
  getRiskLevel,
} from './display.js';
```

### Task 7: Install Dependencies and Build

```bash
cd P:\solana-agent-hackathon

# Install new workspace packages
pnpm install

# Build all (dependency order handled by turborepo)
pnpm build
```

Build order:
1. `@makora/types` (leaf -- re-exports DEFAULT_RISK_LIMITS)
2. `@makora/risk-manager` (depends on types only)

### Task 8: Integration Wiring

After all Phase 2 packages are built, wire them together. This is the integration code that would go in `@makora/agent-core` (Phase 3), but the wiring pattern should be verified now.

**Integration pattern** (to be implemented in agent-core/CLI):

```typescript
import { JupiterAdapter } from '@makora/adapters-jupiter';
import { MarinadeAdapter } from '@makora/adapters-marinade';
import { RaydiumAdapter } from '@makora/adapters-raydium';
import { KaminoAdapter } from '@makora/adapters-kamino';
import { AdapterRegistry, ProtocolRouter, DeFiOrchestrator } from '@makora/protocol-router';
import { ExecutionEngine } from '@makora/execution-engine';
import { RiskManager } from '@makora/risk-manager';
import { PortfolioReader, createConnection } from '@makora/data-feed';

// 1. Create connection
const connection = createConnection({ cluster: 'devnet', heliusApiKey: '...' });

// 2. Register all adapters
const registry = new AdapterRegistry();
registry.register(new JupiterAdapter());   // Swaps
registry.register(new MarinadeAdapter());  // Staking
registry.register(new RaydiumAdapter());   // LP
registry.register(new KaminoAdapter());    // Vaults

// 3. Initialize all adapters
await registry.initialize({ rpcUrl: '...', walletPublicKey: wallet.publicKey });

// 4. Create router and orchestrator
const router = new ProtocolRouter(registry);
const orchestrator = new DeFiOrchestrator();

// 5. Create risk manager
const portfolioReader = new PortfolioReader(connection, 'devnet');
const portfolio = await portfolioReader.getPortfolio(wallet.publicKey);
const riskManager = new RiskManager(portfolio.totalValueUsd);
riskManager.updatePortfolio(portfolio);

// 6. Create execution engine with risk validator
const engine = new ExecutionEngine(connection, {}, riskManager);

// 7. Execute a routed action
const result = await router.route({
  actionType: 'stake',
  protocol: 'marinade',
  params: { amount: 100_000_000n, userPublicKey: wallet.publicKey },
});

const executionResult = await engine.execute({
  instructions: result.instructions,
  signer: wallet,
  description: result.description,
});
```

## Verification

1. **Package compiles** -- `packages/risk-manager/dist/` contains compiled JavaScript and type declarations.
2. **RiskManager implements RiskValidator** -- `const rm: RiskValidator = new RiskManager()` compiles without error.
3. **Position size rejection** -- calling `validate()` with an action whose `expectedValueChange` is 50% of a $1000 portfolio (i.e., $500) when `maxPositionSizePct` is 25% returns `{ approved: false }` with a clear message mentioning "Position Size".
4. **Slippage rejection** -- calling `validate()` with an action where `maxSlippageBps` is 200 when `limits.maxSlippageBps` is 100 returns `{ approved: false }` with a clear message mentioning "Slippage".
5. **SOL reserve rejection** -- calling `validate()` with an action that would leave 0.01 SOL when `minSolReserve` is 0.05 returns `{ approved: false }` with a message mentioning "SOL Reserve".
6. **Protocol exposure rejection** -- calling `validate()` with an action putting 60% of portfolio in Marinade when `maxProtocolExposurePct` is 50% returns `{ approved: false }`.
7. **Circuit breaker trips on daily loss** -- calling `recordLoss()` with a loss exceeding `maxDailyLossPct` of portfolio causes `isTripped()` to return `true` and all subsequent `validate()` calls return `{ approved: false }` with "CIRCUIT BREAKER ACTIVE" message.
8. **Circuit breaker auto-resets** -- after tripping, simulating a day change (by manipulating the internal date) causes the breaker to reset.
9. **Manual reset works** -- calling `resetCircuitBreaker()` after a trip causes `isTripped()` to return `false`.
10. **Risk limits are configurable** -- calling `setLimits({ maxPositionSizePct: 50 })` changes the limit and subsequent validation uses the new value.
11. **Risk limits validate input** -- calling `setLimits({ maxPositionSizePct: 0 })` throws an error.
12. **Risk score is 0-100** -- for an action that barely passes all checks, the risk score is > 0 but < 100. For an action that fails all checks, the score is high (>50).
13. **formatRiskAssessment** -- produces a multi-line string with APPROVED/REJECTED, score, and individual check results.
14. **Integration with execution engine** -- calling `engine.setRiskValidator(riskManager)` and then `engine.execute()` with an over-limit action returns `{ success: false, error: 'RISK VETO: ...' }` without any transaction being sent to the network.
15. **No TypeScript errors** -- `pnpm typecheck` passes for the package.

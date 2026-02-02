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

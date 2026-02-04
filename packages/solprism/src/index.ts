/**
 * @makora/solprism — Verifiable Reasoning for Makora DeFi Agent
 *
 * SOLPRISM commit-reveal integration for the Makora OODA loop.
 * Creates cryptographic pre-commitments for every portfolio decision,
 * making the LLM-powered agent's reasoning verifiable on Solana.
 *
 * Integration points:
 * - OODA cycle decisions (Observe → Orient → Decide → Act)
 * - Risk manager VETO events
 * - Execution results
 *
 * @see https://github.com/basedmereum/axiom-protocol
 * @see Program: CZcvoryaQNrtZ3qb3gC1h9opcYpzEP1D9Mu1RVwFQeBu
 */

export {
  SolprismTracer,
  type SolprismTracerConfig,
  type CommitmentResult,
} from "./tracer.js";

export {
  createOODATrace,
  createRiskVetoTrace,
  createExecutionTrace,
  createStrategyTrace,
} from "./traces.js";

export { hashTrace, verifyTrace } from "./hash.js";

export type { ReasoningTrace } from "./types.js";

/**
 * @makora/agent-core - The intelligent agent core for Makora
 *
 * Ties the entire system together:
 *   data-feed -> strategy-engine -> risk-manager -> execution-engine -> protocol-router
 *
 * Components:
 * - MakoraAgent: top-level agent class (initialize, start, executeCommand)
 * - OODALoop: continuous decision cycle (observe -> orient -> decide -> act)
 * - NLParser: natural language command parser
 * - ActionExplainer: human-readable explanations for suggestions
 * - DecisionLog: audit trail of all agent decisions
 */

export { MakoraAgent } from './agent.js';
export { OODALoop } from './ooda-loop.js';
export { NLParser } from './nl-parser.js';
export { ActionExplainer } from './explainer.js';
export { DecisionLog } from './decision-log.js';
export {
  type AgentConfig,
  type LLMProviderConfig,
  type ParsedIntent,
  type ConfirmationCallback,
  type DecisionLogEntry,
  DEFAULT_AGENT_CONFIG,
  AUTO_CONFIRM,
  ALWAYS_REJECT,
} from './types.js';
export {
  parseLLMAnalysis,
  convertAnalysisToEvaluation,
  type LLMAnalysis,
} from './llm-orient.js';

/**
 * @makora/protocol-router - Routes agent actions to the correct DeFi adapter
 *
 * The router is the ONLY component that knows about specific adapter implementations.
 * Agent core interacts exclusively through the router.
 *
 * Components:
 * - AdapterRegistry: manages adapter lifecycle and lookup
 * - ProtocolRouter: dispatches actions to adapters
 * - DeFiOrchestrator: decomposes multi-step intents into atomic actions
 */

export { AdapterRegistry } from './registry.js';
export { ProtocolRouter, type RouteRequest, type RouteResult } from './router.js';
export {
  DeFiOrchestrator,
  type DeFiIntent,
  type OrchestrationStep,
  type OrchestrationPlan,
} from './orchestrator.js';

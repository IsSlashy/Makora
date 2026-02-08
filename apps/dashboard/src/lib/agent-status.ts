/**
 * Agent status store — globalThis-backed, shared across API routes.
 * The Telegram bot POSTs phase updates here, the dashboard GETs them.
 */

export type AgentPhase = 'IDLE' | 'OBSERVE' | 'ORIENT' | 'DECIDE' | 'ACT';

export interface AgentAction {
  timestamp: number;
  phase: AgentPhase;
  description: string;
  tool?: string;
  result?: string;
}

export interface AgentStatus {
  phase: AgentPhase;
  phaseDescription: string;
  lastUpdate: number;
  cycleCount: number;
  actions: AgentAction[];
  confidence: number;
  sentiment?: string;
}

const GLOBAL_KEY = '__makora_agent_status__';
const MAX_ACTIONS = 30;
// After 60s without update, consider agent idle
const IDLE_TIMEOUT_MS = 60_000;

function getStore(): AgentStatus {
  const g = globalThis as any;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = {
      phase: 'IDLE',
      phaseDescription: 'Agent idle',
      lastUpdate: 0,
      cycleCount: 0,
      actions: [],
      confidence: 0,
      sentiment: undefined,
    };
  }
  return g[GLOBAL_KEY];
}

export function getAgentStatus(): AgentStatus {
  const store = getStore();

  // Auto-reset to IDLE if no update for IDLE_TIMEOUT_MS
  if (store.phase !== 'IDLE' && Date.now() - store.lastUpdate > IDLE_TIMEOUT_MS) {
    store.phase = 'IDLE';
    store.phaseDescription = 'Agent idle (timeout)';
  }

  return { ...store, actions: [...store.actions] };
}

export function setAgentPhase(
  phase: AgentPhase,
  description: string,
  extra?: { tool?: string; result?: string; confidence?: number; sentiment?: string },
): void {
  const store = getStore();

  // Increment cycle count on OBSERVE (start of new cycle)
  if (phase === 'OBSERVE' && store.phase !== 'OBSERVE') {
    store.cycleCount++;
  }

  store.phase = phase;
  store.phaseDescription = description;
  store.lastUpdate = Date.now();

  if (extra?.confidence !== undefined) store.confidence = extra.confidence;
  if (extra?.sentiment !== undefined) store.sentiment = extra.sentiment;

  // Append to action log
  store.actions.push({
    timestamp: Date.now(),
    phase,
    description,
    tool: extra?.tool,
    result: extra?.result,
  });

  // Trim old actions
  if (store.actions.length > MAX_ACTIONS) {
    store.actions = store.actions.slice(-MAX_ACTIONS);
  }
}

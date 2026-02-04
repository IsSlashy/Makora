/**
 * SolprismTracer — High-level integration for Makora's OODA loop.
 *
 * Plugs into the decision cycle as an event handler.
 * Captures reasoning traces at each decision point and
 * maintains a verifiable audit trail.
 *
 * @example
 * ```typescript
 * import { SolprismTracer } from '@makora/solprism';
 *
 * const tracer = new SolprismTracer({ agentName: 'my-makora' });
 *
 * // Hook into OODA cycle (in agent-core setup):
 * // ooda.onEvent((event) => tracer.handleEvent(event));
 *
 * // Or commit directly:
 * const commitment = tracer.commitOODACycle({
 *   phase: 'act',
 *   portfolioValueUsd: 5000,
 *   proposedActions: [...],
 *   approvedActions: [...],
 *   rejectedActions: [],
 *   mode: 'autonomous',
 * });
 *
 * console.log(`Reasoning hash: ${commitment.hash}`);
 * ```
 */

import type { ReasoningTrace } from "./types.js";
import { hashTrace, verifyTrace } from "./hash.js";
import {
  createOODATrace,
  createRiskVetoTrace,
  createExecutionTrace,
  createStrategyTrace,
} from "./traces.js";

// ─── Config ──────────────────────────────────────────────────────────────

export interface SolprismTracerConfig {
  /** Agent name for traces (default: "Makora") */
  agentName?: string;
  /** Maximum commitments to keep in memory (default: 1000) */
  maxCommitments?: number;
  /** Log commitments to console (default: true) */
  verbose?: boolean;
}

// ─── Result ──────────────────────────────────────────────────────────────

export interface CommitmentResult {
  /** SHA-256 hash of the reasoning trace */
  hash: string;
  /** Full reasoning trace (for verification / reveal) */
  trace: ReasoningTrace;
  /** When the commitment was created */
  timestamp: number;
  /** Trace action type */
  actionType: string;
}

// ─── Tracer ──────────────────────────────────────────────────────────────

/**
 * SOLPRISM reasoning tracer for Makora.
 *
 * Creates and stores verifiable reasoning commitments.
 * If you want onchain commits, pair with @solprism/sdk's SolprismClient.
 */
export class SolprismTracer {
  private agentName: string;
  private commitments: CommitmentResult[] = [];
  private maxCommitments: number;
  private verbose: boolean;

  constructor(config: SolprismTracerConfig = {}) {
    this.agentName = config.agentName || "Makora";
    this.maxCommitments = config.maxCommitments || 1000;
    this.verbose = config.verbose ?? true;
  }

  // ─── Commit Methods ────────────────────────────────────────────────

  /**
   * Commit a full OODA decision cycle trace.
   */
  commitOODACycle(
    params: Parameters<typeof createOODATrace>[0]
  ): CommitmentResult {
    const trace = createOODATrace({
      ...params,
      agentName: params.agentName || this.agentName,
    });
    return this.commit(trace);
  }

  /**
   * Commit a risk manager VETO trace.
   */
  commitRiskVeto(
    params: Parameters<typeof createRiskVetoTrace>[0]
  ): CommitmentResult {
    const trace = createRiskVetoTrace({
      ...params,
      agentName: params.agentName || this.agentName,
    });
    return this.commit(trace);
  }

  /**
   * Commit an execution result trace.
   */
  commitExecution(
    params: Parameters<typeof createExecutionTrace>[0]
  ): CommitmentResult {
    const trace = createExecutionTrace({
      ...params,
      agentName: params.agentName || this.agentName,
    });
    return this.commit(trace);
  }

  /**
   * Commit a strategy/LLM analysis trace.
   */
  commitStrategy(
    params: Parameters<typeof createStrategyTrace>[0]
  ): CommitmentResult {
    const trace = createStrategyTrace({
      ...params,
      agentName: params.agentName || this.agentName,
    });
    return this.commit(trace);
  }

  /**
   * Commit an arbitrary reasoning trace.
   */
  commit(trace: ReasoningTrace): CommitmentResult {
    const hash = hashTrace(trace);

    const result: CommitmentResult = {
      hash,
      trace,
      timestamp: Date.now(),
      actionType: trace.action.type,
    };

    this.commitments.push(result);

    // Trim old commitments
    if (this.commitments.length > this.maxCommitments) {
      this.commitments = this.commitments.slice(-this.maxCommitments);
    }

    if (this.verbose) {
      console.log(
        `[SOLPRISM] 🔮 Committed: ${trace.action.type} | ` +
          `${trace.decision.actionChosen.slice(0, 50)} | ` +
          `confidence=${trace.decision.confidence}% | ` +
          `hash=${hash.slice(0, 16)}...`
      );
    }

    return result;
  }

  // ─── Verification ──────────────────────────────────────────────────

  /**
   * Verify a trace against a hash.
   */
  verify(hash: string, trace: ReasoningTrace): boolean {
    return verifyTrace(trace, hash);
  }

  // ─── Audit Trail ───────────────────────────────────────────────────

  /**
   * Get recent commitments.
   */
  getRecent(count: number = 20): CommitmentResult[] {
    return this.commitments.slice(-count).reverse();
  }

  /**
   * Get all commitments.
   */
  getAll(): CommitmentResult[] {
    return [...this.commitments];
  }

  /**
   * Get commitments by action type.
   */
  getByType(actionType: string): CommitmentResult[] {
    return this.commitments.filter((c) => c.actionType === actionType);
  }

  /**
   * Get audit statistics.
   */
  getStats(): {
    totalCommitments: number;
    byType: Record<string, number>;
    oldestTimestamp: number | null;
    newestTimestamp: number | null;
  } {
    const byType: Record<string, number> = {};
    for (const c of this.commitments) {
      byType[c.actionType] = (byType[c.actionType] || 0) + 1;
    }

    return {
      totalCommitments: this.commitments.length,
      byType,
      oldestTimestamp: this.commitments.length > 0 ? this.commitments[0].timestamp : null,
      newestTimestamp:
        this.commitments.length > 0
          ? this.commitments[this.commitments.length - 1].timestamp
          : null,
    };
  }

  /**
   * Export commitments as a JSON-serializable array.
   * Useful for batch reveal or dashboard display.
   */
  export(): Array<{ hash: string; actionType: string; timestamp: number; trace: ReasoningTrace }> {
    return this.commitments.map((c) => ({
      hash: c.hash,
      actionType: c.actionType,
      timestamp: c.timestamp,
      trace: c.trace,
    }));
  }

  /**
   * Clear all stored commitments.
   */
  clear(): void {
    this.commitments = [];
  }
}

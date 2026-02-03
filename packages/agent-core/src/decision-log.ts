import type { DecisionLogEntry } from './types.js';

/**
 * Decision Log
 *
 * Records every OODA cycle with full decision rationale.
 * This is critical for:
 * 1. "Most Agentic" judging criteria -- proves autonomous decision-making
 * 2. Dashboard transaction history -- human-readable log
 * 3. Debugging -- trace why the agent did something
 *
 * Stores the last N entries in memory. For hackathon, no persistence
 * beyond the process lifetime (real product would use a DB).
 */
export class DecisionLog {
  private entries: DecisionLogEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = 500) {
    this.maxEntries = maxEntries;
  }

  /**
   * Record a new cycle entry.
   */
  record(entry: DecisionLogEntry): void {
    this.entries.push(entry);

    // Trim old entries if over limit
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  /**
   * Get the last N entries (most recent first).
   */
  getRecent(count: number = 20): DecisionLogEntry[] {
    return this.entries.slice(-count).reverse();
  }

  /**
   * Get all entries.
   */
  getAll(): DecisionLogEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries that resulted in executed actions.
   */
  getExecutedCycles(): DecisionLogEntry[] {
    return this.entries.filter((e) => e.executedActions.length > 0);
  }

  /**
   * Get entries where the risk manager rejected actions.
   */
  getRejectedCycles(): DecisionLogEntry[] {
    return this.entries.filter((e) => e.rejectedActions.length > 0);
  }

  /**
   * Get the total number of cycles recorded.
   */
  get totalCycles(): number {
    return this.entries.length;
  }

  /**
   * Get summary statistics.
   */
  getStats(): {
    totalCycles: number;
    totalActionsProposed: number;
    totalActionsApproved: number;
    totalActionsRejected: number;
    totalActionsExecuted: number;
    avgCycleTimeMs: number;
  } {
    let totalProposed = 0;
    let totalApproved = 0;
    let totalRejected = 0;
    let totalExecuted = 0;
    let totalCycleTime = 0;

    for (const entry of this.entries) {
      totalProposed += entry.proposedActions.length;
      totalApproved += entry.approvedActions.length;
      totalRejected += entry.rejectedActions.length;
      totalExecuted += entry.executedActions.length;
      totalCycleTime += entry.phaseDurations.total;
    }

    return {
      totalCycles: this.entries.length,
      totalActionsProposed: totalProposed,
      totalActionsApproved: totalApproved,
      totalActionsRejected: totalRejected,
      totalActionsExecuted: totalExecuted,
      avgCycleTimeMs: this.entries.length > 0
        ? Math.round(totalCycleTime / this.entries.length)
        : 0,
    };
  }

  /**
   * Export the log as a JSON-serializable array.
   */
  export(): DecisionLogEntry[] {
    return [...this.entries];
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries = [];
  }
}

/**
 * Reasoning trace builders for Makora's OODA loop.
 *
 * Each builder creates a SOLPRISM-compatible trace for a specific
 * Makora decision point. These map directly to the OODA phases:
 *
 *   OBSERVE  →  (data collection, no trace needed)
 *   ORIENT   →  createStrategyTrace (LLM analysis + market signals)
 *   DECIDE   →  createOODATrace (full cycle decision)
 *   ACT      →  createExecutionTrace (trade result)
 *   VETO     →  createRiskVetoTrace (risk manager rejection)
 */

import type { ReasoningTrace, DataSource, Alternative } from "./types.js";
import { SOLPRISM_SCHEMA_VERSION } from "./types.js";

// Re-import Makora types for better integration
// (using structural typing to avoid hard coupling)

interface MakoraProposedAction {
  type: string;
  protocol: string;
  description: string;
  rationale: string;
  expectedOutcome: string;
  amount: bigint;
  maxSlippageBps: number;
  expectedValueChange: number;
  priority: number;
}

interface MakoraRiskAssessment {
  approved: boolean;
  riskScore: number;
  summary: string;
  checks: Array<{ name: string; passed: boolean; message: string }>;
}

interface MakoraExecutionResult {
  success: boolean;
  signature?: string;
  error?: string;
  computeUnits?: number;
}

// ─── OODA Cycle Trace ────────────────────────────────────────────────────

/**
 * Create a reasoning trace for a full OODA decision cycle.
 *
 * This is the primary trace — documents the complete decision with:
 * - What market data was observed
 * - What the LLM/strategy engine recommended
 * - What the risk manager approved/rejected
 * - What was ultimately executed
 */
export function createOODATrace(params: {
  agentName?: string;
  /** What phase completed */
  phase: "observe" | "orient" | "decide" | "act";
  /** Portfolio value at decision time */
  portfolioValueUsd: number;
  /** Actions proposed by strategy engine */
  proposedActions: MakoraProposedAction[];
  /** Actions approved by risk manager */
  approvedActions: MakoraProposedAction[];
  /** Actions rejected by risk manager */
  rejectedActions: MakoraProposedAction[];
  /** LLM analysis reasoning (if available) */
  llmReasoning?: string;
  /** Agent operating mode */
  mode: "autonomous" | "advisory";
  /** Cycle duration in ms */
  cycleTimeMs?: number;
}): ReasoningTrace {
  const totalProposed = params.proposedActions.length;
  const totalApproved = params.approvedActions.length;
  const totalRejected = params.rejectedActions.length;

  const observations: string[] = [
    `OODA phase: ${params.phase.toUpperCase()}`,
    `Mode: ${params.mode}`,
    `Portfolio value: $${params.portfolioValueUsd.toFixed(2)}`,
    `Actions proposed: ${totalProposed}`,
    `Actions approved: ${totalApproved}`,
    `Actions rejected: ${totalRejected}`,
  ];

  // Add action details
  for (const action of params.proposedActions) {
    observations.push(
      `Proposed: ${action.description} (${action.protocol}, priority=${action.priority})`
    );
  }

  for (const action of params.rejectedActions) {
    observations.push(`Rejected: ${action.description} — ${action.rationale}`);
  }

  const dataSources: DataSource[] = [
    {
      name: "Makora Portfolio Reader",
      type: "onchain",
      queriedAt: new Date().toISOString(),
      summary: `Portfolio: $${params.portfolioValueUsd.toFixed(2)}`,
    },
    {
      name: "Makora Strategy Engine",
      type: "internal",
      queriedAt: new Date().toISOString(),
      summary: `${totalProposed} actions proposed across protocols`,
    },
    {
      name: "Makora Risk Manager",
      type: "internal",
      queriedAt: new Date().toISOString(),
      summary: `${totalApproved} approved, ${totalRejected} rejected`,
    },
  ];

  if (params.llmReasoning) {
    dataSources.push({
      name: "LLM Analysis (ORIENT phase)",
      type: "llm",
      queriedAt: new Date().toISOString(),
      summary: params.llmReasoning.slice(0, 200),
    });
  }

  const alternatives: Alternative[] = params.rejectedActions.map((a) => ({
    action: a.description,
    reasonRejected: `Risk manager VETO: ${a.rationale}`,
  }));

  if (totalApproved === 0 && totalProposed > 0) {
    alternatives.push({
      action: "Execute proposed actions",
      reasonRejected: "All actions were rejected by risk manager",
    });
  }

  const confidence =
    totalProposed > 0
      ? Math.round((totalApproved / totalProposed) * 100)
      : 50; // no actions = neutral confidence

  return {
    version: SOLPRISM_SCHEMA_VERSION,
    agent: params.agentName || "Makora",
    timestamp: Date.now(),
    action: {
      type: "decision",
      description: totalApproved > 0
        ? `OODA cycle: ${totalApproved} action(s) approved for execution`
        : totalProposed > 0
          ? `OODA cycle: all ${totalProposed} action(s) rejected by risk manager`
          : `OODA cycle: no actions proposed (market conditions stable)`,
    },
    inputs: { dataSources, context: "Makora OODA decision cycle" },
    analysis: {
      observations,
      logic: params.llmReasoning || `Strategy engine proposed ${totalProposed} actions. Risk manager approved ${totalApproved}.`,
      alternativesConsidered: alternatives,
    },
    decision: {
      actionChosen: totalApproved > 0
        ? params.approvedActions.map((a) => a.description).join("; ")
        : "Hold — no actions approved",
      confidence,
      riskAssessment: totalRejected > 0 ? "moderate" : totalApproved > 0 ? "low" : "low",
      expectedOutcome: totalApproved > 0
        ? `Execute ${totalApproved} action(s) with risk manager approval`
        : "Maintain current positions",
    },
    metadata: {
      executionTimeMs: params.cycleTimeMs,
      custom: {
        mode: params.mode,
        phase: params.phase,
        proposedCount: totalProposed,
        approvedCount: totalApproved,
        rejectedCount: totalRejected,
        portfolioUsd: Math.round(params.portfolioValueUsd),
      },
    },
  };
}

// ─── Risk VETO Trace ─────────────────────────────────────────────────────

/**
 * Create a reasoning trace for a risk manager VETO.
 *
 * Critical for accountability: when the risk manager blocks an action,
 * the reasoning must be documented and verifiable.
 */
export function createRiskVetoTrace(params: {
  agentName?: string;
  action: MakoraProposedAction;
  assessment: MakoraRiskAssessment;
  portfolioValueUsd: number;
}): ReasoningTrace {
  const failedChecks = params.assessment.checks.filter((c) => !c.passed);

  return {
    version: SOLPRISM_SCHEMA_VERSION,
    agent: params.agentName || "Makora",
    timestamp: Date.now(),
    action: {
      type: "rejection",
      description: `RISK VETO: ${params.action.description}`,
    },
    inputs: {
      dataSources: [
        {
          name: "Makora Risk Manager",
          type: "internal",
          queriedAt: new Date().toISOString(),
          summary: params.assessment.summary,
        },
      ],
      context: "Risk manager rejected a proposed action",
    },
    analysis: {
      observations: [
        `Action: ${params.action.description}`,
        `Protocol: ${params.action.protocol}`,
        `Risk score: ${params.assessment.riskScore}/100`,
        `Failed checks: ${failedChecks.map((c) => c.name).join(", ") || "none"}`,
        ...failedChecks.map((c) => `  ❌ ${c.name}: ${c.message}`),
        `Portfolio: $${params.portfolioValueUsd.toFixed(2)}`,
      ],
      logic: params.assessment.summary,
      alternativesConsidered: [
        {
          action: `Execute ${params.action.description}`,
          reasonRejected: params.assessment.summary,
        },
      ],
    },
    decision: {
      actionChosen: "VETO — action blocked by risk manager",
      confidence: 95,
      riskAssessment: "high",
      expectedOutcome: "Action prevented, portfolio protected",
    },
    metadata: {
      custom: {
        riskScore: params.assessment.riskScore,
        failedChecks: failedChecks.length,
        protocol: params.action.protocol,
      },
    },
  };
}

// ─── Execution Trace ─────────────────────────────────────────────────────

/**
 * Create a reasoning trace for a completed execution.
 *
 * Documents the AFTER — what was the actual result of the trade.
 * Pair this with the OODA trace (the BEFORE) for a complete audit trail.
 */
export function createExecutionTrace(params: {
  agentName?: string;
  action: MakoraProposedAction;
  result: MakoraExecutionResult;
  prePortfolioValueUsd: number;
  postPortfolioValueUsd?: number;
}): ReasoningTrace {
  const valueChange = params.postPortfolioValueUsd
    ? params.postPortfolioValueUsd - params.prePortfolioValueUsd
    : undefined;

  return {
    version: SOLPRISM_SCHEMA_VERSION,
    agent: params.agentName || "Makora",
    timestamp: Date.now(),
    action: {
      type: "trade",
      description: params.result.success
        ? `EXECUTED: ${params.action.description}`
        : `FAILED: ${params.action.description}`,
      transactionSignature: params.result.signature,
    },
    inputs: {
      dataSources: [
        {
          name: "Solana Transaction",
          type: "onchain",
          queriedAt: new Date().toISOString(),
          summary: params.result.success
            ? `Confirmed: ${params.result.signature?.slice(0, 16)}...`
            : `Failed: ${params.result.error}`,
        },
      ],
      context: "Post-execution result recording",
    },
    analysis: {
      observations: [
        `Action: ${params.action.description}`,
        `Success: ${params.result.success}`,
        ...(params.result.signature
          ? [`Signature: ${params.result.signature}`]
          : []),
        ...(params.result.error ? [`Error: ${params.result.error}`] : []),
        ...(params.result.computeUnits
          ? [`Compute units: ${params.result.computeUnits}`]
          : []),
        `Pre-trade portfolio: $${params.prePortfolioValueUsd.toFixed(2)}`,
        ...(valueChange !== undefined
          ? [`Value change: ${valueChange >= 0 ? "+" : ""}$${valueChange.toFixed(2)}`]
          : []),
      ],
      logic: params.result.success
        ? `Trade executed successfully via ${params.action.protocol}.`
        : `Trade failed: ${params.result.error}`,
      alternativesConsidered: [],
    },
    decision: {
      actionChosen: params.result.success
        ? params.action.description
        : "Execution failed",
      confidence: params.result.success ? 100 : 0,
      riskAssessment: params.result.success
        ? "low"
        : "high",
      expectedOutcome: params.result.success
        ? params.action.expectedOutcome
        : "Retry or investigate failure",
    },
    metadata: {
      custom: {
        protocol: params.action.protocol,
        success: params.result.success,
        ...(params.result.computeUnits && {
          computeUnits: params.result.computeUnits,
        }),
        ...(valueChange !== undefined && {
          valueChangeUsd: Math.round(valueChange * 100) / 100,
        }),
      },
    },
  };
}

// ─── Strategy Analysis Trace ─────────────────────────────────────────────

/**
 * Create a reasoning trace for the ORIENT phase (LLM analysis).
 *
 * Documents the LLM's market analysis, sentiment assessment,
 * and recommended allocation — the "thinking" step.
 */
export function createStrategyTrace(params: {
  agentName?: string;
  llmModel?: string;
  sentiment: string;
  confidence: number;
  allocation: Record<string, number>;
  reasoning: string;
  polymarketSignals?: Array<{
    question: string;
    probability: number;
  }>;
  portfolioValueUsd: number;
}): ReasoningTrace {
  const dataSources: DataSource[] = [
    {
      name: "LLM Market Analysis",
      type: "llm",
      queriedAt: new Date().toISOString(),
      summary: `Sentiment: ${params.sentiment}, Confidence: ${params.confidence}%`,
    },
  ];

  if (params.polymarketSignals && params.polymarketSignals.length > 0) {
    dataSources.push({
      name: "Polymarket Prediction Markets",
      type: "api",
      queriedAt: new Date().toISOString(),
      summary: `${params.polymarketSignals.length} market signals`,
    });
  }

  const observations: string[] = [
    `LLM sentiment: ${params.sentiment}`,
    `LLM confidence: ${params.confidence}%`,
    `Recommended allocation: ${Object.entries(params.allocation)
      .map(([k, v]) => `${k}=${v}%`)
      .join(", ")}`,
    `Portfolio: $${params.portfolioValueUsd.toFixed(2)}`,
  ];

  if (params.polymarketSignals) {
    for (const signal of params.polymarketSignals.slice(0, 3)) {
      observations.push(
        `Polymarket: "${signal.question.slice(0, 60)}" → ${(signal.probability * 100).toFixed(0)}%`
      );
    }
  }

  return {
    version: SOLPRISM_SCHEMA_VERSION,
    agent: params.agentName || "Makora",
    timestamp: Date.now(),
    action: {
      type: "analysis",
      description: `ORIENT: ${params.sentiment} sentiment, ${params.confidence}% confidence`,
    },
    inputs: { dataSources, context: "Makora ORIENT phase — LLM market analysis" },
    analysis: {
      observations,
      logic: params.reasoning,
      alternativesConsidered: [],
    },
    decision: {
      actionChosen: `Allocation: ${Object.entries(params.allocation)
        .map(([k, v]) => `${k}=${v}%`)
        .join(", ")}`,
      confidence: params.confidence,
      riskAssessment: params.confidence >= 70 ? "low" : params.confidence >= 40 ? "moderate" : "high",
      expectedOutcome: `Apply ${params.sentiment} strategy with ${params.confidence}% confidence`,
    },
    metadata: {
      model: params.llmModel,
      custom: {
        sentiment: params.sentiment,
        portfolioUsd: Math.round(params.portfolioValueUsd),
      },
    },
  };
}

/**
 * SOLPRISM reasoning trace types.
 * Compatible with @solprism/sdk@0.1.0 schema.
 */

export const SOLPRISM_SCHEMA_VERSION = "1.0.0";

export interface ReasoningTrace {
  version: string;
  agent: string;
  timestamp: number;
  action: {
    type: string;
    description: string;
    transactionSignature?: string;
  };
  inputs: {
    dataSources: DataSource[];
    context: string;
  };
  analysis: {
    observations: string[];
    logic: string;
    alternativesConsidered: Alternative[];
  };
  decision: {
    actionChosen: string;
    confidence: number;
    riskAssessment: string;
    expectedOutcome: string;
  };
  metadata?: {
    model?: string;
    sessionId?: string;
    executionTimeMs?: number;
    custom?: Record<string, string | number | boolean>;
  };
}

export interface DataSource {
  name: string;
  type: string;
  queriedAt: string;
  summary: string;
}

export interface Alternative {
  action: string;
  reasonRejected: string;
}

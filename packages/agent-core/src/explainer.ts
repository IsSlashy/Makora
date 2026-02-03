import type {
  ProposedAction,
  ValidatedAction,
  RiskAssessment,
  PortfolioState,
} from '@makora/types';
import type { StrategySignal, YieldOpportunity } from '@makora/types';
import type { StrategyEvaluation } from '@makora/strategy-engine';
import type { MarketCondition } from '@makora/strategy-engine';

/**
 * Action Explainer (AGENT-05)
 *
 * Generates clear, human-readable explanations for every agent suggestion.
 * Each explanation includes:
 * 1. WHAT: What action is being proposed
 * 2. WHY: Why this action is recommended right now
 * 3. OUTCOME: What the expected result is
 * 4. RISK: What could go wrong
 * 5. NUMBERS: Expected yield, risk score, amounts
 */
export class ActionExplainer {
  /**
   * Generate a full explanation for an advisory-mode suggestion.
   */
  explainSuggestion(
    signal: StrategySignal,
    evaluation: StrategyEvaluation,
    portfolio: PortfolioState,
  ): string {
    const sections: string[] = [];

    // Header
    sections.push(`Strategy: ${signal.strategyName} (${signal.type})`);
    sections.push(`Confidence: ${signal.confidence}/100`);
    sections.push('');

    // Market context
    sections.push(`Market Context:`);
    sections.push(`  ${evaluation.marketCondition.summary}`);
    sections.push('');

    // Portfolio context
    sections.push(`Your Portfolio:`);
    sections.push(`  Total Value: $${portfolio.totalValueUsd.toFixed(2)}`);
    sections.push(`  SOL Balance: ${portfolio.solBalance.toFixed(4)} SOL`);
    sections.push('');

    // Actions
    if (signal.actions.length === 0) {
      sections.push(`Recommendation: No action needed. Portfolio is well-positioned.`);
    } else {
      sections.push(`Proposed Actions (${signal.actions.length}):`);
      sections.push('');

      for (let i = 0; i < signal.actions.length; i++) {
        const action = signal.actions[i];
        sections.push(`  ${i + 1}. ${action.description}`);
        sections.push(`     Why: ${action.rationale}`);
        sections.push(`     Expected: ${action.expectedOutcome}`);
        sections.push('');
      }
    }

    // Expected outcome
    if (signal.expectedApy && signal.expectedApy > 0) {
      sections.push(`Expected APY: ${signal.expectedApy.toFixed(1)}%`);
    }
    sections.push(`Risk Score: ${signal.riskScore}/100`);

    // Strategy explanation
    sections.push('');
    sections.push(`Analysis: ${signal.explanation}`);

    return sections.join('\n');
  }

  /**
   * Generate a compact one-line explanation for a single action.
   */
  explainAction(action: ProposedAction): string {
    return `${action.description} -- ${action.rationale}`;
  }

  /**
   * Generate an explanation for a risk rejection.
   */
  explainRejection(action: ProposedAction, assessment: RiskAssessment): string {
    const sections: string[] = [];

    sections.push(`REJECTED: ${action.description}`);
    sections.push(`Reason: ${assessment.summary}`);
    sections.push('');
    sections.push(`Risk Checks:`);

    for (const check of assessment.checks) {
      const icon = check.passed ? 'PASS' : 'FAIL';
      sections.push(`  [${icon}] ${check.name}: ${check.message}`);
    }

    return sections.join('\n');
  }

  /**
   * Generate an explanation for an auto-mode execution.
   */
  explainAutoExecution(
    action: ValidatedAction,
    success: boolean,
    signature?: string,
    error?: string,
  ): string {
    if (success) {
      return (
        `AUTO EXECUTED: ${action.description}\n` +
        `Rationale: ${action.rationale}\n` +
        `Risk Score: ${action.riskAssessment.riskScore}/100\n` +
        `TX: ${signature ?? 'N/A'}`
      );
    } else {
      return (
        `AUTO EXECUTION FAILED: ${action.description}\n` +
        `Error: ${error ?? 'Unknown error'}\n` +
        `The action was approved by the risk manager but failed on-chain.`
      );
    }
  }

  /**
   * Generate a cycle summary for the decision log.
   */
  explainCycle(
    mode: string,
    marketSummary: string,
    proposed: number,
    approved: number,
    rejected: number,
    executed: number,
    durationMs: number,
  ): string {
    return (
      `OODA Cycle Complete (${mode} mode, ${durationMs}ms)\n` +
      `Market: ${marketSummary}\n` +
      `Actions: ${proposed} proposed, ${approved} approved, ${rejected} rejected, ${executed} executed`
    );
  }
}

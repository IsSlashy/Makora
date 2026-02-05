'use client';

import { useEffect } from 'react';
import { useSelfEvaluation, type PastDecision } from '@/hooks/useSelfEvaluation';

interface SelfEvaluationPanelProps {
  /** Past decisions to evaluate — sourced from activity/execution history */
  decisions: PastDecision[];
  /** LLM config for running the evaluation */
  llmConfig: { provider: string; apiKey: string; model: string } | null;
}

const CONFIDENCE_COLORS: Record<string, string> = {
  positive: 'text-positive bg-positive/10 border-positive/30',
  negative: 'text-negative bg-negative/10 border-negative/30',
  neutral: 'text-caution bg-caution/10 border-caution/30',
};

function getConfidenceStyle(adj: number): string {
  if (adj > 0) return CONFIDENCE_COLORS.positive;
  if (adj < 0) return CONFIDENCE_COLORS.negative;
  return CONFIDENCE_COLORS.neutral;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const SelfEvaluationPanel = ({ decisions, llmConfig }: SelfEvaluationPanelProps) => {
  const { evaluation, isEvaluating, evaluate, loadEvaluation } = useSelfEvaluation();

  // Load persisted evaluation on mount
  useEffect(() => {
    loadEvaluation();
  }, [loadEvaluation]);

  const canEvaluate = llmConfig?.apiKey && decisions.length >= 3 && !isEvaluating;

  const handleRunEvaluation = () => {
    if (!llmConfig) return;
    evaluate(decisions, llmConfig);
  };

  return (
    <div className="cursed-card p-5 animate-fade-up">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-base text-cursed">&#x1D5E5;</span>
          <div className="section-title">Agent Self-Evaluation</div>
        </div>
        <button
          onClick={handleRunEvaluation}
          disabled={!canEvaluate}
          className="text-[9px] font-mono tracking-[0.15em] uppercase px-3 py-1.5 bg-cursed/10 border border-cursed/30 text-cursed hover:bg-cursed/20 transition-colors font-bold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isEvaluating ? 'EVALUATING...' : 'RUN EVALUATION'}
        </button>
      </div>

      {/* Evaluating spinner */}
      {isEvaluating && (
        <div className="space-y-3 mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-cursed animate-pulse rounded-full" />
            <span className="text-[10px] font-mono text-cursed tracking-wider animate-pulse">
              Analyzing past decisions...
            </span>
          </div>
          <div className="h-1 bg-bg-inner overflow-hidden">
            <div className="h-full bg-cursed/30 animate-shimmer" style={{ width: '60%' }} />
          </div>
        </div>
      )}

      {/* No LLM configured */}
      {!llmConfig?.apiKey && !evaluation && (
        <div className="text-[10px] text-text-muted font-mono text-center py-6 tracking-wider">
          Configure an LLM in Settings to enable self-evaluation
        </div>
      )}

      {/* Not enough decisions */}
      {llmConfig?.apiKey && decisions.length < 3 && !evaluation && (
        <div className="text-[10px] text-text-muted font-mono text-center py-6 tracking-wider">
          Need at least 3 past decisions to evaluate (currently {decisions.length})
        </div>
      )}

      {/* Evaluation results */}
      {evaluation && !isEvaluating && (
        <div className="space-y-4">
          {/* Top metrics row */}
          <div className="flex items-center gap-3">
            {/* Win Rate */}
            <div className="flex-1 p-3 bg-bg-inner border border-cursed/8">
              <div className="text-[9px] font-mono text-text-muted tracking-wider uppercase mb-1">Win Rate</div>
              <div className={`text-lg font-mono font-bold ${evaluation.winRate >= 0.5 ? 'text-positive' : 'text-negative'}`}>
                {(evaluation.winRate * 100).toFixed(0)}%
              </div>
              <div className="text-[9px] font-mono text-text-muted">
                {evaluation.totalDecisions} decisions
              </div>
            </div>

            {/* Confidence Adjustment */}
            <div className="flex-1 p-3 bg-bg-inner border border-cursed/8">
              <div className="text-[9px] font-mono text-text-muted tracking-wider uppercase mb-1">Confidence Adj.</div>
              <div className="flex items-center gap-2">
                <span className={`text-lg font-mono font-bold ${evaluation.confidenceAdjustment >= 0 ? 'text-positive' : 'text-negative'}`}>
                  {evaluation.confidenceAdjustment > 0 ? '+' : ''}{evaluation.confidenceAdjustment}
                </span>
                <span className={`text-[9px] font-mono px-2 py-0.5 border ${getConfidenceStyle(evaluation.confidenceAdjustment)}`}>
                  {evaluation.confidenceAdjustment > 2 ? 'MORE AGGRESSIVE' :
                   evaluation.confidenceAdjustment < -2 ? 'MORE CAUTIOUS' : 'STEADY'}
                </span>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="p-3 bg-bg-inner border border-cursed/12">
            <div className="text-[9px] font-mono text-text-muted tracking-wider uppercase mb-2">Summary</div>
            <div className="text-[11px] font-mono text-text-secondary leading-relaxed">
              {evaluation.summary}
            </div>
          </div>

          {/* Patterns detected */}
          {evaluation.patterns.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[9px] font-mono text-text-muted tracking-wider uppercase">Patterns Detected</div>
              {evaluation.patterns.map((pattern, i) => (
                <div key={i} className="flex items-start gap-2 text-[10px] font-mono text-text-secondary">
                  <span className="text-cursed/60 mt-0.5 flex-shrink-0">&bull;</span>
                  <span>{pattern}</span>
                </div>
              ))}
            </div>
          )}

          {/* Adjustments */}
          {evaluation.adjustments.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[9px] font-mono text-text-muted tracking-wider uppercase">Recommended Adjustments</div>
              {evaluation.adjustments.map((adj, i) => (
                <div key={i} className="flex items-start gap-2 text-[10px] font-mono text-text-secondary">
                  <span className="text-caution/60 mt-0.5 flex-shrink-0">&rsaquo;</span>
                  <span>{adj}</span>
                </div>
              ))}
            </div>
          )}

          {/* Timestamp */}
          <div className="pt-3 border-t border-cursed/8 text-[9px] font-mono text-text-muted tracking-wider">
            Last evaluated: {formatTimestamp(evaluation.evaluatedAt)}
          </div>
        </div>
      )}
    </div>
  );
};

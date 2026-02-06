'use client';

import type { LLMOrientState, LLMAnalysisResult } from '@/hooks/useOODALoop';

interface LLMReasoningPanelProps {
  llmOrient: LLMOrientState;
  phase: string;
}

const SENTIMENT_COLORS = {
  bullish: 'text-positive',
  neutral: 'text-caution',
  bearish: 'text-negative',
};

const SENTIMENT_BG = {
  bullish: 'bg-positive/10 border-positive/20',
  neutral: 'bg-caution/10 border-caution/20',
  bearish: 'bg-negative/10 border-negative/20',
};

export const LLMReasoningPanel = ({ llmOrient, phase }: LLMReasoningPanelProps) => {
  const { analysis, reasoning, provider, model, latencyMs, error } = llmOrient;
  const isThinking = phase === 'ORIENT' && provider && !analysis && !error;

  return (
    <div className="cursed-card p-5 animate-fade-up">
      <div className="flex items-center justify-between mb-4">
        <div className="section-title">LLM Reasoning</div>
        {provider && (
          <div className="flex items-center gap-2">
            <div className="text-[11px] md:text-[9px] font-mono tracking-wider text-text-muted bg-bg-inner border border-cursed/15 px-2 py-0.5">
              {model || provider}
            </div>
            {latencyMs > 0 && (
              <div className="text-[11px] md:text-[9px] font-mono text-text-muted">
                {(latencyMs / 1000).toFixed(1)}s
              </div>
            )}
          </div>
        )}
      </div>

      {isThinking ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-cursed animate-pulse rounded-full" />
            <span className="text-[10px] font-mono text-cursed tracking-wider animate-pulse">
              Analyzing market conditions...
            </span>
          </div>
          <div className="h-1 bg-bg-inner overflow-hidden">
            <div className="h-full bg-cursed/30 animate-shimmer" style={{ width: '60%' }} />
          </div>
        </div>
      ) : error ? (
        <div className="space-y-3">
          {/* LLM Required Warning */}
          <div className="p-4 bg-negative/10 border border-negative/30 rounded">
            <div className="flex items-start gap-2">
              <span className="text-negative text-lg">⚠</span>
              <div className="flex-1">
                <p className="text-[11px] font-mono font-bold text-negative tracking-wide uppercase mb-1">
                  LLM REQUIRED
                </p>
                <p className="text-[10px] font-mono text-negative/90 leading-relaxed">
                  {error}
                </p>
                <p className="text-[10px] font-mono text-negative/70 mt-2 leading-relaxed">
                  MoltBot will <span className="font-bold">HOLD</span> all positions until LLM is configured and working.
                  No automated trades will be executed without AI analysis.
                </p>
              </div>
            </div>
          </div>
          {/* Configuration hint */}
          <div className="p-3 bg-bg-inner border border-cursed/10">
            <p className="text-[11px] md:text-[9px] font-mono text-text-muted tracking-wider uppercase mb-1">
              How to fix:
            </p>
            <ol className="text-[10px] font-mono text-text-secondary space-y-1 list-decimal list-inside">
              <li>Open <span className="text-cursed">Settings</span> panel</li>
              <li>Add your LLM API key (Anthropic, OpenAI, or local model)</li>
              <li>Click <span className="text-cursed">Test Connection</span> to verify</li>
            </ol>
          </div>
        </div>
      ) : analysis ? (
        <div className="space-y-4">
          {/* Sentiment badge */}
          <div className={`inline-flex items-center gap-2 px-3 py-1.5 border ${SENTIMENT_BG[analysis.marketAssessment.sentiment]}`}>
            <span className={`text-[11px] font-mono font-bold uppercase ${SENTIMENT_COLORS[analysis.marketAssessment.sentiment]}`}>
              {analysis.marketAssessment.sentiment}
            </span>
            <span className="text-[10px] font-mono text-text-secondary">
              {analysis.marketAssessment.confidence}% confidence
            </span>
          </div>

          {/* Reasoning */}
          <div className="text-[11px] font-mono text-text-secondary leading-relaxed">
            {reasoning}
          </div>

          {/* Key factors */}
          {analysis.marketAssessment.keyFactors.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] md:text-[9px] font-mono text-text-muted tracking-wider uppercase">Key Factors</div>
              <div className="flex flex-wrap gap-1.5">
                {analysis.marketAssessment.keyFactors.map((f, i) => (
                  <span key={i} className="text-[11px] md:text-[9px] font-mono px-2 py-0.5 bg-bg-inner border border-cursed/10 text-text-secondary">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Allocation table */}
          {analysis.allocation.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[11px] md:text-[9px] font-mono text-text-muted tracking-wider uppercase">Recommended Allocation</div>
              {analysis.allocation.map((a, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] font-mono p-2 bg-bg-inner border border-cursed/5">
                  <div className="flex items-center gap-2">
                    <span className="text-text-primary font-bold">{a.token}</span>
                    <span className="text-text-muted">{a.action}</span>
                    <span className="text-text-muted">via {a.protocol}</span>
                  </div>
                  <span className="text-cursed font-bold">{a.percentOfPortfolio}%</span>
                </div>
              ))}
            </div>
          )}

          {/* Risk warnings */}
          {analysis.riskAssessment.warnings.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] md:text-[9px] font-mono text-text-muted tracking-wider uppercase">Warnings</div>
              {analysis.riskAssessment.warnings.map((w, i) => (
                <div key={i} className="text-[10px] font-mono text-caution flex items-start gap-1.5">
                  <span className="text-caution/60 mt-0.5">!</span>
                  {w}
                </div>
              ))}
            </div>
          )}

          {/* Explanation */}
          <div className="pt-3 border-t border-cursed/8 text-[10px] font-mono text-text-muted leading-relaxed">
            {analysis.explanation}
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-text-muted font-mono text-center py-6 tracking-wider">
          Waiting for next OODA cycle...
        </div>
      )}
    </div>
  );
};

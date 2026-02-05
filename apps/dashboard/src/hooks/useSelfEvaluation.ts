'use client';
import { useState, useCallback } from 'react';

interface PastDecision {
  timestamp: number;
  action: string;
  reasoning: string;
  outcome: 'profit' | 'loss' | 'neutral';
  pnlPercent: number;
}

interface SelfEvaluation {
  evaluatedAt: number;
  totalDecisions: number;
  winRate: number;
  patterns: string[];
  adjustments: string[];
  confidenceAdjustment: number; // -10 to +10
  summary: string;
}

export type { PastDecision, SelfEvaluation };

export function useSelfEvaluation() {
  const [evaluation, setEvaluation] = useState<SelfEvaluation | null>(null);
  const [isEvaluating, setIsEvaluating] = useState(false);

  const evaluate = useCallback(async (
    decisions: PastDecision[],
    llmConfig: { provider: string; apiKey: string; model: string }
  ) => {
    if (!llmConfig.apiKey || decisions.length < 3) return null;
    setIsEvaluating(true);

    try {
      // Build a summary of past decisions for the LLM
      const decisionSummary = decisions.slice(-20).map((d, i) =>
        `${i+1}. ${d.action} | ${d.outcome} (${d.pnlPercent > 0 ? '+' : ''}${d.pnlPercent.toFixed(1)}%) | Reasoning: ${d.reasoning}`
      ).join('\n');

      const winRate = decisions.filter(d => d.outcome === 'profit').length / decisions.length;

      const prompt = `You are Makora, an autonomous DeFi trading agent on Solana. Evaluate your recent trading decisions and provide a self-assessment.

## Your Recent Decisions (${decisions.length} total, win rate: ${(winRate * 100).toFixed(0)}%):
${decisionSummary}

## Provide your self-evaluation as JSON:
{
  "patterns": ["pattern 1 you noticed", "pattern 2", ...],
  "adjustments": ["what you'd change going forward", ...],
  "confidenceAdjustment": <number from -10 to +10, negative means be more cautious>,
  "summary": "1-2 sentence self-evaluation"
}

Be honest and analytical. If you're losing, admit what's going wrong. If winning, identify what's working.
Respond ONLY with the JSON object.`;

      // Call the LLM API
      const response = await fetch('/api/llm/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: llmConfig.provider,
          apiKey: llmConfig.apiKey,
          model: llmConfig.model,
          prompt,
          temperature: 0.3,
        }),
      });

      if (!response.ok) throw new Error('LLM evaluation failed');

      const data = await response.json();
      // Parse the LLM response - it should be JSON
      let parsed;
      try {
        const text = data.analysis || data.content || data.text || JSON.stringify(data);
        // Extract JSON from response (might have markdown wrapping)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
      } catch {
        parsed = null;
      }

      const evalResult: SelfEvaluation = {
        evaluatedAt: Date.now(),
        totalDecisions: decisions.length,
        winRate,
        patterns: parsed?.patterns || ['Insufficient data for pattern detection'],
        adjustments: parsed?.adjustments || ['Continue gathering data'],
        confidenceAdjustment: Math.max(-10, Math.min(10, parsed?.confidenceAdjustment || 0)),
        summary: parsed?.summary || `Win rate: ${(winRate * 100).toFixed(0)}%. ${decisions.length} decisions evaluated.`,
      };

      setEvaluation(evalResult);
      // Persist in localStorage
      localStorage.setItem('makora-self-evaluation', JSON.stringify(evalResult));
      return evalResult;
    } catch (err) {
      console.error('Self-evaluation failed:', err);
      return null;
    } finally {
      setIsEvaluating(false);
    }
  }, []);

  // Load persisted evaluation on mount
  const loadEvaluation = useCallback(() => {
    try {
      const stored = localStorage.getItem('makora-self-evaluation');
      if (stored) setEvaluation(JSON.parse(stored));
    } catch {}
  }, []);

  return { evaluation, isEvaluating, evaluate, loadEvaluation };
}

/**
 * LLM-powered ORIENT phase for the OODA loop.
 *
 * Converts LLMAnalysis (from any provider) into a StrategyEvaluation
 * compatible with the existing decision pipeline.
 */

import type { MarketData, ProposedAction, StrategySignal, StrategyType, YieldOpportunity } from '@makora/types';
import type { StrategyEvaluation } from '@makora/strategy-engine';
import type { MarketCondition } from '@makora/strategy-engine';

export interface LLMAnalysis {
  marketAssessment: {
    sentiment: 'bullish' | 'neutral' | 'bearish';
    confidence: number;
    reasoning: string;
    keyFactors: string[];
  };
  allocation: Array<{
    protocol: string;
    action: string;
    token: string;
    percentOfPortfolio: number;
    rationale: string;
  }>;
  riskAssessment: {
    overallRisk: number;
    warnings: string[];
  };
  explanation: string;
}

const SENTIMENT_TO_TREND: Record<string, 'bullish' | 'neutral' | 'bearish'> = {
  bullish: 'bullish',
  neutral: 'neutral',
  bearish: 'bearish',
};

const ACTION_TO_ACTION_TYPE: Record<string, string> = {
  stake: 'stake',
  lend: 'deposit',
  swap: 'swap',
  hold: 'swap', // hold doesn't produce an action
  lp: 'provide_liquidity',
};

const PROTOCOL_TO_ID: Record<string, string> = {
  jupiter: 'jupiter',
  marinade: 'marinade',
  raydium: 'raydium',
  kamino: 'kamino',
};

/**
 * Parse raw LLM response text into a validated LLMAnalysis object.
 * Falls back to safe defaults on parse failure.
 */
export function parseLLMAnalysis(raw: string): LLMAnalysis {
  try {
    // Extract JSON from possible markdown code blocks
    let jsonStr = raw.trim();
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    const parsed = JSON.parse(jsonStr);

    // Validate required fields with safe defaults
    return {
      marketAssessment: {
        sentiment: ['bullish', 'neutral', 'bearish'].includes(parsed.marketAssessment?.sentiment)
          ? parsed.marketAssessment.sentiment
          : 'neutral',
        confidence: clamp(parsed.marketAssessment?.confidence ?? 50, 0, 100),
        reasoning: String(parsed.marketAssessment?.reasoning ?? 'Analysis unavailable'),
        keyFactors: Array.isArray(parsed.marketAssessment?.keyFactors)
          ? parsed.marketAssessment.keyFactors.map(String)
          : [],
      },
      allocation: Array.isArray(parsed.allocation)
        ? parsed.allocation.slice(0, 5).map((a: Record<string, unknown>) => ({
            protocol: String(a.protocol ?? 'Jupiter'),
            action: String(a.action ?? 'hold'),
            token: String(a.token ?? 'SOL'),
            percentOfPortfolio: clamp(Number(a.percentOfPortfolio ?? 0), 0, 100),
            rationale: String(a.rationale ?? ''),
          }))
        : [],
      riskAssessment: {
        overallRisk: clamp(parsed.riskAssessment?.overallRisk ?? 50, 0, 100),
        warnings: Array.isArray(parsed.riskAssessment?.warnings)
          ? parsed.riskAssessment.warnings.map(String)
          : [],
      },
      explanation: String(parsed.explanation ?? 'LLM analysis complete.'),
    };
  } catch {
    return {
      marketAssessment: {
        sentiment: 'neutral',
        confidence: 30,
        reasoning: 'Failed to parse LLM response — falling back to conservative stance.',
        keyFactors: ['parse_error'],
      },
      allocation: [],
      riskAssessment: { overallRisk: 70, warnings: ['LLM response parse failed'] },
      explanation: 'LLM analysis could not be parsed. No actions recommended.',
    };
  }
}

/**
 * Convert an LLMAnalysis into a StrategyEvaluation for the DECIDE phase.
 */
export function convertAnalysisToEvaluation(
  analysis: LLMAnalysis,
  marketData: MarketData,
): StrategyEvaluation {
  const now = Date.now();

  // Build market condition from LLM assessment
  const trendDirection = SENTIMENT_TO_TREND[analysis.marketAssessment.sentiment] ?? 'neutral';
  const volatilityRegime = analysis.riskAssessment.overallRisk > 70
    ? 'high' as const
    : analysis.riskAssessment.overallRisk > 40
      ? 'moderate' as const
      : 'low' as const;

  const strategyType: StrategyType = trendDirection === 'bullish' && volatilityRegime === 'low'
    ? 'yield'
    : trendDirection === 'bearish' || volatilityRegime === 'high'
      ? 'rebalance'
      : 'yield';

  const marketCondition: MarketCondition = {
    volatilityRegime,
    trendDirection,
    volatilityIndex: analysis.riskAssessment.overallRisk,
    priceChange24h: marketData.solChange24hPct,
    recommendedStrategyType: strategyType,
    confidence: analysis.marketAssessment.confidence,
    summary: analysis.marketAssessment.reasoning,
    timestamp: now,
  };

  // Build proposed actions from allocation
  const actions: ProposedAction[] = analysis.allocation
    .filter((a) => a.action !== 'hold' && a.percentOfPortfolio > 0)
    .map((a, idx) => ({
      id: `llm-${now}-${idx}`,
      type: (ACTION_TO_ACTION_TYPE[a.action] ?? 'swap') as ProposedAction['type'],
      protocol: (PROTOCOL_TO_ID[a.protocol.toLowerCase()] ?? 'jupiter') as ProposedAction['protocol'],
      description: `${a.action} ${a.percentOfPortfolio}% → ${a.token} via ${a.protocol}`,
      rationale: a.rationale,
      inputToken: { symbol: 'SOL', mint: null as any, decimals: 9 },
      outputToken: { symbol: a.token, mint: null as any, decimals: 9 },
      amount: BigInt(0), // Will be filled by DECIDE phase based on portfolio
      maxSlippageBps: 100,
      expectedValueChange: 0,
      priority: analysis.allocation.length - idx,
      timestamp: now,
    }));

  // Build the recommended signal
  const recommended: StrategySignal = {
    strategyId: 'llm-analysis',
    strategyName: `LLM ${analysis.marketAssessment.sentiment} strategy`,
    type: strategyType,
    confidence: analysis.marketAssessment.confidence,
    actions,
    explanation: analysis.explanation,
    expectedApy: undefined,
    riskScore: analysis.riskAssessment.overallRisk,
  };

  // Build yield opportunities from allocation
  const yieldOpportunities: YieldOpportunity[] = analysis.allocation.map((a) => ({
    protocol: (PROTOCOL_TO_ID[a.protocol.toLowerCase()] ?? 'jupiter') as YieldOpportunity['protocol'],
    type: mapActionToYieldType(a.action),
    token: { symbol: a.token, mint: null as any, decimals: 9 },
    apy: 0,
    tvlUsd: 0,
    riskScore: analysis.riskAssessment.overallRisk,
    description: a.rationale,
  }));

  return {
    signals: [recommended],
    recommended,
    marketCondition,
    yieldOpportunities,
    timestamp: now,
    evaluationTimeMs: 0,
  };
}

function mapActionToYieldType(action: string): YieldOpportunity['type'] {
  switch (action) {
    case 'stake': return 'staking';
    case 'lend': return 'lending';
    case 'lp': return 'lp';
    default: return 'vault';
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

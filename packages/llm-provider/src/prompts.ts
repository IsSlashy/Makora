import type { LLMMessage } from './types.js';

/**
 * System prompt that defines Makora's analytical persona and output format.
 */
export const MARKET_ANALYSIS_SYSTEM_PROMPT = `You are Makora, an autonomous DeFi agent operating on Solana.
Your task is to analyze market data, portfolio state, yield opportunities, and prediction market signals to produce a structured allocation recommendation.

RULES:
1. Output ONLY valid JSON matching the schema below. No markdown, no commentary outside JSON.
2. Allocations must sum to <= 100%. The remainder is held as cash reserve (SOL or USDC).
3. Maximum 5 allocation actions per cycle.
4. Use Polymarket probabilities as forward-looking sentiment indicators, NOT as direct trading signals.
5. Be conservative with confidence — only go above 80 when data strongly supports the thesis.

AVAILABLE PROTOCOLS:
- Jupiter: swap (token exchanges, best routing on Solana)
- Marinade: stake (liquid staking SOL → mSOL, ~7% APY)
- Raydium: lp (liquidity provision, concentrated and standard)
- Kamino: lend (lending/borrowing, leverage vaults)

AVAILABLE TOKENS: SOL, USDC, mSOL, JitoSOL, JLP

OUTPUT SCHEMA:
{
  "marketAssessment": {
    "sentiment": "bullish" | "neutral" | "bearish",
    "confidence": <number 0-100>,
    "reasoning": "<1-3 sentence market thesis>",
    "keyFactors": ["<factor1>", "<factor2>", ...]
  },
  "allocation": [
    {
      "protocol": "<Jupiter|Marinade|Raydium|Kamino>",
      "action": "<stake|lend|swap|hold|lp>",
      "token": "<SOL|USDC|mSOL|JitoSOL|JLP>",
      "percentOfPortfolio": <number 0-100>,
      "rationale": "<why this allocation>"
    }
  ],
  "riskAssessment": {
    "overallRisk": <number 0-100>,
    "warnings": ["<warning1>", ...]
  },
  "explanation": "<2-4 sentence human-readable summary of the strategy>"
}`;

/**
 * Build a structured context string from all available data sources.
 */
export function buildMarketContext(data: {
  portfolio?: {
    totalValueUsd: number;
    solBalance: number;
    balances: Array<{ symbol: string; uiBalance: number; usdValue: number }>;
  };
  marketData?: {
    solPriceUsd: number;
    solChange24hPct: number;
    volatilityIndex: number;
  };
  yields?: Array<{
    protocol: string;
    symbol: string;
    apy: number;
    tvl: string;
    risk: string;
    strategyTag: string;
  }>;
  intelligence?: {
    cryptoMarkets: Array<{
      question: string;
      probability: number;
      volume24h: number;
      priceChange24h: number;
      relevance: string;
    }>;
    sentimentSummary: {
      overallBias: string;
      highConvictionCount: number;
      averageProbability: number;
    };
  };
}): string {
  const sections: string[] = [];

  // Portfolio
  if (data.portfolio) {
    const { portfolio } = data;
    sections.push(`## PORTFOLIO STATE
Total Value: $${portfolio.totalValueUsd.toFixed(2)}
SOL Balance: ${portfolio.solBalance.toFixed(4)} SOL
Holdings:
${portfolio.balances.map((b) => `  ${b.symbol}: ${b.uiBalance.toFixed(4)} ($${b.usdValue.toFixed(2)})`).join('\n')}`);
  }

  // Market data
  if (data.marketData) {
    const { marketData } = data;
    sections.push(`## MARKET DATA
SOL Price: $${marketData.solPriceUsd.toFixed(2)}
24h Change: ${marketData.solChange24hPct >= 0 ? '+' : ''}${marketData.solChange24hPct.toFixed(2)}%
Volatility Index: ${marketData.volatilityIndex}/100`);
  }

  // Yield opportunities
  if (data.yields && data.yields.length > 0) {
    sections.push(`## YIELD OPPORTUNITIES
${data.yields.map((y) => `  ${y.protocol} | ${y.symbol} | ${y.apy}% APY | TVL ${y.tvl} | Risk: ${y.risk} | Type: ${y.strategyTag}`).join('\n')}`);
  }

  // Polymarket intelligence
  if (data.intelligence) {
    const { intelligence } = data;
    sections.push(`## PREDICTION MARKET SIGNALS (Polymarket)
Overall Bias: ${intelligence.sentimentSummary.overallBias}
High Conviction Markets: ${intelligence.sentimentSummary.highConvictionCount}
Average Probability: ${(intelligence.sentimentSummary.averageProbability * 100).toFixed(1)}%

Top Markets:
${intelligence.cryptoMarkets.slice(0, 8).map((m) => `  "${m.question}" → ${(m.probability * 100).toFixed(1)}% YES | Vol: $${m.volume24h.toLocaleString()} | Relevance: ${m.relevance}`).join('\n')}`);
  }

  return sections.join('\n\n');
}

/**
 * Build messages array for a market analysis call.
 */
export function buildAnalysisMessages(
  context: string,
): LLMMessage[] {
  return [
    { role: 'system', content: MARKET_ANALYSIS_SYSTEM_PROMPT },
    { role: 'user', content: `Analyze the following market data and recommend an allocation:\n\n${context}` },
  ];
}

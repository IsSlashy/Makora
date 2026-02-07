/**
 * Multi-source sentiment engine.
 * Fetches 6 data sources in parallel, computes a composite score,
 * and generates per-token buy/sell recommendations.
 */

import { PolymarketFeed, type MarketIntelligence } from '@makora/data-feed';
import { getPriceHistory, getMarketConditions, fetchTokenPrices, type MarketConditions } from './price-feed.js';
import { computeRSI, computeMomentum, rsiSignal } from './indicators.js';
import { fetchCryptoNews, type NewsFeedResult } from './social-feed.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TokenRecommendation {
  token: string;
  action: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  confidence: number;
  reasons: string[];
}

export interface SentimentReport {
  timestamp: number;
  overallScore: number;       // -100 to +100
  direction: 'strong_sell' | 'sell' | 'neutral' | 'buy' | 'strong_buy';
  confidence: number;         // 0-100%
  signals: {
    fearGreed: { value: number; classification: string };
    rsi: Record<string, { value: number; signal: string }>;
    momentum: { trend: string; volatility: string; changePct: number };
    polymarket: { bias: string; conviction: number };
    tvl: { value: number; change24hPct: number };
    dexVolume: { value: number; change24hPct: number };
    news: { score: number; articleCount: number; bias: string };
  };
  recommendations: TokenRecommendation[];
}

// ─── Caching ─────────────────────────────────────────────────────────────────

let cachedReport: SentimentReport | null = null;
let reportCacheExpiry = 0;
const REPORT_CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours

let cachedFearGreed: { value: number; classification: string } | null = null;
let fgCacheExpiry = 0;
const FG_CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ─── Polymarket instance ─────────────────────────────────────────────────────

const polyFeed = new PolymarketFeed(5 * 60 * 1000);

// ─── Data Fetchers ───────────────────────────────────────────────────────────

async function fetchFearGreedIndex(): Promise<{ value: number; classification: string }> {
  if (cachedFearGreed && Date.now() < fgCacheExpiry) {
    return cachedFearGreed;
  }

  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`FNG API ${res.status}`);
    const json = await res.json();
    const entry = json?.data?.[0];
    if (!entry) throw new Error('No FNG data');

    const result = {
      value: parseInt(entry.value, 10),
      classification: entry.value_classification || 'Unknown',
    };
    cachedFearGreed = result;
    fgCacheExpiry = Date.now() + FG_CACHE_TTL;
    return result;
  } catch (err) {
    console.warn('[Sentiment] Fear & Greed fetch failed:', err);
    return cachedFearGreed ?? { value: 50, classification: 'Neutral' };
  }
}

async function fetchSolanaTVL(): Promise<{ tvl: number; change24hPct: number }> {
  try {
    const res = await fetch('https://api.llama.fi/v2/chains', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`DefiLlama chains ${res.status}`);
    const chains: Array<{ name: string; tvl: number; change_1d?: number }> = await res.json();
    const solana = chains.find((c) => c.name.toLowerCase() === 'solana');
    if (!solana) return { tvl: 0, change24hPct: 0 };
    return {
      tvl: solana.tvl ?? 0,
      change24hPct: solana.change_1d ?? 0,
    };
  } catch (err) {
    console.warn('[Sentiment] DefiLlama TVL fetch failed:', err);
    return { tvl: 0, change24hPct: 0 };
  }
}

async function fetchDEXVolume(): Promise<{ volume24h: number; change24hPct: number }> {
  try {
    const res = await fetch('https://api.llama.fi/overview/dexs/Solana', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`DefiLlama DEX ${res.status}`);
    const data = await res.json();
    const total24h = data?.total24h ?? 0;
    const total48hto24h = data?.total48hto24h ?? total24h;
    const changePct = total48hto24h > 0
      ? ((total24h - total48hto24h) / total48hto24h) * 100
      : 0;
    return { volume24h: total24h, change24hPct: changePct };
  } catch (err) {
    console.warn('[Sentiment] DefiLlama DEX volume fetch failed:', err);
    return { volume24h: 0, change24hPct: 0 };
  }
}

// ─── RSI for tracked tokens ──────────────────────────────────────────────────

function computeTokenRSIs(): Record<string, { value: number; signal: string }> {
  const history = getPriceHistory();
  const result: Record<string, { value: number; signal: string }> = {};

  for (const symbol of ['SOL', 'WETH', 'WBTC']) {
    const closePrices = history.map((s) => s.prices[symbol]).filter((p): p is number => p != null && p > 0);
    const rsi = computeRSI(closePrices);
    if (rsi !== null) {
      result[symbol === 'WETH' ? 'ETH' : symbol === 'WBTC' ? 'BTC' : symbol] = {
        value: Math.round(rsi * 10) / 10,
        signal: rsiSignal(rsi),
      };
    }
  }

  return result;
}

// ─── Scoring Engine ──────────────────────────────────────────────────────────

interface AllSignals {
  fearGreed: { value: number; classification: string };
  rsi: Record<string, { value: number; signal: string }>;
  momentum: { trend: string; volatility: string; changePct: number };
  polymarket: { bias: string; conviction: number };
  tvl: { value: number; change24hPct: number };
  dexVolume: { value: number; change24hPct: number };
  news: { score: number; articleCount: number; bias: string };
}

function computeOverallScore(signals: AllSignals): number {
  let score = 0;

  // 1. Fear & Greed (20% weight) — contrarian
  const fg = signals.fearGreed.value;
  if (fg < 25) score += 25;
  else if (fg < 45) score += 12;
  else if (fg > 75) score -= 25;
  else if (fg > 55) score -= 12;

  // 2. RSI (20% weight) — mean reversion
  const solRsi = signals.rsi['SOL'];
  if (solRsi) {
    if (solRsi.value < 30) score += 20;
    else if (solRsi.value < 40) score += 10;
    else if (solRsi.value > 70) score -= 20;
    else if (solRsi.value > 60) score -= 10;
  }

  // 3. Price momentum (20% weight)
  if (signals.momentum.trend === 'bullish') score += 10;
  else if (signals.momentum.trend === 'bearish') score -= 10;
  if (signals.momentum.changePct > 3) score += 10;
  else if (signals.momentum.changePct < -3) score -= 10;

  // 4. Polymarket (10% weight)
  if (signals.polymarket.bias === 'bullish') score += 10;
  else if (signals.polymarket.bias === 'bearish') score -= 10;

  // 5. TVL (10% weight)
  if (signals.tvl.change24hPct > 5) score += 10;
  else if (signals.tvl.change24hPct > 2) score += 5;
  else if (signals.tvl.change24hPct < -5) score -= 10;
  else if (signals.tvl.change24hPct < -2) score -= 5;

  // 6. DEX Volume (10% weight)
  if (signals.dexVolume.change24hPct > 10) score += 10;
  else if (signals.dexVolume.change24hPct > 5) score += 5;
  else if (signals.dexVolume.change24hPct < -10) score -= 10;
  else if (signals.dexVolume.change24hPct < -5) score -= 5;

  // 7. News sentiment (10% weight) — only if enough articles
  if (signals.news.articleCount >= 3) {
    if (signals.news.score > 40) score += 10;
    else if (signals.news.score > 15) score += 5;
    else if (signals.news.score < -40) score -= 10;
    else if (signals.news.score < -15) score -= 5;
  }

  // Clamp to [-100, +100]
  return Math.max(-100, Math.min(100, score));
}

function scoreToDirection(score: number): SentimentReport['direction'] {
  if (score >= 50) return 'strong_buy';
  if (score >= 20) return 'buy';
  if (score <= -50) return 'strong_sell';
  if (score <= -20) return 'sell';
  return 'neutral';
}

function scoreToConfidence(score: number): number {
  // Higher absolute score = higher confidence
  return Math.min(100, Math.round(Math.abs(score) * 1.2 + 30));
}

// ─── Recommendations ─────────────────────────────────────────────────────────

function generateRecommendations(
  score: number,
  signals: AllSignals,
): TokenRecommendation[] {
  const recommendations: TokenRecommendation[] = [];

  const tokens = [
    { symbol: 'SOL', rsiKey: 'SOL' },
    { symbol: 'ETH', rsiKey: 'ETH' },
    { symbol: 'BTC', rsiKey: 'BTC' },
  ];

  for (const { symbol, rsiKey } of tokens) {
    const reasons: string[] = [];
    let tokenScore = score * 0.5; // Base from overall market

    // Token-specific RSI adjustment
    const rsi = signals.rsi[rsiKey];
    if (rsi) {
      if (rsi.value < 30) {
        tokenScore += 25;
        reasons.push(`RSI ${rsi.value.toFixed(0)} (Oversold)`);
      } else if (rsi.value < 40) {
        tokenScore += 12;
        reasons.push(`RSI ${rsi.value.toFixed(0)} (Low)`);
      } else if (rsi.value > 70) {
        tokenScore -= 25;
        reasons.push(`RSI ${rsi.value.toFixed(0)} (Overbought)`);
      } else if (rsi.value > 60) {
        tokenScore -= 12;
        reasons.push(`RSI ${rsi.value.toFixed(0)} (High)`);
      } else {
        reasons.push(`RSI ${rsi.value.toFixed(0)} (Neutral)`);
      }
    }

    // Fear & Greed context
    if (signals.fearGreed.value < 30) {
      reasons.push(`Fear & Greed: ${signals.fearGreed.value} (${signals.fearGreed.classification})`);
    } else if (signals.fearGreed.value > 70) {
      reasons.push(`Fear & Greed: ${signals.fearGreed.value} (${signals.fearGreed.classification})`);
    }

    // SOL-specific: TVL rising is bullish for SOL
    if (symbol === 'SOL' && signals.tvl.change24hPct > 3) {
      tokenScore += 10;
      reasons.push(`Solana TVL +${signals.tvl.change24hPct.toFixed(1)}%`);
    }

    // SOL-specific: DEX volume
    if (symbol === 'SOL' && signals.dexVolume.change24hPct > 5) {
      tokenScore += 8;
      reasons.push(`DEX Vol +${signals.dexVolume.change24hPct.toFixed(1)}%`);
    }

    // Polymarket context
    if (signals.polymarket.bias !== 'neutral') {
      reasons.push(`Polymarket: ${signals.polymarket.bias}`);
    }

    // News sentiment context
    if (signals.news.articleCount >= 3 && signals.news.bias !== 'neutral') {
      const newsLabel = signals.news.score > 0 ? 'positive' : 'negative';
      reasons.push(`News: ${newsLabel} (${signals.news.articleCount} articles)`);
      if (signals.news.score > 30) tokenScore += 8;
      else if (signals.news.score < -30) tokenScore -= 8;
    }

    const clampedScore = Math.max(-100, Math.min(100, tokenScore));
    let action: TokenRecommendation['action'];
    if (clampedScore >= 40) action = 'strong_buy';
    else if (clampedScore >= 15) action = 'buy';
    else if (clampedScore <= -40) action = 'strong_sell';
    else if (clampedScore <= -15) action = 'sell';
    else action = 'hold';

    const confidence = Math.min(100, Math.round(Math.abs(clampedScore) * 1.1 + 25));

    recommendations.push({ token: symbol, action, confidence, reasons });
  }

  // Sort by confidence descending
  recommendations.sort((a, b) => b.confidence - a.confidence);
  return recommendations;
}

// ─── Main Entry Point ────────────────────────────────────────────────────────

/**
 * Analyze market sentiment from 6 data sources.
 * Results are cached for 5 minutes.
 */
export async function analyzeSentiment(): Promise<SentimentReport> {
  if (cachedReport && Date.now() < reportCacheExpiry) {
    return cachedReport;
  }

  // Ensure we have recent prices in the buffer
  await fetchTokenPrices().catch(() => null);

  // Fetch all sources in parallel
  const [fearGreed, tvl, dexVolume, polyIntel, newsFeed] = await Promise.all([
    fetchFearGreedIndex(),
    fetchSolanaTVL(),
    fetchDEXVolume(),
    polyFeed.getMarketIntelligence().catch((): MarketIntelligence => ({
      cryptoMarkets: [],
      sentimentSummary: { overallBias: 'neutral', highConvictionCount: 0, averageProbability: 0.5 },
      fetchedAt: Date.now(),
    })),
    fetchCryptoNews().catch((): NewsFeedResult => ({
      articles: [],
      aggregateSentiment: 0,
      counts: { positive: 0, negative: 0, neutral: 0 },
      topHeadlines: [],
      fetchedAt: Date.now(),
    })),
  ]);

  // Local computations
  const rsi = computeTokenRSIs();
  const conditions = getMarketConditions();

  const momentum = {
    trend: conditions?.overallDirection ?? 'neutral',
    volatility: conditions?.volatility ?? 'low',
    changePct: conditions?.sol30mChangePct ?? 0,
  };

  const polymarket = {
    bias: polyIntel.sentimentSummary.overallBias,
    conviction: Math.round(polyIntel.sentimentSummary.averageProbability * 100),
  };

  const newsBias = newsFeed.aggregateSentiment > 20 ? 'bullish'
    : newsFeed.aggregateSentiment < -20 ? 'bearish'
    : 'neutral';

  const signals: AllSignals = {
    fearGreed,
    rsi,
    momentum,
    polymarket,
    tvl,
    dexVolume,
    news: {
      score: newsFeed.aggregateSentiment,
      articleCount: newsFeed.articles.length,
      bias: newsBias,
    },
  };

  const overallScore = computeOverallScore(signals);
  const direction = scoreToDirection(overallScore);
  const confidence = scoreToConfidence(overallScore);
  const recommendations = generateRecommendations(overallScore, signals);

  const report: SentimentReport = {
    timestamp: Date.now(),
    overallScore,
    direction,
    confidence,
    signals,
    recommendations,
  };

  cachedReport = report;
  reportCacheExpiry = Date.now() + REPORT_CACHE_TTL;

  return report;
}

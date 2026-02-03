/**
 * Polymarket Gamma API integration for prediction market intelligence.
 * No auth required for public market reads.
 */

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

const CRYPTO_KEYWORDS = [
  'sol', 'solana', 'bitcoin', 'btc', 'crypto', 'defi', 'ethereum', 'eth',
  'token', 'blockchain', 'stablecoin', 'usdc', 'usdt', 'altcoin', 'memecoin',
];

export interface PolymarketMarket {
  id: string;
  question: string;
  outcomePrices: string;
  volume24hr: number;
  liquidity: number;
  oneDayPriceChange: number;
  endDate: string;
  active: boolean;
}

export interface CryptoMarketSignal {
  question: string;
  probability: number;
  volume24h: number;
  priceChange24h: number;
  relevance: 'high' | 'medium' | 'low';
}

export interface MarketIntelligence {
  cryptoMarkets: CryptoMarketSignal[];
  sentimentSummary: {
    overallBias: 'bullish' | 'neutral' | 'bearish';
    highConvictionCount: number;
    averageProbability: number;
  };
  fetchedAt: number;
}

function classifyRelevance(question: string): 'high' | 'medium' | 'low' {
  const q = question.toLowerCase();
  const solanaHits = ['sol', 'solana'].filter((k) => q.includes(k)).length;
  if (solanaHits > 0) return 'high';
  const cryptoHits = CRYPTO_KEYWORDS.filter((k) => q.includes(k)).length;
  if (cryptoHits >= 2) return 'high';
  if (cryptoHits >= 1) return 'medium';
  return 'low';
}

function parseOutcomePrice(outcomePrices: string): number {
  try {
    // outcomePrices can be JSON string like "[\"0.85\",\"0.15\"]"
    const parsed = JSON.parse(outcomePrices);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parseFloat(parsed[0]);
    }
  } catch {
    // May be a plain number
    const num = parseFloat(outcomePrices);
    if (!isNaN(num)) return num;
  }
  return 0.5;
}

function computeSentiment(
  markets: CryptoMarketSignal[],
): MarketIntelligence['sentimentSummary'] {
  if (markets.length === 0) {
    return { overallBias: 'neutral', highConvictionCount: 0, averageProbability: 0.5 };
  }

  // Weight by volume for average probability
  const totalVolume = markets.reduce((s, m) => s + m.volume24h, 0);
  const weightedProb = totalVolume > 0
    ? markets.reduce((s, m) => s + m.probability * m.volume24h, 0) / totalVolume
    : markets.reduce((s, m) => s + m.probability, 0) / markets.length;

  const highConvictionCount = markets.filter(
    (m) => m.probability > 0.75 || m.probability < 0.25,
  ).length;

  // Positive price changes + high probabilities → bullish
  const avgChange = markets.reduce((s, m) => s + m.priceChange24h, 0) / markets.length;
  let overallBias: 'bullish' | 'neutral' | 'bearish' = 'neutral';
  if (weightedProb > 0.6 && avgChange > 0) overallBias = 'bullish';
  else if (weightedProb < 0.4 || avgChange < -0.05) overallBias = 'bearish';

  return {
    overallBias,
    highConvictionCount,
    averageProbability: weightedProb,
  };
}

const FALLBACK_INTELLIGENCE: MarketIntelligence = {
  cryptoMarkets: [
    {
      question: 'Will Bitcoin reach $150k by end of 2026?',
      probability: 0.42,
      volume24h: 850000,
      priceChange24h: 0.02,
      relevance: 'medium',
    },
    {
      question: 'Will Solana surpass $300 by June 2026?',
      probability: 0.35,
      volume24h: 420000,
      priceChange24h: -0.01,
      relevance: 'high',
    },
  ],
  sentimentSummary: {
    overallBias: 'neutral',
    highConvictionCount: 0,
    averageProbability: 0.5,
  },
  fetchedAt: Date.now(),
};

export class PolymarketFeed {
  private cache: MarketIntelligence | null = null;
  private cacheExpiresAt = 0;
  private cacheTtlMs: number;

  constructor(cacheTtlMs = 5 * 60 * 1000) {
    this.cacheTtlMs = cacheTtlMs;
  }

  async getMarketIntelligence(): Promise<MarketIntelligence> {
    if (this.cache && Date.now() < this.cacheExpiresAt) {
      return this.cache;
    }

    try {
      const intelligence = await this.fetchAndProcess();
      this.cache = intelligence;
      this.cacheExpiresAt = Date.now() + this.cacheTtlMs;
      return intelligence;
    } catch (err) {
      console.warn('Polymarket fetch failed, using fallback:', err);
      return FALLBACK_INTELLIGENCE;
    }
  }

  private async fetchAndProcess(): Promise<MarketIntelligence> {
    // Fetch crypto-tagged markets sorted by 24h volume
    const [cryptoRes, solanaRes] = await Promise.allSettled([
      fetch(
        `${GAMMA_BASE}/markets?tag=crypto&active=true&closed=false&limit=20&order=volume24hr&ascending=false`,
      ),
      fetch(
        `${GAMMA_BASE}/markets?tag_slug=solana&active=true&closed=false&limit=10`,
      ),
    ]);

    const markets = new Map<string, PolymarketMarket>();

    for (const result of [cryptoRes, solanaRes]) {
      if (result.status === 'fulfilled' && result.value.ok) {
        const data: PolymarketMarket[] = await result.value.json();
        for (const m of data) {
          if (m.active && !markets.has(m.id)) {
            markets.set(m.id, m);
          }
        }
      }
    }

    if (markets.size === 0) {
      return FALLBACK_INTELLIGENCE;
    }

    // Process into signals
    const cryptoMarkets: CryptoMarketSignal[] = [];

    for (const market of markets.values()) {
      const relevance = classifyRelevance(market.question);
      cryptoMarkets.push({
        question: market.question,
        probability: parseOutcomePrice(market.outcomePrices),
        volume24h: market.volume24hr ?? 0,
        priceChange24h: market.oneDayPriceChange ?? 0,
        relevance,
      });
    }

    // Sort by relevance then volume
    const relevanceOrder = { high: 0, medium: 1, low: 2 };
    cryptoMarkets.sort((a, b) => {
      const rd = relevanceOrder[a.relevance] - relevanceOrder[b.relevance];
      if (rd !== 0) return rd;
      return b.volume24h - a.volume24h;
    });

    return {
      cryptoMarkets: cryptoMarkets.slice(0, 15),
      sentimentSummary: computeSentiment(cryptoMarkets),
      fetchedAt: Date.now(),
    };
  }
}

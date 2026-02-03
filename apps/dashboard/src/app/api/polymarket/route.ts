import { NextResponse } from 'next/server';

const GAMMA_BASE = 'https://gamma-api.polymarket.com';

const CRYPTO_KEYWORDS = [
  'sol', 'solana', 'bitcoin', 'btc', 'crypto', 'defi', 'ethereum', 'eth',
  'token', 'blockchain', 'stablecoin', 'usdc', 'usdt', 'altcoin', 'memecoin',
];

interface GammaMarket {
  id: string;
  question: string;
  outcomePrices: string;
  volume24hr: number;
  liquidity: number;
  oneDayPriceChange: number;
  endDate: string;
  active: boolean;
}

function classifyRelevance(question: string): 'high' | 'medium' | 'low' {
  const q = question.toLowerCase();
  if (['sol', 'solana'].some((k) => q.includes(k))) return 'high';
  const hits = CRYPTO_KEYWORDS.filter((k) => q.includes(k)).length;
  if (hits >= 2) return 'high';
  if (hits >= 1) return 'medium';
  return 'low';
}

function parseYesPrice(outcomePrices: string): number {
  try {
    const parsed = JSON.parse(outcomePrices);
    if (Array.isArray(parsed) && parsed.length > 0) return parseFloat(parsed[0]);
  } catch { /* fall through */ }
  const num = parseFloat(outcomePrices);
  return isNaN(num) ? 0.5 : num;
}

export async function GET() {
  try {
    const [cryptoRes, solanaRes] = await Promise.allSettled([
      fetch(`${GAMMA_BASE}/markets?tag=crypto&active=true&closed=false&limit=20&order=volume24hr&ascending=false`, { next: { revalidate: 300 } }),
      fetch(`${GAMMA_BASE}/markets?tag_slug=solana&active=true&closed=false&limit=10`, { next: { revalidate: 300 } }),
    ]);

    const markets = new Map<string, GammaMarket>();
    for (const result of [cryptoRes, solanaRes]) {
      if (result.status === 'fulfilled' && result.value.ok) {
        const data: GammaMarket[] = await result.value.json();
        for (const m of data) {
          if (m.active && !markets.has(m.id)) markets.set(m.id, m);
        }
      }
    }

    const cryptoMarkets = [...markets.values()].map((m) => ({
      question: m.question,
      probability: parseYesPrice(m.outcomePrices),
      volume24h: m.volume24hr ?? 0,
      priceChange24h: m.oneDayPriceChange ?? 0,
      relevance: classifyRelevance(m.question),
    }));

    const relevanceOrder = { high: 0, medium: 1, low: 2 } as const;
    cryptoMarkets.sort((a, b) => {
      const rd = relevanceOrder[a.relevance] - relevanceOrder[b.relevance];
      return rd !== 0 ? rd : b.volume24h - a.volume24h;
    });

    // Compute sentiment
    const totalVolume = cryptoMarkets.reduce((s, m) => s + m.volume24h, 0);
    const avgProb = totalVolume > 0
      ? cryptoMarkets.reduce((s, m) => s + m.probability * m.volume24h, 0) / totalVolume
      : 0.5;
    const avgChange = cryptoMarkets.length > 0
      ? cryptoMarkets.reduce((s, m) => s + m.priceChange24h, 0) / cryptoMarkets.length
      : 0;

    let overallBias: 'bullish' | 'neutral' | 'bearish' = 'neutral';
    if (avgProb > 0.6 && avgChange > 0) overallBias = 'bullish';
    else if (avgProb < 0.4 || avgChange < -0.05) overallBias = 'bearish';

    return NextResponse.json({
      cryptoMarkets: cryptoMarkets.slice(0, 15),
      sentimentSummary: {
        overallBias,
        highConvictionCount: cryptoMarkets.filter((m) => m.probability > 0.75 || m.probability < 0.25).length,
        averageProbability: avgProb,
      },
      fetchedAt: Date.now(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Polymarket API error' },
      { status: 502 },
    );
  }
}

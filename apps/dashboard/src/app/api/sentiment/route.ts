import { NextResponse } from 'next/server';

// ─── Types (mirrors apps/telegram/src/sentiment.ts) ─────────────────────────

interface TokenRecommendation {
  token: string;
  action: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  confidence: number;
  reasons: string[];
}

interface SentimentReport {
  timestamp: number;
  overallScore: number;
  direction: 'strong_sell' | 'sell' | 'neutral' | 'buy' | 'strong_buy';
  confidence: number;
  signals: {
    fearGreed: { value: number; classification: string };
    rsi: Record<string, { value: number; signal: string }>;
    momentum: { trend: string; volatility: string; changePct: number };
    polymarket: { bias: string; conviction: number };
    tvl: { tvl: number; change24hPct: number };
    dexVolume: { volume24h: number; change24hPct: number };
  };
  recommendations: TokenRecommendation[];
}

// ─── In-memory cache (serverless warm instance) ─────────────────────────────

let cachedReport: SentimentReport | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 3 * 60 * 60 * 1000; // 3 hours

// ─── Data fetchers ──────────────────────────────────────────────────────────

async function fetchFearGreed(): Promise<{ value: number; classification: string }> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`FNG ${res.status}`);
    const json = await res.json();
    const entry = json?.data?.[0];
    if (!entry) throw new Error('No FNG data');
    return { value: parseInt(entry.value, 10), classification: entry.value_classification || 'Unknown' };
  } catch {
    return { value: 50, classification: 'Neutral' };
  }
}

async function fetchSolanaTVL(): Promise<{ tvl: number; change24hPct: number }> {
  try {
    const res = await fetch('https://api.llama.fi/v2/chains', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`TVL ${res.status}`);
    const chains: Array<{ name: string; tvl: number; change_1d?: number }> = await res.json();
    const solana = chains.find(c => c.name.toLowerCase() === 'solana');
    if (!solana) return { tvl: 0, change24hPct: 0 };
    return { tvl: solana.tvl ?? 0, change24hPct: solana.change_1d ?? 0 };
  } catch {
    return { tvl: 0, change24hPct: 0 };
  }
}

async function fetchDEXVolume(): Promise<{ volume24h: number; change24hPct: number }> {
  try {
    const res = await fetch('https://api.llama.fi/overview/dexs/Solana', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`DEX ${res.status}`);
    const data = await res.json();
    const total24h = data?.total24h ?? 0;
    const total48hto24h = data?.total48hto24h ?? total24h;
    const changePct = total48hto24h > 0 ? ((total24h - total48hto24h) / total48hto24h) * 100 : 0;
    return { volume24h: total24h, change24hPct: changePct };
  } catch {
    return { volume24h: 0, change24hPct: 0 };
  }
}

async function fetchPolymarketSentiment(): Promise<{ bias: string; conviction: number }> {
  try {
    // Reuse existing polymarket route logic inline
    const GAMMA_BASE = 'https://gamma-api.polymarket.com';
    const [cryptoRes, solanaRes] = await Promise.allSettled([
      fetch(`${GAMMA_BASE}/markets?tag=crypto&active=true&closed=false&limit=20&order=volume24hr&ascending=false`, {
        signal: AbortSignal.timeout(5000),
      }),
      fetch(`${GAMMA_BASE}/markets?tag_slug=solana&active=true&closed=false&limit=10`, {
        signal: AbortSignal.timeout(5000),
      }),
    ]);

    const markets: Array<{ probability: number; volume24h: number; priceChange24h: number }> = [];
    for (const result of [cryptoRes, solanaRes]) {
      if (result.status === 'fulfilled' && result.value.ok) {
        const data = await result.value.json();
        for (const m of data) {
          if (!m.active) continue;
          let prob = 0.5;
          try {
            const parsed = JSON.parse(m.outcomePrices);
            if (Array.isArray(parsed) && parsed.length > 0) prob = parseFloat(parsed[0]);
          } catch {
            const num = parseFloat(m.outcomePrices);
            if (!isNaN(num)) prob = num;
          }
          markets.push({ probability: prob, volume24h: m.volume24hr ?? 0, priceChange24h: m.oneDayPriceChange ?? 0 });
        }
      }
    }

    const totalVolume = markets.reduce((s, m) => s + m.volume24h, 0);
    const avgProb = totalVolume > 0
      ? markets.reduce((s, m) => s + m.probability * m.volume24h, 0) / totalVolume
      : 0.5;
    const avgChange = markets.length > 0
      ? markets.reduce((s, m) => s + m.priceChange24h, 0) / markets.length
      : 0;

    let bias = 'neutral';
    if (avgProb > 0.6 && avgChange > 0) bias = 'bullish';
    else if (avgProb < 0.4 || avgChange < -0.05) bias = 'bearish';

    return { bias, conviction: Math.round(avgProb * 100) };
  } catch {
    return { bias: 'neutral', conviction: 50 };
  }
}

// ─── CoinGecko OHLC candle data ─────────────────────────────────────────────

const COINGECKO_IDS: Record<string, string> = {
  SOL: 'solana',
  ETH: 'ethereum',
  BTC: 'bitcoin',
};

// OHLC candle: [timestamp, open, high, low, close]
type OHLCCandle = [number, number, number, number, number];

interface TokenOHLC {
  symbol: string;
  candles: OHLCCandle[];
  currentPrice: number;
}

async function fetchTokenOHLC(): Promise<TokenOHLC[]> {
  const results: TokenOHLC[] = [];

  // Fetch 14-day OHLC for each token (gives ~14 daily candles for RSI-14)
  const fetches = Object.entries(COINGECKO_IDS).map(async ([symbol, cgId]) => {
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${cgId}/ohlc?vs_currency=usd&days=14`,
        { signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) throw new Error(`CoinGecko OHLC ${cgId}: ${res.status}`);
      const candles: OHLCCandle[] = await res.json();
      if (!Array.isArray(candles) || candles.length < 2) throw new Error('Not enough candles');
      const currentPrice = candles[candles.length - 1][4]; // last close
      results.push({ symbol, candles, currentPrice });
    } catch {
      // Fallback: no data for this token
    }
  });

  await Promise.all(fetches);
  return results;
}

// ─── Real RSI calculation (14-period, using daily close prices) ─────────────

function computeRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50; // not enough data

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    changes.push(closes[i] - closes[i - 1]);
  }

  // Use only the most recent `period` changes
  const recent = changes.slice(-period);

  let avgGain = 0;
  let avgLoss = 0;

  for (const change of recent) {
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }

  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) return 100;
  if (avgGain === 0) return 0;

  const rs = avgGain / avgLoss;
  return Math.round(100 - (100 / (1 + rs)));
}

function rsiToSignal(value: number): string {
  if (value < 30) return 'oversold';
  if (value > 70) return 'overbought';
  if (value < 40) return 'approaching_oversold';
  if (value > 60) return 'approaching_overbought';
  return 'neutral';
}

// ─── Real momentum from OHLC data ──────────────────────────────────────────

function computeMomentum(allTokenOHLC: TokenOHLC[]): { trend: string; volatility: string; changePct: number } {
  // Use SOL as the primary momentum signal (Solana-focused agent)
  const sol = allTokenOHLC.find(t => t.symbol === 'SOL');
  if (!sol || sol.candles.length < 4) {
    return { trend: 'neutral', volatility: 'low', changePct: 0 };
  }

  const closes = sol.candles.map(c => c[4]); // close prices

  // 24h change: compare last close to ~24h ago
  // CoinGecko 14d OHLC gives 4h candles, so ~6 candles = 24h
  const candlesFor24h = Math.min(6, closes.length - 1);
  const price24hAgo = closes[closes.length - 1 - candlesFor24h];
  const currentPrice = closes[closes.length - 1];
  const changePct = price24hAgo > 0
    ? ((currentPrice - price24hAgo) / price24hAgo) * 100
    : 0;

  // Trend from price direction
  let trend = 'neutral';
  if (changePct > 2) trend = 'bullish';
  else if (changePct < -2) trend = 'bearish';

  // Volatility from standard deviation of recent closes
  const recentCloses = closes.slice(-12); // last ~48h
  const mean = recentCloses.reduce((s, v) => s + v, 0) / recentCloses.length;
  const variance = recentCloses.reduce((s, v) => s + (v - mean) ** 2, 0) / recentCloses.length;
  const stdDev = Math.sqrt(variance);
  const coeffVariation = mean > 0 ? (stdDev / mean) * 100 : 0;

  let volatility = 'low';
  if (coeffVariation > 5) volatility = 'high';
  else if (coeffVariation > 2) volatility = 'medium';

  return { trend, volatility, changePct: Math.round(changePct * 100) / 100 };
}

// ─── Scoring (mirrors telegram/sentiment.ts logic) ──────────────────────────

function computeScore(signals: SentimentReport['signals']): number {
  let score = 0;

  // Fear & Greed (contrarian)
  const fg = signals.fearGreed.value;
  if (fg < 25) score += 30;
  else if (fg < 45) score += 15;
  else if (fg > 75) score -= 30;
  else if (fg > 55) score -= 15;

  // RSI
  const solRsi = signals.rsi['SOL'];
  if (solRsi) {
    if (solRsi.value < 30) score += 20;
    else if (solRsi.value < 40) score += 10;
    else if (solRsi.value > 70) score -= 20;
    else if (solRsi.value > 60) score -= 10;
  }

  // Momentum
  if (signals.momentum.trend === 'bullish') score += 10;
  else if (signals.momentum.trend === 'bearish') score -= 10;
  if (signals.momentum.changePct > 3) score += 10;
  else if (signals.momentum.changePct < -3) score -= 10;

  // Polymarket
  if (signals.polymarket.bias === 'bullish') score += 15;
  else if (signals.polymarket.bias === 'bearish') score -= 15;

  // TVL
  if (signals.tvl.change24hPct > 5) score += 10;
  else if (signals.tvl.change24hPct > 2) score += 5;
  else if (signals.tvl.change24hPct < -5) score -= 10;
  else if (signals.tvl.change24hPct < -2) score -= 5;

  // DEX Volume
  if (signals.dexVolume.change24hPct > 10) score += 10;
  else if (signals.dexVolume.change24hPct > 5) score += 5;
  else if (signals.dexVolume.change24hPct < -10) score -= 10;
  else if (signals.dexVolume.change24hPct < -5) score -= 5;

  return Math.max(-100, Math.min(100, score));
}

function scoreToDirection(score: number): SentimentReport['direction'] {
  if (score >= 50) return 'strong_buy';
  if (score >= 20) return 'buy';
  if (score <= -50) return 'strong_sell';
  if (score <= -20) return 'sell';
  return 'neutral';
}

function generateRecommendations(score: number, signals: SentimentReport['signals']): TokenRecommendation[] {
  const tokens = ['SOL', 'ETH', 'BTC'];
  return tokens.map(token => {
    let tokenScore = score * 0.5;
    const reasons: string[] = [];

    const rsi = signals.rsi[token];
    if (rsi) {
      if (rsi.value < 30) { tokenScore += 25; reasons.push(`RSI ${rsi.value} (Oversold)`); }
      else if (rsi.value > 70) { tokenScore -= 25; reasons.push(`RSI ${rsi.value} (Overbought)`); }
      else reasons.push(`RSI ${rsi.value} (Neutral)`);
    }

    if (signals.fearGreed.value < 30 || signals.fearGreed.value > 70) {
      reasons.push(`Fear & Greed: ${signals.fearGreed.value} (${signals.fearGreed.classification})`);
    }

    if (token === 'SOL' && signals.tvl.change24hPct > 3) {
      tokenScore += 10;
      reasons.push(`Solana TVL +${signals.tvl.change24hPct.toFixed(1)}%`);
    }

    if (signals.polymarket.bias !== 'neutral') {
      reasons.push(`Polymarket: ${signals.polymarket.bias}`);
    }

    const clamped = Math.max(-100, Math.min(100, tokenScore));
    let action: TokenRecommendation['action'];
    if (clamped >= 40) action = 'strong_buy';
    else if (clamped >= 15) action = 'buy';
    else if (clamped <= -40) action = 'strong_sell';
    else if (clamped <= -15) action = 'sell';
    else action = 'hold';

    const confidence = Math.min(100, Math.round(Math.abs(clamped) * 1.1 + 25));
    return { token, action, confidence, reasons };
  }).sort((a, b) => b.confidence - a.confidence);
}

// ─── Route handler ──────────────────────────────────────────────────────────

export async function GET() {
  // Return cached if fresh
  if (cachedReport && Date.now() < cacheExpiry) {
    return NextResponse.json(cachedReport);
  }

  try {
    const [fearGreed, tvl, dexVolume, polymarket, tokenOHLC] = await Promise.all([
      fetchFearGreed(),
      fetchSolanaTVL(),
      fetchDEXVolume(),
      fetchPolymarketSentiment(),
      fetchTokenOHLC(),
    ]);

    // Real RSI from CoinGecko OHLC candles (14-period)
    const rsi: Record<string, { value: number; signal: string }> = {};
    for (const token of tokenOHLC) {
      const closes = token.candles.map(c => c[4]);
      const value = computeRSI(closes);
      rsi[token.symbol] = { value, signal: rsiToSignal(value) };
    }

    // Real momentum from SOL price action
    const momentum = computeMomentum(tokenOHLC);

    const signals: SentimentReport['signals'] = {
      fearGreed,
      rsi,
      momentum,
      polymarket,
      tvl,
      dexVolume,
    };

    const overallScore = computeScore(signals);
    const direction = scoreToDirection(overallScore);
    const confidence = Math.min(100, Math.round(Math.abs(overallScore) * 1.2 + 30));
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
    cacheExpiry = Date.now() + CACHE_TTL;

    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Sentiment fetch failed' },
      { status: 500 },
    );
  }
}

/**
 * Jupiter Price API v2 — live token price feed with caching.
 */

const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';
const JUPITER_API_KEY = process.env.JUPITER_API_KEY || process.env.NEXT_PUBLIC_JUPITER_API_KEY || '';

// Known mints
const MINT_MAP: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  mSOL: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  JitoSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  JLP: '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  JUPSOL: 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjkRE4',
  WBTC: '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh',
  WETH: '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
};

export interface TokenPrices {
  /** symbol -> USD price */
  [symbol: string]: number;
}

// ─── In-memory cache ────────────────────────────────────────────────────────

let cachedPrices: TokenPrices | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 30_000; // 30 seconds

// ─── Price History Ring Buffer ──────────────────────────────────────────────

interface PriceSnapshot {
  timestamp: number;
  prices: TokenPrices;
}

const MAX_HISTORY = 120; // ~60 minutes at 30s intervals
const priceHistory: PriceSnapshot[] = [];

export interface MarketConditions {
  solPrice: number;
  solTrend: 'up' | 'down' | 'flat';
  sol30mChangePct: number;
  tokenTrends: Array<{ symbol: string; price: number; changePct30m: number; trend: 'up' | 'down' | 'flat' }>;
  volatility: 'low' | 'medium' | 'high';
  overallDirection: 'bullish' | 'bearish' | 'neutral';
}

/**
 * Returns market conditions derived from recent price history.
 */
export function getMarketConditions(): MarketConditions | null {
  if (priceHistory.length < 2) return null;

  const latest = priceHistory[priceHistory.length - 1];
  // Find snapshot ~30 min ago (index ~60 entries back at 30s intervals)
  const thirtyMinAgo = Date.now() - 30 * 60 * 1000;
  const baseline = priceHistory.find(s => s.timestamp >= thirtyMinAgo) ?? priceHistory[0];

  const solNow = latest.prices.SOL ?? FALLBACK_PRICES.SOL;
  const solThen = baseline.prices.SOL ?? FALLBACK_PRICES.SOL;
  const sol30mChangePct = solThen > 0 ? ((solNow - solThen) / solThen) * 100 : 0;
  const solTrend: 'up' | 'down' | 'flat' = sol30mChangePct > 0.5 ? 'up' : sol30mChangePct < -0.5 ? 'down' : 'flat';

  const tokenTrends: MarketConditions['tokenTrends'] = [];
  for (const symbol of Object.keys(MINT_MAP)) {
    if (symbol === 'SOL') continue;
    const now = latest.prices[symbol];
    const then = baseline.prices[symbol];
    if (!now || !then) continue;
    const changePct = then > 0 ? ((now - then) / then) * 100 : 0;
    tokenTrends.push({
      symbol,
      price: now,
      changePct30m: Math.round(changePct * 100) / 100,
      trend: changePct > 0.5 ? 'up' : changePct < -0.5 ? 'down' : 'flat',
    });
  }

  // Volatility: check standard deviation of SOL price changes over recent history
  const recentPrices = priceHistory.slice(-20).map(s => s.prices.SOL ?? 0).filter(p => p > 0);
  let volatility: 'low' | 'medium' | 'high' = 'low';
  if (recentPrices.length >= 3) {
    const mean = recentPrices.reduce((a, b) => a + b, 0) / recentPrices.length;
    const variance = recentPrices.reduce((sum, p) => sum + (p - mean) ** 2, 0) / recentPrices.length;
    const stdDev = Math.sqrt(variance);
    const coeffVar = mean > 0 ? (stdDev / mean) * 100 : 0;
    volatility = coeffVar > 1 ? 'high' : coeffVar > 0.3 ? 'medium' : 'low';
  }

  // Overall direction: majority of token trends
  const ups = tokenTrends.filter(t => t.trend === 'up').length;
  const downs = tokenTrends.filter(t => t.trend === 'down').length;
  const overallDirection: 'bullish' | 'bearish' | 'neutral' =
    ups > downs + 1 ? 'bullish' : downs > ups + 1 ? 'bearish' : 'neutral';

  return {
    solPrice: solNow,
    solTrend,
    sol30mChangePct: Math.round(sol30mChangePct * 100) / 100,
    tokenTrends,
    volatility,
    overallDirection,
  };
}

// Fallback prices when Jupiter API is unreachable (updated Feb 2026)
const FALLBACK_PRICES: TokenPrices = {
  SOL: 77,
  USDC: 1,
  mSOL: 82,
  JitoSOL: 82,
  JLP: 2.5,
  BONK: 0.000012,
  RAY: 1.8,
  JUPSOL: 80,
  WBTC: 64000,
  WETH: 2130,
};

/**
 * Fetch live token prices from Jupiter Price API v2.
 * Results are cached for 30s. Falls back to hardcoded prices on failure.
 */
export async function fetchTokenPrices(
  symbols?: string[],
): Promise<TokenPrices> {
  // Return cache if fresh
  if (cachedPrices && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedPrices;
  }

  const targetSymbols = symbols ?? Object.keys(MINT_MAP);
  const mints = targetSymbols
    .map((s) => MINT_MAP[s])
    .filter(Boolean);

  if (mints.length === 0) return FALLBACK_PRICES;

  let prices: TokenPrices = {};
  let gotLivePrices = false;

  // 1) Try Jupiter Price API v2
  try {
    const url = `${JUPITER_PRICE_API}?ids=${mints.join(',')}`;
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (JUPITER_API_KEY) headers['x-api-key'] = JUPITER_API_KEY;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });

    if (res.ok) {
      const json = await res.json();
      const data: Record<string, { price: string }> = json.data ?? {};

      for (const [symbol, mint] of Object.entries(MINT_MAP)) {
        const entry = data[mint];
        if (entry?.price) {
          prices[symbol] = parseFloat(entry.price);
          gotLivePrices = true;
        }
      }
    }
  } catch {
    // Jupiter failed, try CoinGecko
  }

  // 2) If Jupiter failed, try CoinGecko (free, no key required)
  if (!gotLivePrices) {
    try {
      const geckoRes = await fetch(
        'https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum,bitcoin&vs_currencies=usd',
        { signal: AbortSignal.timeout(5000) },
      );
      if (geckoRes.ok) {
        const geckoData = await geckoRes.json();
        if (geckoData.solana?.usd) { prices.SOL = geckoData.solana.usd; gotLivePrices = true; }
        if (geckoData.ethereum?.usd) { prices.WETH = geckoData.ethereum.usd; gotLivePrices = true; }
        if (geckoData.bitcoin?.usd) { prices.WBTC = geckoData.bitcoin.usd; gotLivePrices = true; }
        // Derive staked SOL prices from SOL
        if (prices.SOL) {
          prices.mSOL = prices.SOL * 1.06;
          prices.JitoSOL = prices.SOL * 1.06;
          prices.JUPSOL = prices.SOL * 1.04;
        }
        prices.USDC = 1;
      }
    } catch {
      console.warn('CoinGecko also failed');
    }
  }

  // 3) Fill any missing with fallback
  for (const [symbol, fallback] of Object.entries(FALLBACK_PRICES)) {
    if (!prices[symbol]) prices[symbol] = fallback;
  }

  // Update cache
  cachedPrices = prices;
  cacheTimestamp = Date.now();

  // Record to price history ring buffer
  priceHistory.push({ timestamp: cacheTimestamp, prices: { ...prices } });
  if (priceHistory.length > MAX_HISTORY) {
    priceHistory.splice(0, priceHistory.length - MAX_HISTORY);
  }

  return prices;
}

/**
 * Convert a token amount to its SOL-equivalent value.
 */
export function tokenValueInSol(
  symbol: string,
  amount: number,
  prices: TokenPrices,
): number {
  const solPrice = prices.SOL ?? FALLBACK_PRICES.SOL;
  if (solPrice <= 0) return 0;

  if (symbol === 'SOL') return amount;

  const tokenPrice = prices[symbol];
  if (!tokenPrice) return 0;

  return (amount * tokenPrice) / solPrice;
}

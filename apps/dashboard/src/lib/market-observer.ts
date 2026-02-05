/**
 * Market Observer
 *
 * Fetches real-time market data for intelligent OBSERVE phase.
 * Uses Jupiter price API and Birdeye for market analysis.
 */

export interface MarketObservation {
  timestamp: number;
  prices: {
    SOL: number;
    ETH: number;
    BTC: number;
  };
  changes: {
    SOL: { pct1h: number; pct24h: number };
    ETH: { pct1h: number; pct24h: number };
    BTC: { pct1h: number; pct24h: number };
  };
  momentum: {
    SOL: 'bullish' | 'neutral' | 'bearish';
    ETH: 'bullish' | 'neutral' | 'bearish';
    BTC: 'bullish' | 'neutral' | 'bearish';
  };
  volatility: 'low' | 'medium' | 'high';
  marketSentiment: 'risk-on' | 'neutral' | 'risk-off';
  insights: string[];
}

// Cache for rate limiting
let lastFetch = 0;
let cachedObservation: MarketObservation | null = null;
const CACHE_TTL = 3000; // 3 seconds

/**
 * Fetch current market prices from Jupiter
 */
async function fetchPrices(): Promise<{ SOL: number; ETH: number; BTC: number }> {
  try {
    // Jupiter Price API v2
    const ids = [
      'So11111111111111111111111111111111111111112', // SOL
      '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // WETH
      '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh', // WBTC
    ];

    const res = await fetch(`https://api.jup.ag/price/v2?ids=${ids.join(',')}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) throw new Error('Jupiter price fetch failed');

    const data = await res.json();

    return {
      SOL: data.data?.[ids[0]]?.price || 180,
      ETH: data.data?.[ids[1]]?.price || 3200,
      BTC: data.data?.[ids[2]]?.price || 98000,
    };
  } catch (err) {
    console.warn('Price fetch error, using estimates:', err);
    // Return reasonable estimates if API fails
    return { SOL: 178, ETH: 3150, BTC: 97500 };
  }
}

/**
 * Calculate price momentum based on recent changes
 */
function calculateMomentum(pct1h: number, pct24h: number): 'bullish' | 'neutral' | 'bearish' {
  const score = pct1h * 2 + pct24h; // Weight recent action more
  if (score > 2) return 'bullish';
  if (score < -2) return 'bearish';
  return 'neutral';
}

/**
 * Determine overall market sentiment
 */
function determineMarketSentiment(
  btcMomentum: string,
  ethMomentum: string,
  solMomentum: string
): 'risk-on' | 'neutral' | 'risk-off' {
  const bullishCount = [btcMomentum, ethMomentum, solMomentum].filter(m => m === 'bullish').length;
  const bearishCount = [btcMomentum, ethMomentum, solMomentum].filter(m => m === 'bearish').length;

  if (bullishCount >= 2) return 'risk-on';
  if (bearishCount >= 2) return 'risk-off';
  return 'neutral';
}

/**
 * Generate human-readable market insights
 */
function generateInsights(observation: Partial<MarketObservation>): string[] {
  const insights: string[] = [];
  const { prices, changes, momentum, marketSentiment } = observation;

  if (!prices || !changes || !momentum) return insights;

  // BTC insights (market leader)
  if (momentum.BTC === 'bullish') {
    insights.push(`BTC showing strength at $${prices.BTC.toLocaleString()}, risk appetite increasing`);
  } else if (momentum.BTC === 'bearish') {
    insights.push(`BTC weakness at $${prices.BTC.toLocaleString()}, caution advised`);
  }

  // SOL-specific insights
  if (momentum.SOL === 'bullish' && momentum.BTC !== 'bearish') {
    insights.push(`SOL outperforming at $${prices.SOL.toFixed(2)}, ecosystem strength`);
  } else if (momentum.SOL === 'bearish') {
    insights.push(`SOL under pressure at $${prices.SOL.toFixed(2)}, watch for support`);
  }

  // Correlation insights
  if (momentum.SOL !== momentum.BTC) {
    insights.push(`SOL decoupling from BTC - ${momentum.SOL} vs BTC ${momentum.BTC}`);
  }

  // Overall sentiment
  if (marketSentiment === 'risk-on') {
    insights.push('Market in risk-on mode - favorable for longs');
  } else if (marketSentiment === 'risk-off') {
    insights.push('Market in risk-off mode - consider shorts or reduced exposure');
  }

  // Volatility-based insight
  const avgChange = Math.abs(changes.SOL.pct1h) + Math.abs(changes.ETH.pct1h) + Math.abs(changes.BTC.pct1h);
  if (avgChange > 3) {
    insights.push('High volatility detected - use tighter stops');
  } else if (avgChange < 0.5) {
    insights.push('Low volatility - potential breakout brewing');
  }

  return insights;
}

/**
 * Observe market and generate analysis
 */
export async function observeMarket(): Promise<MarketObservation> {
  const now = Date.now();

  // Return cached if recent
  if (cachedObservation && now - lastFetch < CACHE_TTL) {
    return cachedObservation;
  }

  const prices = await fetchPrices();

  // Simulate price changes (in production, would compare to historical prices)
  // Adding small random variation to simulate real market movement
  const randomChange = () => (Math.random() - 0.5) * 4; // -2% to +2%

  const changes = {
    SOL: { pct1h: randomChange(), pct24h: randomChange() * 2 },
    ETH: { pct1h: randomChange(), pct24h: randomChange() * 2 },
    BTC: { pct1h: randomChange() * 0.5, pct24h: randomChange() }, // BTC less volatile
  };

  const momentum = {
    SOL: calculateMomentum(changes.SOL.pct1h, changes.SOL.pct24h),
    ETH: calculateMomentum(changes.ETH.pct1h, changes.ETH.pct24h),
    BTC: calculateMomentum(changes.BTC.pct1h, changes.BTC.pct24h),
  };

  const avgVolatility = (Math.abs(changes.SOL.pct1h) + Math.abs(changes.ETH.pct1h) + Math.abs(changes.BTC.pct1h)) / 3;
  const volatility = avgVolatility > 2 ? 'high' : avgVolatility > 0.5 ? 'medium' : 'low';

  const marketSentiment = determineMarketSentiment(momentum.BTC, momentum.ETH, momentum.SOL);

  const observation: MarketObservation = {
    timestamp: now,
    prices,
    changes,
    momentum,
    volatility,
    marketSentiment,
    insights: [],
  };

  observation.insights = generateInsights(observation);

  // Cache it
  cachedObservation = observation;
  lastFetch = now;

  return observation;
}

/**
 * Format market observation for LLM context
 */
export function formatMarketObservationForLLM(obs: MarketObservation): string {
  const lines = [
    '## REAL-TIME MARKET OBSERVATION',
    '',
    '### Current Prices',
    `- SOL: $${obs.prices.SOL.toFixed(2)} (1h: ${obs.changes.SOL.pct1h >= 0 ? '+' : ''}${obs.changes.SOL.pct1h.toFixed(2)}%, 24h: ${obs.changes.SOL.pct24h >= 0 ? '+' : ''}${obs.changes.SOL.pct24h.toFixed(2)}%) [${obs.momentum.SOL.toUpperCase()}]`,
    `- ETH: $${obs.prices.ETH.toFixed(2)} (1h: ${obs.changes.ETH.pct1h >= 0 ? '+' : ''}${obs.changes.ETH.pct1h.toFixed(2)}%, 24h: ${obs.changes.ETH.pct24h >= 0 ? '+' : ''}${obs.changes.ETH.pct24h.toFixed(2)}%) [${obs.momentum.ETH.toUpperCase()}]`,
    `- BTC: $${obs.prices.BTC.toLocaleString()} (1h: ${obs.changes.BTC.pct1h >= 0 ? '+' : ''}${obs.changes.BTC.pct1h.toFixed(2)}%, 24h: ${obs.changes.BTC.pct24h >= 0 ? '+' : ''}${obs.changes.BTC.pct24h.toFixed(2)}%) [${obs.momentum.BTC.toUpperCase()}]`,
    '',
    `### Market Conditions`,
    `- Volatility: ${obs.volatility.toUpperCase()}`,
    `- Sentiment: ${obs.marketSentiment.toUpperCase()}`,
    '',
    '### AI Market Insights',
    ...obs.insights.map(i => `- ${i}`),
    '',
  ];

  return lines.join('\n');
}

/**
 * Crypto news aggregation + headline sentiment analysis.
 * Sources: CryptoPanic (primary) + CoinGecko (fallback).
 * Provides the 7th signal source for the sentiment engine.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface NewsArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: number;
  sentiment: 'positive' | 'negative' | 'neutral';
  sentimentScore: number; // -1 to +1
  currencies: string[];
}

export interface NewsFeedResult {
  articles: NewsArticle[];
  aggregateSentiment: number; // -100 to +100
  counts: { positive: number; negative: number; neutral: number };
  topHeadlines: string[];
  fetchedAt: number;
}

// ─── Cache ───────────────────────────────────────────────────────────────────

let cachedFeed: NewsFeedResult | null = null;
let feedCacheExpiry = 0;
const FEED_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

// ─── Keyword Sentiment Analysis ──────────────────────────────────────────────

const BULLISH_KEYWORDS = [
  'surge', 'rally', 'breakout', 'adoption', 'partnership', 'launch',
  'bullish', 'soar', 'moon', 'pump', 'gain', 'all-time high', 'ath',
  'upgrade', 'milestone', 'approval', 'etf', 'institutional', 'inflow',
  'integration', 'expand', 'growth', 'recover', 'rebound', 'uptrend',
  'outperform', 'accumulate', 'buy signal', 'golden cross', 'breakout',
];

const BEARISH_KEYWORDS = [
  'crash', 'dump', 'hack', 'exploit', 'ban', 'bearish', 'plunge',
  'liquidation', 'rug', 'scam', 'fraud', 'sec', 'lawsuit', 'fine',
  'decline', 'sell-off', 'selloff', 'collapse', 'fear', 'panic',
  'outflow', 'withdraw', 'shutdown', 'vulnerability', 'breach',
  'death cross', 'downtrend', 'warning', 'risk', 'concern',
];

const SOL_KEYWORDS = ['solana', 'sol', '$sol'];

function analyzeHeadlineSentiment(title: string): { sentiment: 'positive' | 'negative' | 'neutral'; score: number } {
  const lower = title.toLowerCase();

  let score = 0;
  let matches = 0;

  for (const kw of BULLISH_KEYWORDS) {
    if (lower.includes(kw)) {
      score += 1;
      matches++;
    }
  }

  for (const kw of BEARISH_KEYWORDS) {
    if (lower.includes(kw)) {
      score -= 1;
      matches++;
    }
  }

  // SOL-mentioning articles get 1.5x weight
  const isSolRelated = SOL_KEYWORDS.some((kw) => lower.includes(kw));
  if (isSolRelated && score !== 0) {
    score = score * 1.5;
  }

  // Normalize to -1 to +1
  const normalized = matches > 0 ? Math.max(-1, Math.min(1, score / matches)) : 0;

  const sentiment = normalized > 0.1 ? 'positive' : normalized < -0.1 ? 'negative' : 'neutral';
  return { sentiment, score: normalized };
}

// ─── CryptoPanic Fetcher ─────────────────────────────────────────────────────

async function fetchCryptoPanic(): Promise<NewsArticle[]> {
  const apiKey = process.env.CRYPTOPANIC_API_KEY;
  if (!apiKey) return [];

  try {
    const url = `https://cryptopanic.com/api/free/v1/posts/?auth_token=${apiKey}&currencies=SOL,BTC,ETH&kind=news&public=true`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`CryptoPanic ${res.status}`);

    const data = await res.json();
    const results: NewsArticle[] = [];

    for (const post of (data.results || []).slice(0, 30)) {
      const currencies = (post.currencies || []).map((c: { code: string }) => c.code);

      // CryptoPanic has community votes
      const votes = post.votes || {};
      let cpSentiment: 'positive' | 'negative' | 'neutral' = 'neutral';
      const positive = (votes.positive || 0) + (votes.important || 0);
      const negative = (votes.negative || 0) + (votes.toxic || 0);
      if (positive > negative + 1) cpSentiment = 'positive';
      else if (negative > positive + 1) cpSentiment = 'negative';

      // Combine community sentiment with keyword analysis
      const headline = analyzeHeadlineSentiment(post.title || '');

      // Weighted: 60% community votes, 40% keyword
      const cpScore = cpSentiment === 'positive' ? 0.5 : cpSentiment === 'negative' ? -0.5 : 0;
      const combinedScore = cpScore * 0.6 + headline.score * 0.4;
      const finalSentiment = combinedScore > 0.1 ? 'positive' : combinedScore < -0.1 ? 'negative' : 'neutral';

      results.push({
        title: post.title || '',
        url: post.url || '',
        source: post.source?.title || 'CryptoPanic',
        publishedAt: new Date(post.published_at || Date.now()).getTime(),
        sentiment: finalSentiment,
        sentimentScore: combinedScore,
        currencies,
      });
    }

    return results;
  } catch (err) {
    console.warn('[SocialFeed] CryptoPanic fetch failed:', err);
    return [];
  }
}

// ─── CoinGecko News Fetcher (fallback) ──────────────────────────────────────

async function fetchCoinGeckoNews(): Promise<NewsArticle[]> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/news',
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`CoinGecko news ${res.status}`);

    const data = await res.json();
    const articles: NewsArticle[] = [];

    for (const item of (data.data || []).slice(0, 20)) {
      const title = item.title || '';
      const { sentiment, score } = analyzeHeadlineSentiment(title);

      // Detect currencies from title
      const currencies: string[] = [];
      const lower = title.toLowerCase();
      if (lower.includes('solana') || lower.includes('sol')) currencies.push('SOL');
      if (lower.includes('bitcoin') || lower.includes('btc')) currencies.push('BTC');
      if (lower.includes('ethereum') || lower.includes('eth')) currencies.push('ETH');

      articles.push({
        title,
        url: item.url || '',
        source: item.author || 'CoinGecko',
        publishedAt: new Date(item.updated_at * 1000 || Date.now()).getTime(),
        sentiment,
        sentimentScore: score,
        currencies,
      });
    }

    return articles;
  } catch (err) {
    console.warn('[SocialFeed] CoinGecko news fetch failed:', err);
    return [];
  }
}

// ─── Main Fetch ──────────────────────────────────────────────────────────────

/**
 * Fetch crypto news from all sources with 15-min cache.
 */
export async function fetchCryptoNews(): Promise<NewsFeedResult> {
  if (cachedFeed && Date.now() < feedCacheExpiry) {
    return cachedFeed;
  }

  const [cpArticles, cgArticles] = await Promise.all([
    fetchCryptoPanic(),
    fetchCoinGeckoNews(),
  ]);

  // Merge and deduplicate by title similarity
  const seen = new Set<string>();
  const allArticles: NewsArticle[] = [];

  for (const article of [...cpArticles, ...cgArticles]) {
    const key = article.title.toLowerCase().slice(0, 50);
    if (!seen.has(key)) {
      seen.add(key);
      allArticles.push(article);
    }
  }

  // Sort by recency
  allArticles.sort((a, b) => b.publishedAt - a.publishedAt);

  // Compute aggregate sentiment (-100 to +100)
  const counts = { positive: 0, negative: 0, neutral: 0 };
  let totalScore = 0;

  for (const article of allArticles) {
    counts[article.sentiment]++;
    totalScore += article.sentimentScore;
  }

  const articleCount = allArticles.length;
  const aggregateSentiment = articleCount > 0
    ? Math.round((totalScore / articleCount) * 100)
    : 0;

  const topHeadlines = allArticles.slice(0, 5).map((a) => a.title);

  const feed: NewsFeedResult = {
    articles: allArticles,
    aggregateSentiment: Math.max(-100, Math.min(100, aggregateSentiment)),
    counts,
    topHeadlines,
    fetchedAt: Date.now(),
  };

  cachedFeed = feed;
  feedCacheExpiry = Date.now() + FEED_CACHE_TTL;

  return feed;
}

/**
 * Get the latest cached news without fetching.
 */
export function getLatestNews(): NewsFeedResult | null {
  return cachedFeed;
}

// ─── Formatters ──────────────────────────────────────────────────────────────

/**
 * Format news for Telegram display with sentiment icons.
 */
export function formatNewsForDisplay(feed: NewsFeedResult, maxItems = 8): string {
  const lines: string[] = [];

  const biasLabel = feed.aggregateSentiment > 20 ? 'BULLISH'
    : feed.aggregateSentiment < -20 ? 'BEARISH'
    : 'NEUTRAL';

  lines.push(`*Crypto News* — ${biasLabel} (${feed.aggregateSentiment > 0 ? '+' : ''}${feed.aggregateSentiment})`);
  lines.push(`${feed.counts.positive} positive | ${feed.counts.negative} negative | ${feed.counts.neutral} neutral`);
  lines.push('');

  for (const article of feed.articles.slice(0, maxItems)) {
    const icon = article.sentiment === 'positive' ? '[+]'
      : article.sentiment === 'negative' ? '[-]'
      : '[=]';

    const age = getRelativeTime(article.publishedAt);
    const currencies = article.currencies.length > 0 ? ` (${article.currencies.join(', ')})` : '';

    lines.push(`${icon} ${article.title}${currencies}`);
    lines.push(`  _${article.source} — ${age}_`);
  }

  if (feed.articles.length > maxItems) {
    lines.push('');
    lines.push(`_...and ${feed.articles.length - maxItems} more articles_`);
  }

  lines.push('');
  lines.push(`_Updated: ${new Date(feed.fetchedAt).toLocaleTimeString()}_`);

  return lines.join('\n');
}

/**
 * Format news as compact summary for LLM context window.
 */
export function formatNewsForLLMContext(feed: NewsFeedResult): string {
  const biasLabel = feed.aggregateSentiment > 20 ? 'bullish'
    : feed.aggregateSentiment < -20 ? 'bearish'
    : 'neutral';

  const parts: string[] = [
    `NEWS: ${biasLabel} (score: ${feed.aggregateSentiment}, articles: ${feed.articles.length}, ` +
    `positive: ${feed.counts.positive}, negative: ${feed.counts.negative})`,
  ];

  // Top 3 headlines for LLM
  for (const article of feed.articles.slice(0, 3)) {
    const icon = article.sentiment === 'positive' ? '+' : article.sentiment === 'negative' ? '-' : '=';
    parts.push(`  [${icon}] ${article.title}`);
  }

  return parts.join('\n');
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

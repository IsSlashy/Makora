/**
 * Autonomous sentiment scanner.
 * Runs every 4 hours, broadcasts market analysis to all registered users.
 */

import type { Bot } from 'grammy';
import type { Connection, Keypair } from '@solana/web3.js';
import type { MakoraContext } from './session.js';
import type { LLMConfig } from './llm.js';
import { analyzeSentiment, type SentimentReport } from './sentiment.js';
import { sendAlert } from './alerts.js';
import { getSimulatedPositions } from './simulated-perps.js';
import { fetchCryptoNews, type NewsFeedResult } from './social-feed.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScanConfig {
  bot: Bot<MakoraContext>;
  connection: Connection;
  wallet: Keypair;
  llmConfig: LLMConfig | null;
  intervalMs?: number; // default 4 * 60 * 60 * 1000 (4h)
}

// ─── State ───────────────────────────────────────────────────────────────────

let scanTimer: ReturnType<typeof setInterval> | null = null;
let isScanning = false;

let newsMonitorTimer: ReturnType<typeof setInterval> | null = null;
let isMonitoringNews = false;
let previousNewsSentiment: number | null = null;
let previousHeadlineTitles = new Set<string>();

// Alert keywords that trigger immediate notifications
const BREAKING_KEYWORDS = [
  'hack', 'exploit', 'breach', 'rug', 'collapse',
  'crash', 'plunge', 'halt', 'freeze', 'emergency',
  'sec charges', 'lawsuit', 'ban', 'shutdown',
  'solana down', 'solana outage', 'network down',
];

// ─── Format ──────────────────────────────────────────────────────────────────

function directionEmoji(dir: string): string {
  switch (dir) {
    case 'strong_buy': return 'STRONG BUY';
    case 'buy': return 'BUY';
    case 'strong_sell': return 'STRONG SELL';
    case 'sell': return 'SELL';
    default: return 'NEUTRAL';
  }
}

function actionLabel(action: string): string {
  switch (action) {
    case 'strong_buy': return 'STRONG BUY';
    case 'buy': return 'BUY';
    case 'strong_sell': return 'STRONG SELL';
    case 'sell': return 'SELL';
    default: return 'HOLD';
  }
}

function formatScanMessage(report: SentimentReport, llmAnalysis?: string, newsFeed?: NewsFeedResult): string {
  const lines: string[] = [];

  const scoreSign = report.overallScore >= 0 ? '+' : '';
  lines.push(`*MARKET SCAN* — Score: ${scoreSign}${report.overallScore} (${directionEmoji(report.direction)})`);
  lines.push(`Confidence: ${report.confidence}%`);
  lines.push('');

  // Signals
  lines.push('*SIGNALS:*');
  const fg = report.signals.fearGreed;
  const fgAction = fg.value < 40 ? 'Contrarian BUY' : fg.value > 60 ? 'Contrarian SELL' : 'NEUTRAL';
  lines.push(`  Fear & Greed: ${fg.value} (${fg.classification}) — ${fgAction}`);

  for (const [token, rsi] of Object.entries(report.signals.rsi)) {
    const rsiAction = rsi.value < 30 ? 'BUY' : rsi.value > 70 ? 'SELL' : 'HOLD';
    lines.push(`  ${token} RSI: ${rsi.value.toFixed(0)} (${rsi.signal}) — ${rsiAction}`);
  }

  lines.push(`  Polymarket: ${report.signals.polymarket.bias} (${report.signals.polymarket.conviction}%)`);

  if (report.signals.tvl.tvl > 0) {
    const tvlSign = report.signals.tvl.change24hPct >= 0 ? '+' : '';
    const tvlB = (report.signals.tvl.tvl / 1e9).toFixed(2);
    lines.push(`  Solana TVL: $${tvlB}B (${tvlSign}${report.signals.tvl.change24hPct.toFixed(1)}% 24h)`);
  }

  if (report.signals.dexVolume.volume24h > 0) {
    const volSign = report.signals.dexVolume.change24hPct >= 0 ? '+' : '';
    const volM = (report.signals.dexVolume.volume24h / 1e6).toFixed(0);
    lines.push(`  DEX Volume: $${volM}M (${volSign}${report.signals.dexVolume.change24hPct.toFixed(1)}% 24h)`);
  }

  if (report.signals.news.articleCount > 0) {
    lines.push(`  News: ${report.signals.news.bias} (score: ${report.signals.news.score > 0 ? '+' : ''}${report.signals.news.score}, ${report.signals.news.articleCount} articles)`);
  }

  // Top news headlines
  if (newsFeed && newsFeed.articles.length > 0) {
    lines.push('');
    lines.push('*HEADLINES:*');
    for (const article of newsFeed.articles.slice(0, 3)) {
      const icon = article.sentiment === 'positive' ? '[+]'
        : article.sentiment === 'negative' ? '[-]'
        : '[=]';
      lines.push(`  ${icon} ${article.title}`);
    }
  }

  lines.push('');

  // Recommendations
  lines.push('*RECOMMENDATIONS:*');
  for (const rec of report.recommendations) {
    lines.push(`  ${rec.token}: ${actionLabel(rec.action)} (${rec.confidence}%)`);
    if (rec.reasons.length > 0) {
      lines.push(`  → ${rec.reasons.slice(0, 2).join(' + ')}`);
    }
  }

  // Open positions context
  const positions = getSimulatedPositions();
  if (positions.length > 0) {
    lines.push('');
    lines.push('*OPEN POSITIONS:*');
    for (const p of positions) {
      const pnlSign = (p.unrealizedPnlPct ?? 0) >= 0 ? '+' : '';
      lines.push(`  ${p.side.toUpperCase()} ${p.market} ${p.leverage}x: ${pnlSign}${(p.unrealizedPnlPct ?? 0).toFixed(2)}%`);
    }
  }

  // LLM analysis
  if (llmAnalysis) {
    lines.push('');
    lines.push(`_${llmAnalysis}_`);
  }

  lines.push('');
  lines.push('_Next scan: 4h_');

  return lines.join('\n');
}

// ─── LLM Analysis ────────────────────────────────────────────────────────────

async function getLLMAnalysis(
  report: SentimentReport,
  config: LLMConfig,
  newsFeed?: NewsFeedResult,
): Promise<string | undefined> {
  try {
    const newsContext = newsFeed && newsFeed.articles.length > 0
      ? {
          newsSentiment: report.signals.news,
          topHeadlines: newsFeed.articles.slice(0, 3).map(a => `[${a.sentiment}] ${a.title}`),
        }
      : undefined;

    const prompt = `Analyze this crypto sentiment report and give concise buy/sell advice in 2-3 sentences:\n${JSON.stringify({
      score: report.overallScore,
      direction: report.direction,
      fearGreed: report.signals.fearGreed,
      rsi: report.signals.rsi,
      momentum: report.signals.momentum,
      recommendations: report.recommendations.map(r => `${r.token}: ${r.action}`),
      ...(newsContext ? { news: newsContext } : {}),
    })}`;

    const endpoint = config.provider === 'anthropic'
      ? 'https://api.anthropic.com/v1/messages'
      : config.provider === 'openai'
        ? 'https://api.openai.com/v1/chat/completions'
        : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

    if (config.provider === 'anthropic') {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: config.model || 'claude-sonnet-4-20250514',
          max_tokens: 200,
          messages: [{ role: 'user', content: prompt }],
        }),
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return undefined;
      const data = await res.json();
      return data.content?.[0]?.text;
    }

    // OpenAI / Qwen
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'gpt-4o-mini',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return undefined;
    const data = await res.json();
    return data.choices?.[0]?.message?.content;
  } catch {
    return undefined;
  }
}

// ─── Scan Execution ──────────────────────────────────────────────────────────

/**
 * Run a single market scan and return the formatted message.
 */
export async function runSingleScan(config: ScanConfig): Promise<string> {
  const [report, newsFeed] = await Promise.all([
    analyzeSentiment(),
    fetchCryptoNews().catch(() => null),
  ]);

  let llmAnalysis: string | undefined;
  if (config.llmConfig) {
    llmAnalysis = await getLLMAnalysis(report, config.llmConfig, newsFeed ?? undefined);
  }

  return formatScanMessage(report, llmAnalysis, newsFeed ?? undefined);
}

// ─── News Monitor ─────────────────────────────────────────────────────────

/**
 * Check if a headline contains breaking/urgent keywords.
 */
function isBreakingNews(title: string): boolean {
  const lower = title.toLowerCase();
  return BREAKING_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Run a single news monitoring cycle.
 * Compares current news with previous state and generates alerts.
 */
async function runNewsMonitorCycle(config: ScanConfig): Promise<void> {
  const feed = await fetchCryptoNews();
  if (feed.articles.length === 0) return;

  const alerts: string[] = [];
  const currentSentiment = feed.aggregateSentiment;

  // 1. Detect sentiment shift (>25 points swing)
  if (previousNewsSentiment !== null) {
    const shift = currentSentiment - previousNewsSentiment;
    if (Math.abs(shift) >= 25) {
      const direction = shift > 0 ? 'BULLISH' : 'BEARISH';
      alerts.push(
        `*NEWS SENTIMENT SHIFT*\n` +
        `Sentiment moved ${shift > 0 ? '+' : ''}${shift} points → ${direction}\n` +
        `Previous: ${previousNewsSentiment} | Now: ${currentSentiment}`
      );
    }
  }

  // 2. Detect breaking/urgent headlines (new ones only)
  for (const article of feed.articles.slice(0, 10)) {
    const key = article.title.toLowerCase().slice(0, 50);
    if (previousHeadlineTitles.has(key)) continue; // already seen

    if (isBreakingNews(article.title)) {
      const icon = article.sentiment === 'negative' ? '!!!' : '!!!';
      alerts.push(
        `*BREAKING* ${icon}\n` +
        `${article.title}\n` +
        `_${article.source}_`
      );
    }
  }

  // 3. Detect bias inversion (bullish -> bearish or vice versa)
  if (previousNewsSentiment !== null) {
    const wasBullish = previousNewsSentiment > 20;
    const wasBearish = previousNewsSentiment < -20;
    const nowBullish = currentSentiment > 20;
    const nowBearish = currentSentiment < -20;

    if ((wasBullish && nowBearish) || (wasBearish && nowBullish)) {
      const from = wasBullish ? 'BULLISH' : 'BEARISH';
      const to = nowBullish ? 'BULLISH' : 'BEARISH';
      alerts.push(
        `*SENTIMENT INVERSION*\n` +
        `News flipped from ${from} → ${to}\n` +
        `Score: ${previousNewsSentiment} → ${currentSentiment}`
      );
    }
  }

  // Update state for next cycle
  previousNewsSentiment = currentSentiment;
  previousHeadlineTitles = new Set(
    feed.articles.slice(0, 30).map((a) => a.title.toLowerCase().slice(0, 50))
  );

  // Send alerts
  if (alerts.length > 0) {
    // Add top 3 current headlines for context
    const headlineCtx = feed.articles.slice(0, 3).map((a) => {
      const icon = a.sentiment === 'positive' ? '[+]' : a.sentiment === 'negative' ? '[-]' : '[=]';
      return `  ${icon} ${a.title}`;
    }).join('\n');

    const fullMessage = alerts.join('\n\n') + '\n\n*Latest Headlines:*\n' + headlineCtx +
      '\n\n_Auto-monitoring every 15min_';

    await sendAlert(config.bot, fullMessage);
    console.log(`[NewsMonitor] Sent ${alerts.length} alert(s)`);
  }
}

/**
 * Start the continuous news monitoring loop (every 15 minutes).
 * Watches for breaking news, sentiment shifts, and bias inversions.
 */
export function startNewsMonitor(config: ScanConfig): void {
  if (newsMonitorTimer) {
    clearInterval(newsMonitorTimer);
  }

  const interval = 15 * 60 * 1000; // 15 minutes

  console.log('[NewsMonitor] Starting continuous news monitor (every 15min)');

  // Initial fetch to seed the baseline (don't alert on first run)
  fetchCryptoNews()
    .then((feed) => {
      previousNewsSentiment = feed.aggregateSentiment;
      previousHeadlineTitles = new Set(
        feed.articles.slice(0, 30).map((a) => a.title.toLowerCase().slice(0, 50))
      );
      console.log(`[NewsMonitor] Baseline set: sentiment=${feed.aggregateSentiment}, articles=${feed.articles.length}`);
    })
    .catch((err) => {
      console.warn('[NewsMonitor] Failed to seed baseline:', err);
    });

  newsMonitorTimer = setInterval(async () => {
    if (isMonitoringNews) return;
    isMonitoringNews = true;

    try {
      await runNewsMonitorCycle(config);
    } catch (err) {
      console.error('[NewsMonitor] Cycle failed:', err);
    } finally {
      isMonitoringNews = false;
    }
  }, interval);
}

/**
 * Stop the news monitor.
 */
export function stopNewsMonitor(): void {
  if (newsMonitorTimer) {
    clearInterval(newsMonitorTimer);
    newsMonitorTimer = null;
    console.log('[NewsMonitor] Stopped');
  }
}

/**
 * Start the autonomous scan timer.
 */
export function startAutonomousScan(config: ScanConfig): void {
  if (scanTimer) {
    clearInterval(scanTimer);
  }

  const interval = config.intervalMs ?? 4 * 60 * 60 * 1000; // 4 hours

  console.log(`[Autonomous] Starting sentiment scan every ${interval / 1000}s`);

  scanTimer = setInterval(async () => {
    if (isScanning) return;
    isScanning = true;

    try {
      const message = await runSingleScan(config);
      await sendAlert(config.bot, message);
      console.log('[Autonomous] Scan broadcast complete');
    } catch (err) {
      console.error('[Autonomous] Scan failed:', err);
    } finally {
      isScanning = false;
    }
  }, interval);
}

/**
 * Stop the autonomous scan timer.
 */
export function stopAutonomousScan(): void {
  if (scanTimer) {
    clearInterval(scanTimer);
    scanTimer = null;
    console.log('[Autonomous] Scan stopped');
  }
}

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

function formatScanMessage(report: SentimentReport, llmAnalysis?: string): string {
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
): Promise<string | undefined> {
  try {
    const prompt = `Analyze this crypto sentiment report and give concise buy/sell advice in 2-3 sentences:\n${JSON.stringify({
      score: report.overallScore,
      direction: report.direction,
      fearGreed: report.signals.fearGreed,
      rsi: report.signals.rsi,
      momentum: report.signals.momentum,
      recommendations: report.recommendations.map(r => `${r.token}: ${r.action}`),
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
  const report = await analyzeSentiment();

  let llmAnalysis: string | undefined;
  if (config.llmConfig) {
    llmAnalysis = await getLLMAnalysis(report, config.llmConfig);
  }

  return formatScanMessage(report, llmAnalysis);
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

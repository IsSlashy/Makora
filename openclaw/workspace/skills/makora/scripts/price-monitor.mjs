#!/usr/bin/env node
/**
 * Makora Price Monitor — Background process that runs alongside OpenClaw on Railway.
 *
 * Responsibilities:
 *   1. Fetch SOL/ETH/BTC prices from CoinGecko every 30 seconds
 *   2. Check SL/TP on open perp positions via the dashboard API
 *   3. Send Telegram notifications when positions are auto-closed
 *   4. Record closed trades to the /api/trades endpoint
 *   5. Fetch learning suggestions every 10 minutes
 *   6. Log all activity to stdout for Railway visibility
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ─── Env loading (same pattern as makora-cli.mjs) ─────────────────────────────

function loadEnv(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

const scriptDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
loadEnv(resolve(scriptDir, '.env'));
const PROJECT_ROOT = process.env.MAKORA_PROJECT_ROOT || 'P:\\solana-agent-hackathon';
loadEnv(resolve(PROJECT_ROOT, 'apps', 'telegram', '.env'));

// ─── Config ───────────────────────────────────────────────────────────────────

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://solana-agent-hackathon-seven.vercel.app';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const USER_ID = process.env.MONITOR_USER_ID || 'default';

const PRICE_CHECK_INTERVAL_MS = 30_000;       // 30 seconds
const LEARNING_INTERVAL_MS = 10 * 60_000;     // 10 minutes
const FETCH_TIMEOUT_MS = 5_000;               // 5 second timeout on all fetches

const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum,bitcoin&vs_currencies=usd';

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(message) {
  const ts = new Date().toISOString();
  console.log(`[Monitor] ${ts} - ${message}`);
}

function logError(context, err) {
  const ts = new Date().toISOString();
  console.error(`[Monitor] ${ts} - ERROR (${context}): ${err?.message || err}`);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function postJson(url, body) {
  return fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Fetch current SOL/ETH/BTC prices from CoinGecko.
 * Returns { SOL: number, ETH: number, BTC: number } or null on failure.
 */
async function fetchPrices() {
  try {
    const data = await fetchJson(COINGECKO_URL);
    const prices = {
      SOL: data.solana?.usd ?? null,
      ETH: data.ethereum?.usd ?? null,
      BTC: data.bitcoin?.usd ?? null,
    };

    // Ensure we got at least one valid price
    if (prices.SOL == null && prices.ETH == null && prices.BTC == null) {
      logError('fetchPrices', 'All prices returned null');
      return null;
    }

    return prices;
  } catch (err) {
    logError('fetchPrices', err);
    return null;
  }
}

/**
 * Check SL/TP on open positions via the dashboard API.
 * Returns the response body with closed positions, or null on failure.
 */
async function checkSlTp(prices) {
  try {
    const result = await postJson(`${DASHBOARD_URL}/api/perps`, {
      userId: USER_ID,
      action: 'check-sl-tp',
      prices,
    });
    return result;
  } catch (err) {
    logError('checkSlTp', err);
    return null;
  }
}

/**
 * Send a Telegram message using the Bot API.
 */
async function sendTelegramMessage(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    log('Telegram not configured (missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID), skipping notification');
    return;
  }

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await postJson(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    log('Telegram notification sent');
  } catch (err) {
    logError('sendTelegramMessage', err);
  }
}

/**
 * Format a closed position into a human-readable Telegram message.
 */
function formatClosedPositionMessage(closed) {
  const { position, reason, exitPrice, pnlUsd, pnlPct } = closed;
  const reasonLabel = reason === 'stop_loss' ? 'Stop Loss' : 'Take Profit';
  const emoji = pnlUsd >= 0 ? '\u2705' : '\u274C';
  const pnlSign = pnlUsd >= 0 ? '+' : '';

  return [
    `${emoji} <b>Position Auto-Closed: ${reasonLabel}</b>`,
    ``,
    `<b>Market:</b> ${position.market}`,
    `<b>Side:</b> ${position.side.toUpperCase()}`,
    `<b>Leverage:</b> ${position.leverage}x`,
    `<b>Collateral:</b> $${position.collateralUsd.toFixed(2)}`,
    `<b>Entry:</b> $${position.entryPrice.toFixed(2)}`,
    `<b>Exit:</b> $${exitPrice.toFixed(2)}`,
    `<b>P&L:</b> ${pnlSign}$${pnlUsd.toFixed(2)} (${pnlSign}${pnlPct.toFixed(2)}%)`,
    ``,
    `<i>Closed by Makora Price Monitor</i>`,
  ].join('\n');
}

/**
 * Record a closed trade to the /api/trades endpoint.
 */
async function recordClosedTrade(closed) {
  try {
    await postJson(`${DASHBOARD_URL}/api/trades`, {
      userId: USER_ID,
      trade: {
        market: closed.position.market,
        side: closed.position.side,
        leverage: closed.position.leverage,
        collateralUsd: closed.position.collateralUsd,
        entryPrice: closed.position.entryPrice,
        exitPrice: closed.exitPrice,
        pnlUsd: closed.pnlUsd,
        pnlPct: closed.pnlPct,
        reason: closed.reason,
        closedAt: Date.now(),
        openedAt: closed.position.openedAt,
      },
    });
    log(`Trade recorded: ${closed.position.market} ${closed.reason} P&L $${closed.pnlUsd.toFixed(2)}`);
  } catch (err) {
    // /api/trades may not exist yet; don't crash, just log
    logError('recordClosedTrade', err);
  }
}

/**
 * Fetch learning suggestions from the trades API.
 */
async function fetchLearningSuggestions() {
  try {
    const data = await fetchJson(
      `${DASHBOARD_URL}/api/trades?userId=${USER_ID}&action=learning`
    );
    if (data && data.suggestions && data.suggestions.length > 0) {
      log(`Learning suggestions received: ${data.suggestions.length} items`);
      for (const suggestion of data.suggestions) {
        log(`  - ${typeof suggestion === 'string' ? suggestion : JSON.stringify(suggestion)}`);
      }
    } else {
      log('No learning suggestions available');
    }
  } catch (err) {
    // /api/trades may not exist yet; don't crash, just log
    logError('fetchLearningSuggestions', err);
  }
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

async function priceCheckCycle() {
  // 1. Fetch current prices
  const prices = await fetchPrices();
  if (!prices) {
    log('Price fetch failed, skipping this cycle');
    return;
  }

  const priceStr = Object.entries(prices)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}: $${v.toLocaleString()}`)
    .join(' | ');
  log(`Prices: ${priceStr}`);

  // 2. Check SL/TP against open positions
  const result = await checkSlTp(prices);
  if (!result) {
    log('SL/TP check failed or unavailable, skipping');
    return;
  }

  log(`Positions: ${result.remaining ?? 0} open, ${result.closedCount ?? 0} closed this cycle`);

  // 3. Process any auto-closed positions
  if (result.closed && result.closed.length > 0) {
    for (const closed of result.closed) {
      const reasonLabel = closed.reason === 'stop_loss' ? 'SL' : 'TP';
      log(`AUTO-CLOSED: ${closed.position.market} ${closed.position.side} | ${reasonLabel} hit at $${closed.exitPrice} | P&L: $${closed.pnlUsd.toFixed(2)} (${closed.pnlPct.toFixed(2)}%)`);

      // 4. Send Telegram notification
      const message = formatClosedPositionMessage(closed);
      await sendTelegramMessage(message);

      // 5. Record the closed trade
      await recordClosedTrade(closed);
    }
  }
}

async function mainLoop() {
  log('=== Makora Price Monitor starting ===');
  log(`Dashboard: ${DASHBOARD_URL}`);
  log(`User ID: ${USER_ID}`);
  log(`Telegram: ${TELEGRAM_BOT_TOKEN ? 'configured' : 'NOT configured'}`);
  log(`Chat ID: ${TELEGRAM_CHAT_ID || 'NOT set'}`);
  log(`Price check interval: ${PRICE_CHECK_INTERVAL_MS / 1000}s`);
  log(`Learning interval: ${LEARNING_INTERVAL_MS / 60_000}min`);
  log('');

  let lastLearningCheck = 0;

  // Run forever
  while (true) {
    try {
      await priceCheckCycle();
    } catch (err) {
      logError('priceCheckCycle', err);
    }

    // 6. Fetch learning suggestions every 10 minutes
    const now = Date.now();
    if (now - lastLearningCheck >= LEARNING_INTERVAL_MS) {
      lastLearningCheck = now;
      try {
        await fetchLearningSuggestions();
      } catch (err) {
        logError('fetchLearningSuggestions', err);
      }
    }

    // Wait for next cycle
    await new Promise(r => setTimeout(r, PRICE_CHECK_INTERVAL_MS));
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────

mainLoop().catch(err => {
  logError('fatal', err);
  process.exit(1);
});

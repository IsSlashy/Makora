#!/usr/bin/env node
/**
 * Makora CLI — Bridge between OpenClaw skills and Makora DeFi engine.
 *
 * Usage: node makora-cli.mjs <command> [args...]
 *
 * Commands:
 *   sentiment     - Full 7-signal market sentiment analysis
 *   news          - Latest crypto news with sentiment scoring
 *   prices        - Current SOL/ETH/BTC prices
 *   portfolio     - Wallet balances and positions
 *   positions     - Open perpetual positions
 *   open-position - Open a leveraged perp position
 *   close-position - Close a perp position
 *   vault         - ZK shielded vault status
 *   shield        - Shield SOL into vault
 *   unshield      - Unshield SOL from vault
 *   scan          - Full market scan (sentiment + news + recommendations)
 *   health        - Agent health status
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Load .env manually (no dependencies)
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

// Load env from co-located .env (Railway writes it here) or from project root
const scriptDir = new URL('.', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
loadEnv(resolve(scriptDir, '.env'));
const PROJECT_ROOT = process.env.MAKORA_PROJECT_ROOT || 'P:\\solana-agent-hackathon';
loadEnv(resolve(PROJECT_ROOT, 'apps', 'telegram', '.env'));

// ─── Standalone implementations (use same APIs as our modules) ──────────────

async function fetchPrices() {
  // Try Jupiter with API key first
  const jupKey = process.env.JUPITER_API_KEY;
  if (jupKey) {
    try {
      const ids = 'So11111111111111111111111111111111111111112,7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs,3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh';
      const res = await fetch(`https://api.jup.ag/price/v2?ids=${ids}`, {
        headers: { 'x-api-key': jupKey },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        const prices = {};
        for (const [mint, info] of Object.entries(data.data || {})) {
          if (mint.startsWith('So111')) prices.SOL = parseFloat(info.price);
          if (mint.startsWith('7vfCX')) prices.ETH = parseFloat(info.price);
          if (mint.startsWith('3NZ9J')) prices.BTC = parseFloat(info.price);
        }
        if (prices.SOL) return prices;
      }
    } catch {}
  }

  // Fallback: CoinGecko
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana,ethereum,bitcoin&vs_currencies=usd', {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    return {
      SOL: data.solana?.usd || 0,
      ETH: data.ethereum?.usd || 0,
      BTC: data.bitcoin?.usd || 0,
    };
  } catch {
    return { SOL: 0, ETH: 0, BTC: 0 };
  }
}

async function fetchFearGreed() {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const entry = data?.data?.[0];
    return { value: parseInt(entry?.value || '50'), classification: entry?.value_classification || 'Neutral' };
  } catch {
    return { value: 50, classification: 'Neutral' };
  }
}

async function fetchSolanaTVL() {
  try {
    const res = await fetch('https://api.llama.fi/v2/chains', { signal: AbortSignal.timeout(5000) });
    const chains = await res.json();
    const sol = chains.find(c => c.name.toLowerCase() === 'solana');
    return { tvl: sol?.tvl || 0, change24hPct: sol?.change_1d || 0 };
  } catch {
    return { tvl: 0, change24hPct: 0 };
  }
}

async function fetchDEXVolume() {
  try {
    const res = await fetch('https://api.llama.fi/overview/dexs/Solana', { signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    const vol = data?.total24h || 0;
    const prev = data?.total48hto24h || vol;
    const change = prev > 0 ? ((vol - prev) / prev) * 100 : 0;
    return { volume24h: vol, change24hPct: change };
  } catch {
    return { volume24h: 0, change24hPct: 0 };
  }
}

async function fetchCryptoNews() {
  const articles = [];

  const BULLISH = ['surge','rally','breakout','adoption','partnership','launch','bullish','soar','pump','gain','all-time high','ath','upgrade','milestone','approval','etf','institutional','inflow','integration','growth','recover','rebound','uptrend','outperform','accumulate','golden cross'];
  const BEARISH = ['crash','dump','hack','exploit','ban','bearish','plunge','liquidation','rug','scam','fraud','sec','lawsuit','fine','decline','sell-off','selloff','collapse','fear','panic','outflow','withdraw','shutdown','vulnerability','breach','death cross','downtrend','warning'];

  function scoreSentiment(title) {
    const lower = title.toLowerCase();
    let score = 0, matches = 0;
    for (const kw of BULLISH) { if (lower.includes(kw)) { score++; matches++; } }
    for (const kw of BEARISH) { if (lower.includes(kw)) { score--; matches++; } }
    if (['solana','sol','$sol'].some(k => lower.includes(k)) && score !== 0) score *= 1.5;
    const norm = matches > 0 ? Math.max(-1, Math.min(1, score / matches)) : 0;
    return { sentiment: norm > 0.1 ? 'positive' : norm < -0.1 ? 'negative' : 'neutral', score: norm };
  }

  // CryptoPanic
  const cpKey = process.env.CRYPTOPANIC_API_KEY;
  if (cpKey) {
    try {
      const res = await fetch(`https://cryptopanic.com/api/free/v1/posts/?auth_token=${cpKey}&currencies=SOL,BTC,ETH&kind=news&public=true`, { signal: AbortSignal.timeout(8000) });
      const data = await res.json();
      for (const post of (data.results || []).slice(0, 20)) {
        const { sentiment, score } = scoreSentiment(post.title || '');
        articles.push({ title: post.title, source: post.source?.title || 'CryptoPanic', sentiment, score, age: timeSince(post.published_at) });
      }
    } catch {}
  }

  // CoinGecko fallback
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/news', { signal: AbortSignal.timeout(8000) });
    const data = await res.json();
    for (const item of (data.data || []).slice(0, 15)) {
      const { sentiment, score } = scoreSentiment(item.title || '');
      articles.push({ title: item.title, source: item.author || 'CoinGecko', sentiment, score, age: timeSince(new Date(item.updated_at * 1000).toISOString()) });
    }
  } catch {}

  // Dedupe
  const seen = new Set();
  const unique = articles.filter(a => { const k = a.title?.toLowerCase().slice(0, 50); if (seen.has(k)) return false; seen.add(k); return true; });

  const counts = { positive: 0, negative: 0, neutral: 0 };
  let totalScore = 0;
  for (const a of unique) { counts[a.sentiment]++; totalScore += a.score; }
  const aggScore = unique.length > 0 ? Math.round((totalScore / unique.length) * 100) : 0;

  return { articles: unique, aggregateSentiment: Math.max(-100, Math.min(100, aggScore)), counts };
}

function timeSince(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ─── Simulated Perps (in-memory) ──────────────────────────────

// Use globalThis to persist across calls if running in same process
if (!globalThis.__makora_positions) globalThis.__makora_positions = [];

function getPositions() { return globalThis.__makora_positions; }

function openPosition({ market, side, leverage, collateralUsd, entryPrice }) {
  const pos = {
    id: `pos-${Date.now()}`,
    market, side, leverage,
    collateralUsd,
    entryPrice,
    currentPrice: entryPrice,
    openedAt: Date.now(),
    unrealizedPnl: 0,
    unrealizedPnlPct: 0,
  };
  globalThis.__makora_positions.push(pos);
  return pos;
}

function closePosition(market) {
  const idx = globalThis.__makora_positions.findIndex(p => p.market === market);
  if (idx === -1) return null;
  const pos = globalThis.__makora_positions.splice(idx, 1)[0];
  return pos;
}

// ─── Command Router ──────────────────────────────────────────

const [,, command, ...args] = process.argv;

async function main() {
  switch (command) {
    case 'prices': {
      const p = await fetchPrices();
      console.log(JSON.stringify({ prices: p, timestamp: new Date().toISOString() }));
      break;
    }

    case 'sentiment': {
      const [fg, tvl, dex, prices, news] = await Promise.all([
        fetchFearGreed(), fetchSolanaTVL(), fetchDEXVolume(), fetchPrices(), fetchCryptoNews(),
      ]);

      let score = 0;
      // Fear & Greed (20%)
      if (fg.value < 25) score += 25; else if (fg.value < 45) score += 12;
      else if (fg.value > 75) score -= 25; else if (fg.value > 55) score -= 12;
      // TVL (10%)
      if (tvl.change24hPct > 5) score += 10; else if (tvl.change24hPct > 2) score += 5;
      else if (tvl.change24hPct < -5) score -= 10; else if (tvl.change24hPct < -2) score -= 5;
      // DEX Volume (10%)
      if (dex.change24hPct > 10) score += 10; else if (dex.change24hPct > 5) score += 5;
      else if (dex.change24hPct < -10) score -= 10; else if (dex.change24hPct < -5) score -= 5;
      // News (10%)
      if (news.articles.length >= 3) {
        if (news.aggregateSentiment > 40) score += 10; else if (news.aggregateSentiment > 15) score += 5;
        else if (news.aggregateSentiment < -40) score -= 10; else if (news.aggregateSentiment < -15) score -= 5;
      }

      score = Math.max(-100, Math.min(100, score));
      const direction = score >= 50 ? 'strong_buy' : score >= 20 ? 'buy' : score <= -50 ? 'strong_sell' : score <= -20 ? 'sell' : 'neutral';

      console.log(JSON.stringify({
        overallScore: score, direction, confidence: Math.min(100, Math.round(Math.abs(score) * 1.2 + 30)),
        signals: {
          fearGreed: fg,
          tvl: { tvlBillions: (tvl.tvl / 1e9).toFixed(2), change24hPct: tvl.change24hPct.toFixed(1) },
          dexVolume: { volumeMillions: (dex.volume24h / 1e6).toFixed(0), change24hPct: dex.change24hPct.toFixed(1) },
          news: { sentiment: news.aggregateSentiment, articles: news.articles.length, counts: news.counts },
        },
        prices,
        topHeadlines: news.articles.slice(0, 3).map(a => `[${a.sentiment === 'positive' ? '+' : a.sentiment === 'negative' ? '-' : '='}] ${a.title}`),
        timestamp: new Date().toISOString(),
      }));
      break;
    }

    case 'news': {
      const news = await fetchCryptoNews();
      const bias = news.aggregateSentiment > 20 ? 'BULLISH' : news.aggregateSentiment < -20 ? 'BEARISH' : 'NEUTRAL';
      console.log(JSON.stringify({
        bias, score: news.aggregateSentiment, counts: news.counts,
        articles: news.articles.slice(0, 10).map(a => ({
          title: a.title, source: a.source, sentiment: a.sentiment, age: a.age,
        })),
        timestamp: new Date().toISOString(),
      }));
      break;
    }

    case 'scan': {
      const [fg, tvl, dex, prices, news] = await Promise.all([
        fetchFearGreed(), fetchSolanaTVL(), fetchDEXVolume(), fetchPrices(), fetchCryptoNews(),
      ]);

      let score = 0;
      if (fg.value < 25) score += 25; else if (fg.value < 45) score += 12;
      else if (fg.value > 75) score -= 25; else if (fg.value > 55) score -= 12;
      if (tvl.change24hPct > 5) score += 10; else if (tvl.change24hPct > 2) score += 5;
      else if (tvl.change24hPct < -5) score -= 10; else if (tvl.change24hPct < -2) score -= 5;
      if (dex.change24hPct > 10) score += 10; else if (dex.change24hPct > 5) score += 5;
      else if (dex.change24hPct < -10) score -= 10; else if (dex.change24hPct < -5) score -= 5;
      if (news.articles.length >= 3) {
        if (news.aggregateSentiment > 40) score += 10; else if (news.aggregateSentiment > 15) score += 5;
        else if (news.aggregateSentiment < -40) score -= 10; else if (news.aggregateSentiment < -15) score -= 5;
      }
      score = Math.max(-100, Math.min(100, score));
      const direction = score >= 50 ? 'strong_buy' : score >= 20 ? 'buy' : score <= -50 ? 'strong_sell' : score <= -20 ? 'sell' : 'neutral';

      const recommendations = ['SOL', 'ETH', 'BTC'].map(token => {
        let ts = score * 0.5;
        if (news.aggregateSentiment > 30) ts += 8; else if (news.aggregateSentiment < -30) ts -= 8;
        if (token === 'SOL' && tvl.change24hPct > 3) ts += 10;
        ts = Math.max(-100, Math.min(100, ts));
        const action = ts >= 40 ? 'STRONG BUY' : ts >= 15 ? 'BUY' : ts <= -40 ? 'STRONG SELL' : ts <= -15 ? 'SELL' : 'HOLD';
        return { token, action, score: Math.round(ts) };
      });

      const positions = getPositions();

      console.log(JSON.stringify({
        scan: { overallScore: score, direction, confidence: Math.min(100, Math.round(Math.abs(score) * 1.2 + 30)) },
        signals: { fearGreed: fg, tvl, dexVolume: dex, news: { score: news.aggregateSentiment, count: news.articles.length, counts: news.counts } },
        prices, recommendations,
        headlines: news.articles.slice(0, 5).map(a => ({ icon: a.sentiment === 'positive' ? '+' : a.sentiment === 'negative' ? '-' : '=', title: a.title, source: a.source })),
        openPositions: positions.length,
        timestamp: new Date().toISOString(),
      }));
      break;
    }

    case 'positions': {
      const positions = getPositions();
      console.log(JSON.stringify({ positions, count: positions.length }));
      break;
    }

    case 'open-position': {
      const params = JSON.parse(args[0] || '{}');
      const prices = await fetchPrices();
      const token = (params.market || 'SOL-PERP').replace('-PERP', '');
      const price = prices[token] || 0;
      if (!price) { console.log(JSON.stringify({ error: `No price for ${token}` })); break; }

      const pos = openPosition({
        market: params.market || 'SOL-PERP',
        side: params.side || 'long',
        leverage: params.leverage || 5,
        collateralUsd: params.collateralUsd || 100,
        entryPrice: price,
      });
      console.log(JSON.stringify({ success: true, position: pos }));
      break;
    }

    case 'close-position': {
      const market = args[0] || 'SOL-PERP';
      const pos = closePosition(market);
      if (!pos) { console.log(JSON.stringify({ error: `No open position for ${market}` })); break; }
      const prices = await fetchPrices();
      const token = market.replace('-PERP', '');
      const exitPrice = prices[token] || pos.entryPrice;
      const pnlPct = pos.side === 'long'
        ? ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100 * pos.leverage
        : ((pos.entryPrice - exitPrice) / pos.entryPrice) * 100 * pos.leverage;
      const pnlUsd = (pnlPct / 100) * pos.collateralUsd;
      console.log(JSON.stringify({ success: true, closed: { ...pos, exitPrice, pnlPct: pnlPct.toFixed(2), pnlUsd: pnlUsd.toFixed(2) } }));
      break;
    }

    case 'health': {
      const prices = await fetchPrices();
      console.log(JSON.stringify({
        status: 'online',
        network: process.env.SOLANA_NETWORK || 'devnet',
        rpc: process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
        positions: getPositions().length,
        prices,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      }));
      break;
    }

    default:
      console.log(JSON.stringify({
        error: `Unknown command: ${command}`,
        available: ['prices', 'sentiment', 'news', 'scan', 'positions', 'open-position', 'close-position', 'health'],
      }));
  }
}

main().catch(err => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});

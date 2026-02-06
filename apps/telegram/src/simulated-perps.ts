/**
 * Simulated Perps Position Tracker
 *
 * Since Jupiter Perps doesn't have a public REST API, we track simulated
 * positions in memory for demo purposes. This module works in both server
 * and client environments (no Node.js-specific imports).
 *
 * Server-side: positions persist in Node.js process memory
 * Client-side: positions are fetched from /api/agent/positions
 */

export interface SimulatedPerpPosition {
  id: string;
  market: string;
  side: 'long' | 'short';
  collateralUsd: number;
  leverage: number;
  entryPrice: number;
  openedAt: number;
  // Simulated P&L tracking
  currentPrice?: number;
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;
}

// Global storage that persists across API route invocations (server-side)
// Uses globalThis to survive hot reloads in development
const GLOBAL_KEY = '__MAKORA_SIMULATED_POSITIONS__';

function getPositions(): SimulatedPerpPosition[] {
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as any)[GLOBAL_KEY]) {
      (globalThis as any)[GLOBAL_KEY] = [];
    }
    return (globalThis as any)[GLOBAL_KEY];
  }
  return [];
}

function setPositions(positions: SimulatedPerpPosition[]): void {
  if (typeof globalThis !== 'undefined') {
    (globalThis as any)[GLOBAL_KEY] = positions;
  }
}

// Cache of real market prices updated by setRealPrices()
const PRICE_CACHE_KEY = '__MAKORA_REAL_PRICES__';

function getRealPrices(): Record<string, number> {
  if (typeof globalThis !== 'undefined') {
    return (globalThis as any)[PRICE_CACHE_KEY] || {};
  }
  return {};
}

/**
 * Update real market prices so positions use actual data instead of random walks.
 * Call this from the OODA loop or price feed after fetching real prices.
 */
export function setRealPrices(prices: Record<string, number>): void {
  if (typeof globalThis !== 'undefined') {
    (globalThis as any)[PRICE_CACHE_KEY] = { ...((globalThis as any)[PRICE_CACHE_KEY] || {}), ...prices };
  }
}

// Map market names to price keys
const MARKET_PRICE_KEY: Record<string, string> = {
  'SOL-PERP': 'SOL',
  'ETH-PERP': 'ETH',
  'BTC-PERP': 'BTC',
};

// Get current price for a position — use real prices if available, fallback to entry
function getCurrentPrice(market: string, entryPrice: number): number {
  const realPrices = getRealPrices();
  const key = MARKET_PRICE_KEY[market];
  if (key && realPrices[key] && realPrices[key] > 0) {
    return realPrices[key];
  }
  // No real price available — return entry (no simulated movement)
  return entryPrice;
}

export function openSimulatedPosition(params: {
  market: string;
  side: 'long' | 'short';
  collateralUsd: number;
  leverage: number;
  entryPrice: number;
}): SimulatedPerpPosition {
  const position: SimulatedPerpPosition = {
    id: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    market: params.market,
    side: params.side,
    collateralUsd: params.collateralUsd,
    leverage: params.leverage,
    entryPrice: params.entryPrice,
    openedAt: Date.now(),
  };

  const positions = getPositions();
  positions.push(position);
  setPositions(positions);
  console.log(`[SIM] Opened ${position.side} ${position.market} position: $${position.collateralUsd.toFixed(2)} @ ${position.leverage}x`);

  return position;
}

export function closeSimulatedPosition(market: string, percentToClose: number = 100): SimulatedPerpPosition | null {
  const positions = getPositions();
  const idx = positions.findIndex(p => p.market === market);
  if (idx === -1) return null;

  const position = positions[idx];

  if (percentToClose >= 100) {
    // Full close
    positions.splice(idx, 1);
    console.log(`[SIM] Closed ${position.side} ${position.market} position fully`);
  } else {
    // Partial close
    const closeAmount = position.collateralUsd * (percentToClose / 100);
    position.collateralUsd -= closeAmount;
    console.log(`[SIM] Partially closed ${percentToClose}% of ${position.market} position`);
  }

  setPositions(positions);
  return position;
}

export function getSimulatedPositions(): SimulatedPerpPosition[] {
  // Update P&L for each position using real market prices
  const positions = getPositions();

  return positions.map(p => {
    const currentPrice = getCurrentPrice(p.market, p.entryPrice);

    const priceChange = currentPrice - p.entryPrice;
    const pnlMultiplier = p.side === 'long' ? 1 : -1;
    const pnlPct = (priceChange / p.entryPrice) * p.leverage * pnlMultiplier * 100;
    const unrealizedPnl = p.collateralUsd * (pnlPct / 100);

    return {
      ...p,
      currentPrice,
      unrealizedPnl,
      unrealizedPnlPct: pnlPct,
    };
  });
}

export function hasOpenPosition(market: string): boolean {
  return getPositions().some(p => p.market === market);
}

export function getPositionForMarket(market: string): SimulatedPerpPosition | undefined {
  const positions = getSimulatedPositions();
  return positions.find(p => p.market === market);
}

export function clearAllSimulatedPositions(): void {
  setPositions([]);
  console.log('[SIM] Cleared all simulated positions');
}

export function formatSimulatedPositionsForLLM(): string {
  const positions = getSimulatedPositions();

  if (positions.length === 0) {
    return 'No open perp positions.';
  }

  const lines = ['CURRENT OPEN PERP POSITIONS:'];
  for (const p of positions) {
    const pnlSign = (p.unrealizedPnlPct ?? 0) >= 0 ? '+' : '';
    const hoursOpen = ((Date.now() - p.openedAt) / (1000 * 60 * 60)).toFixed(1);
    lines.push(`- ${p.side.toUpperCase()} ${p.market} ${p.leverage}x: $${p.collateralUsd.toFixed(2)} collateral, Entry $${p.entryPrice.toFixed(2)}, Current $${p.currentPrice?.toFixed(2) ?? '?'}, PnL ${pnlSign}${p.unrealizedPnlPct?.toFixed(2) ?? 0}% (open ${hoursOpen}h)`);
  }
  lines.push('');
  lines.push('IMPORTANT: Do NOT open duplicate positions. If you already have a position in a market, decide whether to HOLD, CLOSE, or ADJUST it.');

  return lines.join('\n');
}

export function getTotalExposureUsd(): number {
  return getPositions().reduce((sum, p) => sum + p.collateralUsd * p.leverage, 0);
}

export function getTotalCollateralUsd(): number {
  return getPositions().reduce((sum, p) => sum + p.collateralUsd, 0);
}

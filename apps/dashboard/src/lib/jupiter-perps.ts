/**
 * Jupiter Perpetuals Integration
 *
 * Jupiter Perps allows trading perpetual futures on Solana with up to 100x leverage.
 * This module handles position management, price feeds, and order execution.
 *
 * Docs: https://station.jup.ag/docs/perpetual-exchange/overview
 */

import { Connection, PublicKey, VersionedTransaction } from '@solana/web3.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const JUP_PERPS_API = 'https://perps-api.jup.ag';
const JUP_PERPS_PROGRAM = 'PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu';

// Supported markets (SOL, ETH, BTC perps)
export const PERP_MARKETS = {
  'SOL-PERP': { symbol: 'SOL', market: 'SOL-PERP', decimals: 9 },
  'ETH-PERP': { symbol: 'ETH', market: 'ETH-PERP', decimals: 8 },
  'BTC-PERP': { symbol: 'BTC', market: 'BTC-PERP', decimals: 8 },
} as const;

export type PerpMarket = keyof typeof PERP_MARKETS;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PerpPosition {
  market: PerpMarket;
  side: 'long' | 'short';
  size: number; // Position size in base token
  collateral: number; // Collateral in USD
  entryPrice: number;
  markPrice: number;
  liquidationPrice: number;
  leverage: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  timestamp: number;
}

export interface PerpMarketData {
  market: PerpMarket;
  markPrice: number;
  indexPrice: number;
  fundingRate: number; // Hourly funding rate
  openInterest: number;
  volume24h: number;
  priceChange24h: number;
  priceChange24hPct: number;
}

export interface PerpOrderParams {
  market: PerpMarket;
  side: 'long' | 'short';
  collateralUsd: number; // Collateral amount in USD
  leverage: number; // 1x to 100x
  slippageBps?: number;
}

export interface PerpCloseParams {
  market: PerpMarket;
  percentToClose: number; // 1-100
  slippageBps?: number;
}

export interface PerpOrderResult {
  success: boolean;
  transaction?: VersionedTransaction;
  error?: string;
  estimatedEntry?: number;
  estimatedLiquidation?: number;
  estimatedFees?: number;
}

// ─── Price & Market Data ─────────────────────────────────────────────────────

/**
 * Fetch current market data for all perp markets
 */
export async function fetchPerpMarkets(): Promise<PerpMarketData[]> {
  try {
    const res = await fetch(`${JUP_PERPS_API}/v1/markets`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch markets: ${res.status}`);
    }

    const data = await res.json();

    return Object.keys(PERP_MARKETS).map(market => {
      const m = data.markets?.[market] || {};
      return {
        market: market as PerpMarket,
        markPrice: m.markPrice || 0,
        indexPrice: m.indexPrice || 0,
        fundingRate: m.fundingRate || 0,
        openInterest: m.openInterest || 0,
        volume24h: m.volume24h || 0,
        priceChange24h: m.priceChange24h || 0,
        priceChange24hPct: m.priceChange24hPct || 0,
      };
    });
  } catch (err) {
    console.error('Failed to fetch perp markets:', err);
    // Return mock data for development
    return Object.keys(PERP_MARKETS).map(market => ({
      market: market as PerpMarket,
      markPrice: market === 'SOL-PERP' ? 180 : market === 'ETH-PERP' ? 3200 : 95000,
      indexPrice: market === 'SOL-PERP' ? 180 : market === 'ETH-PERP' ? 3200 : 95000,
      fundingRate: 0.0001,
      openInterest: 1000000,
      volume24h: 5000000,
      priceChange24h: market === 'SOL-PERP' ? -5 : market === 'ETH-PERP' ? -80 : -2000,
      priceChange24hPct: -2.5,
    }));
  }
}

/**
 * Fetch current positions for a wallet
 */
export async function fetchPerpPositions(walletAddress: string): Promise<PerpPosition[]> {
  try {
    const res = await fetch(`${JUP_PERPS_API}/v1/positions/${walletAddress}`, {
      headers: { 'Content-Type': 'application/json' },
    });

    if (!res.ok) {
      if (res.status === 404) return []; // No positions
      throw new Error(`Failed to fetch positions: ${res.status}`);
    }

    const data = await res.json();

    return (data.positions || []).map((p: any) => ({
      market: p.market as PerpMarket,
      side: p.side,
      size: p.size,
      collateral: p.collateral,
      entryPrice: p.entryPrice,
      markPrice: p.markPrice,
      liquidationPrice: p.liquidationPrice,
      leverage: p.leverage,
      unrealizedPnl: p.unrealizedPnl,
      unrealizedPnlPct: p.unrealizedPnlPct,
      timestamp: p.timestamp || Date.now(),
    }));
  } catch (err) {
    console.error('Failed to fetch perp positions:', err);
    return [];
  }
}

// ─── Order Building ──────────────────────────────────────────────────────────

/**
 * Build a transaction to open a perp position
 *
 * NOTE: Jupiter Perps doesn't have a public REST API for order building.
 * In production, this would use @jup-ag/perp-sdk or direct program interaction.
 * For hackathon demo, we simulate successful order placement.
 */
export async function buildOpenPositionTx(
  connection: Connection,
  walletAddress: string,
  params: PerpOrderParams,
): Promise<PerpOrderResult> {
  try {
    // Validate params
    if (params.leverage < 1 || params.leverage > 100) {
      return { success: false, error: 'Leverage must be between 1x and 100x' };
    }
    if (params.collateralUsd < 1) {
      return { success: false, error: 'Minimum collateral is $1' };
    }

    // Get current market price for estimation
    const markets = await fetchPerpMarkets();
    const market = markets.find(m => m.market === params.market);
    const entryPrice = market?.markPrice || 180; // Default SOL price

    // Calculate estimated liquidation
    const liquidationPrice = calculateLiquidationPrice(entryPrice, params.leverage, params.side);

    // DEMO MODE: Return simulated success without actual transaction
    // In production, this would build a real transaction using Jupiter Perps SDK
    console.log(`[DEMO] Opening ${params.side} ${params.market} position: $${params.collateralUsd} @ ${params.leverage}x`);

    return {
      success: true,
      transaction: undefined, // No actual tx in demo mode
      estimatedEntry: entryPrice,
      estimatedLiquidation: liquidationPrice,
      estimatedFees: params.collateralUsd * 0.001, // 0.1% fee estimate
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to build open position tx',
    };
  }
}

/**
 * Build a transaction to close a perp position
 *
 * NOTE: Jupiter Perps doesn't have a public REST API for order building.
 * For hackathon demo, we simulate successful close.
 */
export async function buildClosePositionTx(
  connection: Connection,
  walletAddress: string,
  params: PerpCloseParams,
): Promise<PerpOrderResult> {
  try {
    // DEMO MODE: Return simulated success without actual transaction
    console.log(`[DEMO] Closing ${params.percentToClose}% of ${params.market} position`);

    return {
      success: true,
      transaction: undefined, // No actual tx in demo mode
      estimatedFees: 0.001, // Small fee estimate
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Failed to build close position tx',
    };
  }
}

// ─── Risk Calculations ───────────────────────────────────────────────────────

/**
 * Calculate liquidation price for a position
 */
export function calculateLiquidationPrice(
  entryPrice: number,
  leverage: number,
  side: 'long' | 'short',
  maintenanceMarginPct: number = 0.5, // 0.5% maintenance margin
): number {
  const maintenanceRatio = maintenanceMarginPct / 100;
  const leverageMultiplier = 1 / leverage;

  if (side === 'long') {
    // Long: liquidated when price drops
    return entryPrice * (1 - leverageMultiplier + maintenanceRatio);
  } else {
    // Short: liquidated when price rises
    return entryPrice * (1 + leverageMultiplier - maintenanceRatio);
  }
}

/**
 * Calculate unrealized PnL
 */
export function calculateUnrealizedPnl(
  entryPrice: number,
  currentPrice: number,
  size: number,
  side: 'long' | 'short',
): { pnl: number; pnlPct: number } {
  const priceChange = currentPrice - entryPrice;
  const pnl = side === 'long' ? priceChange * size : -priceChange * size;
  const pnlPct = (pnl / (entryPrice * size)) * 100;

  return { pnl, pnlPct };
}

// ─── Position Sizing ─────────────────────────────────────────────────────────

/**
 * Calculate optimal position size based on risk parameters
 */
export function calculatePositionSize(
  portfolioValueUsd: number,
  riskPerTradePct: number, // e.g., 2% = risk 2% of portfolio per trade
  stopLossPct: number, // e.g., 5% = stop loss at 5% from entry
  leverage: number,
): number {
  // Position size = (Portfolio * Risk%) / (Stop Loss% / Leverage)
  const effectiveStopLoss = stopLossPct / leverage;
  const positionSize = (portfolioValueUsd * (riskPerTradePct / 100)) / (effectiveStopLoss / 100);

  // Cap at 50% of portfolio
  return Math.min(positionSize, portfolioValueUsd * 0.5);
}

// ─── Utility ─────────────────────────────────────────────────────────────────

export function formatPerpPosition(position: PerpPosition): string {
  const pnlSign = position.unrealizedPnl >= 0 ? '+' : '';
  return `${position.side.toUpperCase()} ${position.market} ${position.leverage}x | Entry: $${position.entryPrice.toFixed(2)} | Mark: $${position.markPrice.toFixed(2)} | PnL: ${pnlSign}$${position.unrealizedPnl.toFixed(2)} (${pnlSign}${position.unrealizedPnlPct.toFixed(2)}%) | Liq: $${position.liquidationPrice.toFixed(2)}`;
}

export function formatPerpMarket(market: PerpMarketData): string {
  const changeSign = market.priceChange24hPct >= 0 ? '+' : '';
  return `${market.market}: $${market.markPrice.toFixed(2)} (${changeSign}${market.priceChange24hPct.toFixed(2)}%) | Funding: ${(market.fundingRate * 100).toFixed(4)}%/h`;
}

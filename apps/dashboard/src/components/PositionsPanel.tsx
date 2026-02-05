'use client';

import { useEffect, useState, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PositionChart, NoPositionsChart } from './PositionChart';
import { calculateLiquidationPrice } from '@/lib/jupiter-perps';
import type { SimulatedPerpPosition } from '@/lib/simulated-perps';

interface MarketTicker {
  market: string;
  price: number;
  change24h: number;
  changePct24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

// Global cache for positions (persists across tab switches)
let cachedPositions: SimulatedPerpPosition[] = [];
let lastFetchTime = 0;

// Simulated market data (would be WebSocket in production)
function useMarketTickers(): MarketTicker[] {
  const [tickers, setTickers] = useState<MarketTicker[]>([
    { market: 'SOL-PERP', price: 178.50, change24h: -3.20, changePct24h: -1.76, high24h: 185.00, low24h: 175.00, volume24h: 125000000 },
    { market: 'ETH-PERP', price: 3150.00, change24h: -45.00, changePct24h: -1.41, high24h: 3250.00, low24h: 3100.00, volume24h: 85000000 },
    { market: 'BTC-PERP', price: 97500.00, change24h: -1200.00, changePct24h: -1.22, high24h: 99500.00, low24h: 96000.00, volume24h: 250000000 },
  ]);

  useEffect(() => {
    // Simulate price movements every 2 seconds
    const interval = setInterval(() => {
      setTickers(prev => prev.map(t => {
        const volatility = t.market === 'BTC-PERP' ? 0.002 : t.market === 'ETH-PERP' ? 0.003 : 0.004;
        const change = t.price * (Math.random() - 0.5) * volatility;
        const newPrice = t.price + change;
        return {
          ...t,
          price: newPrice,
          change24h: t.change24h + change,
          changePct24h: ((newPrice - (t.price - t.change24h)) / (t.price - t.change24h)) * 100,
        };
      }));
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  return tickers;
}

interface PositionsPanelProps {
  className?: string;
}

export function PositionsPanel({ className = '' }: PositionsPanelProps) {
  const { publicKey } = useWallet();
  // Initialize with cached positions to prevent flash of "No Open Positions"
  const [positions, setPositions] = useState<SimulatedPerpPosition[]>(cachedPositions);
  const [isLoading, setIsLoading] = useState(cachedPositions.length === 0);
  const tickers = useMarketTickers();
  const tickersRef = useRef(tickers);
  tickersRef.current = tickers;

  // Fetch positions from API every second
  useEffect(() => {
    if (!publicKey) return;

    const fetchPositions = async () => {
      try {
        const res = await fetch(`/api/agent/positions?wallet=${publicKey.toBase58()}`);
        if (!res.ok) return;
        const data = await res.json();

        // Get perp positions from API response
        const perpPositions: SimulatedPerpPosition[] = data.perpPositions || [];

        // Update current prices from tickers
        const currentTickers = tickersRef.current;
        const updated = perpPositions.map(p => {
          const ticker = currentTickers.find(t => t.market === p.market);
          if (ticker) {
            const currentPrice = ticker.price;
            const priceChange = currentPrice - p.entryPrice;
            const pnlMultiplier = p.side === 'long' ? 1 : -1;
            const pnlPct = (priceChange / p.entryPrice) * p.leverage * pnlMultiplier * 100;
            const unrealizedPnl = p.collateralUsd * (pnlPct / 100);
            return { ...p, currentPrice, unrealizedPnl, unrealizedPnlPct: pnlPct };
          }
          return p;
        });

        // Update cache and state
        cachedPositions = updated;
        lastFetchTime = Date.now();
        setPositions(updated);
        setIsLoading(false);
      } catch (e) {
        console.error('[PositionsPanel] Fetch error:', e);
        setIsLoading(false);
      }
    };

    // Fetch immediately
    fetchPositions();
    // Fetch every 3 seconds instead of 1 to reduce API load
    const interval = setInterval(fetchPositions, 3000);
    return () => clearInterval(interval);
  }, [publicKey]);

  // Update prices from tickers even between API fetches
  useEffect(() => {
    if (positions.length === 0) return;

    const updated = positions.map(p => {
      const ticker = tickers.find(t => t.market === p.market);
      if (ticker) {
        const currentPrice = ticker.price;
        const priceChange = currentPrice - p.entryPrice;
        const pnlMultiplier = p.side === 'long' ? 1 : -1;
        const pnlPct = (priceChange / p.entryPrice) * p.leverage * pnlMultiplier * 100;
        const unrealizedPnl = p.collateralUsd * (pnlPct / 100);
        return { ...p, currentPrice, unrealizedPnl, unrealizedPnlPct: pnlPct };
      }
      return p;
    });

    setPositions(updated);
    cachedPositions = updated;
  }, [tickers]);

  // Calculate stop loss and take profit for each position
  const getStopLoss = (p: SimulatedPerpPosition) => {
    // 8% stop loss
    const stopPct = 0.08 / p.leverage;
    return p.side === 'long'
      ? p.entryPrice * (1 - stopPct)
      : p.entryPrice * (1 + stopPct);
  };

  const getTakeProfit = (p: SimulatedPerpPosition) => {
    // 15% take profit
    const tpPct = 0.15 / p.leverage;
    return p.side === 'long'
      ? p.entryPrice * (1 + tpPct)
      : p.entryPrice * (1 - tpPct);
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Market Tickers - Compact horizontal strip */}
      <div className="bg-bg-abyss/80 border-b border-cursed/10">
        <div className="flex items-stretch divide-x divide-cursed/10">
          {tickers.map(t => {
            const isUp = t.changePct24h >= 0;
            return (
              <div key={t.market} className="flex-1 px-3 py-2 hover:bg-cursed/5 transition-colors">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-text-muted">{t.market.replace('-PERP', '')}</span>
                    <span className="font-mono text-sm text-text-primary font-medium">
                      ${t.market === 'BTC-PERP' ? t.price.toLocaleString(undefined, {maximumFractionDigits: 0}) : t.price.toFixed(2)}
                    </span>
                  </div>
                  <div className={`flex items-center gap-1 text-xs font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                    <svg className={`w-3 h-3 ${isUp ? '' : 'rotate-180'}`} fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M5.293 9.707a1 1 0 010-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 01-1.414 1.414L11 7.414V15a1 1 0 11-2 0V7.414L6.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                    {Math.abs(t.changePct24h).toFixed(2)}%
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[9px] text-text-muted/60 font-mono">
                  <span>H {t.market === 'BTC-PERP' ? t.high24h.toLocaleString(undefined, {maximumFractionDigits: 0}) : t.high24h.toFixed(0)}</span>
                  <span className="text-cursed/30">|</span>
                  <span>L {t.market === 'BTC-PERP' ? t.low24h.toLocaleString(undefined, {maximumFractionDigits: 0}) : t.low24h.toFixed(0)}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Position Charts */}
      {isLoading ? (
        <div className="bg-bg-abyss/40 border border-cursed/10 rounded p-8 text-center">
          <div className="w-6 h-6 mx-auto mb-3 border-2 border-cursed/20 border-t-text-primary rounded-full animate-spin" />
          <div className="text-text-muted/60 text-[10px] font-mono uppercase tracking-wider">Loading Positions...</div>
        </div>
      ) : positions.length === 0 ? (
        <NoPositionsChart />
      ) : (
        positions.map(p => (
          <PositionChart
            key={p.id}
            market={p.market}
            side={p.side}
            entryPrice={p.entryPrice}
            currentPrice={p.currentPrice || p.entryPrice}
            leverage={p.leverage}
            collateralUsd={p.collateralUsd}
            stopLossPrice={getStopLoss(p)}
            takeProfitPrice={getTakeProfit(p)}
            liquidationPrice={calculateLiquidationPrice(p.entryPrice, p.leverage, p.side)}
            unrealizedPnl={p.unrealizedPnl}
            unrealizedPnlPct={p.unrealizedPnlPct}
          />
        ))
      )}

      {/* Position Summary - Compact bar */}
      {positions.length > 0 && (
        <div className="bg-bg-abyss/60 border-t border-cursed/10 px-4 py-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-text-muted/60 uppercase text-[9px]">Collateral</span>
                <span className="text-text-primary">${positions.reduce((sum, p) => sum + p.collateralUsd, 0).toFixed(2)}</span>
              </div>
              <div className="text-cursed/20">|</div>
              <div className="flex items-center gap-1.5">
                <span className="text-text-muted/60 uppercase text-[9px]">Exposure</span>
                <span className="text-text-primary">${positions.reduce((sum, p) => sum + p.collateralUsd * p.leverage, 0).toFixed(2)}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-text-muted/60 uppercase text-[9px]">P&L</span>
              <span className={`font-medium ${
                positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0) >= 0
                  ? 'text-green-400'
                  : 'text-red-400'
              }`}>
                {positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0) >= 0 ? '+' : ''}
                ${positions.reduce((sum, p) => sum + (p.unrealizedPnl || 0), 0).toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

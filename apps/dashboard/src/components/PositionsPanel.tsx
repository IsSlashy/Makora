'use client';

import { useEffect, useState, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PositionChart } from './PositionChart';
import { useMarketTickers } from './MarketTickerBar';
import { calculateLiquidationPrice } from '@/lib/jupiter-perps';
import type { SimulatedPerpPosition } from '@/lib/simulated-perps';

// Global cache for positions (persists across tab switches)
let cachedPositions: SimulatedPerpPosition[] = [];

interface PositionsPanelProps {
  className?: string;
}

export function PositionsPanel({ className = '' }: PositionsPanelProps) {
  const { publicKey } = useWallet();
  const [positions, setPositions] = useState<SimulatedPerpPosition[]>(cachedPositions);
  const [isLoading, setIsLoading] = useState(cachedPositions.length === 0);
  const [closingMarket, setClosingMarket] = useState<string | null>(null);

  const handleClosePosition = async (market: string) => {
    if (!publicKey || closingMarket) return;
    setClosingMarket(market);
    try {
      const res = await fetch('/api/agent/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          allocation: [{
            protocol: 'Jupiter Perps',
            symbol: market,
            pct: 100,
            expectedApy: 0,
            strategyTag: 'perp-close',
            risk: 'Low',
          }],
          walletPublicKey: publicKey.toBase58(),
          riskLimits: { maxPositionSizePct: 100, maxSlippageBps: 100, maxDailyLossPct: 10, minSolReserve: 0.01, maxProtocolExposurePct: 100 },
          confidence: 100,
          portfolioValueSol: 1,
          signingMode: 'agent',
        }),
      });
      const data = await res.json();
      const r = data.results?.[0];
      if (r?.success) {
        setPositions(prev => prev.filter(p => p.market !== market));
        cachedPositions = cachedPositions.filter(p => p.market !== market);
      }
    } catch (e) {
      console.error('[PositionsPanel] Close error:', e);
    } finally {
      setClosingMarket(null);
    }
  };

  const tickers = useMarketTickers();
  const tickersRef = useRef(tickers);
  tickersRef.current = tickers;

  useEffect(() => {
    if (!publicKey) return;

    const fetchPositions = async () => {
      try {
        const res = await fetch(`/api/agent/positions?wallet=${publicKey.toBase58()}`);
        if (!res.ok) return;
        const data = await res.json();
        const perpPositions: SimulatedPerpPosition[] = data.perpPositions || [];

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

        cachedPositions = updated;
        setPositions(updated);
        setIsLoading(false);
      } catch (e) {
        console.error('[PositionsPanel] Fetch error:', e);
        setIsLoading(false);
      }
    };

    fetchPositions();
    const interval = setInterval(fetchPositions, 3000);
    return () => clearInterval(interval);
  }, [publicKey]);

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

  const getStopLoss = (p: SimulatedPerpPosition) => {
    const stopPct = 0.08 / p.leverage;
    return p.side === 'long'
      ? p.entryPrice * (1 - stopPct)
      : p.entryPrice * (1 + stopPct);
  };

  const getTakeProfit = (p: SimulatedPerpPosition) => {
    const tpPct = 0.15 / p.leverage;
    return p.side === 'long'
      ? p.entryPrice * (1 + tpPct)
      : p.entryPrice * (1 - tpPct);
  };

  return (
    <div className={`cursed-card p-4 h-full flex flex-col ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="section-title">Positions</div>
        <span className="text-[10px] font-mono text-text-muted tracking-wider">
          {positions.length} OPEN
        </span>
      </div>

      <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <div className="w-5 h-5 border-2 border-cursed/20 border-t-text-primary rounded-full animate-spin" />
          </div>
        ) : positions.length === 0 ? (
          <div className="flex items-center justify-center py-6">
            <div className="text-[10px] text-text-muted font-mono tracking-wider text-center">
              No open positions
            </div>
          </div>
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
              onClose={handleClosePosition}
              isClosing={closingMarket === p.market}
            />
          ))
        )}
      </div>

      {positions.length > 0 && (
        <div className="border-t border-cursed/10 pt-2 mt-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-text-muted uppercase">Col</span>
                <span className="text-text-primary">${positions.reduce((sum, p) => sum + p.collateralUsd, 0).toFixed(2)}</span>
              </div>
              <div className="text-cursed/20">|</div>
              <div className="flex items-center gap-1">
                <span className="text-[9px] text-text-muted uppercase">Exp</span>
                <span className="text-text-primary">${positions.reduce((sum, p) => sum + p.collateralUsd * p.leverage, 0).toFixed(2)}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-text-muted uppercase">P&L</span>
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

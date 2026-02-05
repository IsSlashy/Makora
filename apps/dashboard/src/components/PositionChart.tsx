'use client';

import { useMemo, useState, useEffect, useRef } from 'react';

interface PositionChartProps {
  market: string;
  side: 'long' | 'short';
  entryPrice: number;
  currentPrice: number;
  leverage: number;
  collateralUsd: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  liquidationPrice?: number;
  unrealizedPnl?: number;
  unrealizedPnlPct?: number;
}

// Generate smooth price curve points
function generatePricePath(
  entryPrice: number,
  currentPrice: number,
  pointCount: number = 50
): number[] {
  const points: number[] = [];
  const priceDiff = currentPrice - entryPrice;

  // Create a smooth curve from entry to current price with realistic volatility
  for (let i = 0; i < pointCount; i++) {
    const progress = i / (pointCount - 1);
    // Base trend from entry to current
    const trendPrice = entryPrice + priceDiff * progress;
    // Add volatility that decreases near the end (more recent = more accurate)
    const volatility = Math.abs(priceDiff) * 0.15 * (1 - progress * 0.5);
    const noise = Math.sin(i * 0.8) * volatility * 0.5 +
                  Math.sin(i * 2.1) * volatility * 0.3 +
                  Math.sin(i * 0.3) * volatility * 0.2;
    points.push(trendPrice + noise);
  }

  // Ensure last point is exactly current price
  points[points.length - 1] = currentPrice;
  return points;
}

export function PositionChart({
  market,
  side,
  entryPrice,
  currentPrice,
  leverage,
  collateralUsd,
  stopLossPrice,
  takeProfitPrice,
  liquidationPrice,
  unrealizedPnl = 0,
  unrealizedPnlPct = 0,
}: PositionChartProps) {
  // Track price history for smooth animation
  const [priceHistory, setPriceHistory] = useState<number[]>([]);
  const historyRef = useRef<number[]>([]);

  // Update price history when current price changes
  useEffect(() => {
    historyRef.current = [...historyRef.current, currentPrice].slice(-60); // Keep last 60 points
    setPriceHistory([...historyRef.current]);
  }, [currentPrice]);

  // Generate smooth path if not enough history
  const displayPrices = useMemo(() => {
    if (priceHistory.length >= 10) {
      return priceHistory;
    }
    return generatePricePath(entryPrice, currentPrice, 50);
  }, [priceHistory, entryPrice, currentPrice]);

  const priceRange = useMemo(() => {
    const allPrices = [...displayPrices, entryPrice];
    if (stopLossPrice) allPrices.push(stopLossPrice);
    if (takeProfitPrice) allPrices.push(takeProfitPrice);
    if (liquidationPrice) allPrices.push(liquidationPrice);

    const min = Math.min(...allPrices) * 0.995;
    const max = Math.max(...allPrices) * 1.005;
    return { min, max, range: max - min };
  }, [displayPrices, entryPrice, stopLossPrice, takeProfitPrice, liquidationPrice]);

  const priceToY = (price: number) => {
    return 100 - ((price - priceRange.min) / priceRange.range) * 100;
  };

  const entryY = priceToY(entryPrice);
  const currentY = priceToY(currentPrice);
  const stopLossY = stopLossPrice ? priceToY(stopLossPrice) : null;
  const takeProfitY = takeProfitPrice ? priceToY(takeProfitPrice) : null;
  const liquidationY = liquidationPrice ? priceToY(liquidationPrice) : null;

  const isProfitable = unrealizedPnl >= 0;

  // Generate SVG path for price line
  const pricePath = useMemo(() => {
    if (displayPrices.length < 2) return '';

    const points = displayPrices.map((price, i) => {
      const x = (i / (displayPrices.length - 1)) * 100;
      const y = priceToY(price);
      return `${x},${y}`;
    });

    return `M ${points.join(' L ')}`;
  }, [displayPrices, priceToY]);

  // Generate gradient fill path (from price line to bottom or entry)
  const fillPath = useMemo(() => {
    if (displayPrices.length < 2) return '';

    const points = displayPrices.map((price, i) => {
      const x = (i / (displayPrices.length - 1)) * 100;
      const y = priceToY(price);
      return `${x},${y}`;
    });

    const lastX = 100;
    const firstX = 0;
    const baseY = entryY;

    return `M ${points.join(' L ')} L ${lastX},${baseY} L ${firstX},${baseY} Z`;
  }, [displayPrices, priceToY, entryY]);

  return (
    <div className="bg-bg-abyss/40 border border-cursed/10 rounded">
      {/* Compact Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-cursed/10">
        <div className="flex items-center gap-2">
          <span className={`w-1.5 h-1.5 rounded-full ${side === 'long' ? 'bg-green-400' : 'bg-red-400'}`} />
          <span className="font-mono text-sm text-text-primary">{market}</span>
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
            side === 'long' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}>
            {side.toUpperCase()} {leverage}x
          </span>
        </div>
        <div className={`font-mono text-sm font-medium ${isProfitable ? 'text-green-400' : 'text-red-400'}`}>
          {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPnl.toFixed(2)} ({unrealizedPnlPct >= 0 ? '+' : ''}{unrealizedPnlPct.toFixed(1)}%)
        </div>
      </div>

      {/* Chart with SVG price curve */}
      <div className="relative h-44 mx-3 my-2">
        {/* Y-axis labels */}
        <div className="absolute left-0 top-0 bottom-0 w-12 flex flex-col justify-between text-[9px] font-mono text-text-muted/50 pr-1 text-right">
          <span>{priceRange.max.toFixed(2)}</span>
          <span>{((priceRange.max + priceRange.min) / 2).toFixed(2)}</span>
          <span>{priceRange.min.toFixed(2)}</span>
        </div>

        {/* Chart area with SVG */}
        <div className="absolute left-14 right-12 top-0 bottom-0 overflow-hidden">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="w-full h-full"
          >
            {/* Gradient definition */}
            <defs>
              <linearGradient id={`fill-${market}`} x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stopColor={isProfitable ? '#22c55e' : '#ef4444'} stopOpacity="0.25" />
                <stop offset="100%" stopColor={isProfitable ? '#22c55e' : '#ef4444'} stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {/* Grid lines */}
            {[25, 50, 75].map(y => (
              <line key={y} x1="0" y1={y} x2="100" y2={y} stroke="currentColor" strokeOpacity="0.08" strokeWidth="0.3" />
            ))}

            {/* Fill area under price curve */}
            {fillPath && (
              <path d={fillPath} fill={`url(#fill-${market})`} />
            )}

            {/* Entry price line (dashed) */}
            <line
              x1="0" y1={entryY} x2="100" y2={entryY}
              stroke="#60a5fa"
              strokeWidth="0.5"
              strokeDasharray="2,2"
              strokeOpacity="0.7"
            />

            {/* Take Profit line */}
            {takeProfitY !== null && (
              <line
                x1="0" y1={takeProfitY} x2="100" y2={takeProfitY}
                stroke="#22c55e"
                strokeWidth="0.4"
                strokeDasharray="1,1"
                strokeOpacity="0.5"
              />
            )}

            {/* Stop Loss line */}
            {stopLossY !== null && (
              <line
                x1="0" y1={stopLossY} x2="100" y2={stopLossY}
                stroke="#ef4444"
                strokeWidth="0.4"
                strokeDasharray="1,1"
                strokeOpacity="0.5"
              />
            )}

            {/* Liquidation line */}
            {liquidationY !== null && (
              <line
                x1="0" y1={liquidationY} x2="100" y2={liquidationY}
                stroke="#f97316"
                strokeWidth="0.5"
                strokeOpacity="0.7"
              />
            )}

            {/* Price curve */}
            {pricePath && (
              <path
                d={pricePath}
                fill="none"
                stroke={isProfitable ? '#22c55e' : '#ef4444'}
                strokeWidth="1"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Current price dot (pulsing) */}
            <circle
              cx="100"
              cy={currentY}
              r="2"
              fill={isProfitable ? '#22c55e' : '#ef4444'}
            >
              <animate attributeName="r" values="2;3;2" dur="1s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="1;0.6;1" dur="1s" repeatCount="indefinite" />
            </circle>
          </svg>
        </div>

        {/* Right side labels */}
        <div className="absolute right-0 top-0 bottom-0 w-12 text-[9px] font-mono">
          {/* Entry label */}
          <div
            className="absolute right-0 -translate-y-1/2 bg-blue-500/20 text-blue-400 px-1 rounded whitespace-nowrap"
            style={{ top: `${entryY}%` }}
          >
            Entry
          </div>

          {/* Current price */}
          <div
            className={`absolute right-0 -translate-y-1/2 px-1 rounded font-medium whitespace-nowrap ${
              isProfitable ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }`}
            style={{ top: `${currentY}%` }}
          >
            {currentPrice.toFixed(2)}
          </div>

          {/* TP label */}
          {takeProfitY !== null && (
            <div
              className="absolute right-0 -translate-y-1/2 text-green-400/60 whitespace-nowrap"
              style={{ top: `${takeProfitY}%` }}
            >
              TP
            </div>
          )}

          {/* SL label */}
          {stopLossY !== null && (
            <div
              className="absolute right-0 -translate-y-1/2 text-red-400/60 whitespace-nowrap"
              style={{ top: `${stopLossY}%` }}
            >
              SL
            </div>
          )}

          {/* Liq label */}
          {liquidationY !== null && (
            <div
              className="absolute right-0 -translate-y-1/2 text-orange-500 whitespace-nowrap"
              style={{ top: `${liquidationY}%` }}
            >
              LIQ
            </div>
          )}
        </div>
      </div>

      {/* Stats footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-cursed/10 text-[10px] font-mono text-text-muted">
        <div className="flex items-center gap-3">
          <span>Size <span className="text-text-primary">${(collateralUsd * leverage).toFixed(0)}</span></span>
          <span>Margin <span className="text-text-primary">${collateralUsd.toFixed(0)}</span></span>
        </div>
        {liquidationPrice && (
          <span>Liq <span className="text-orange-400">${liquidationPrice.toFixed(2)}</span></span>
        )}
      </div>
    </div>
  );
}

// Empty state when no positions
export function NoPositionsChart() {
  return (
    <div className="bg-bg-abyss/40 border border-cursed/10 rounded p-8 text-center">
      <div className="w-10 h-10 mx-auto mb-3 rounded bg-cursed/5 flex items-center justify-center">
        <svg className="w-5 h-5 text-cursed/30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
        </svg>
      </div>
      <div className="text-text-muted/60 text-[10px] font-mono uppercase tracking-wider">No Open Positions</div>
    </div>
  );
}

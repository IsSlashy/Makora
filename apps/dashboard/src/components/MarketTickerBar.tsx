'use client';

import { useEffect, useState } from 'react';

interface MarketTicker {
  market: string;
  price: number;
  change24h: number;
  changePct24h: number;
  high24h: number;
  low24h: number;
  volume24h: number;
}

export function useMarketTickers(): MarketTicker[] {
  const [tickers, setTickers] = useState<MarketTicker[]>([
    { market: 'SOL-PERP', price: 77.00, change24h: -8.50, changePct24h: -9.94, high24h: 93.00, low24h: 71.00, volume24h: 125000000 },
    { market: 'ETH-PERP', price: 2130.00, change24h: -290.00, changePct24h: -11.98, high24h: 2600.00, low24h: 2050.00, volume24h: 85000000 },
    { market: 'BTC-PERP', price: 64000.00, change24h: -6500.00, changePct24h: -9.22, high24h: 72000.00, low24h: 60000.00, volume24h: 250000000 },
  ]);

  useEffect(() => {
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

export function MarketTickerBar() {
  const tickers = useMarketTickers();

  return (
    <div className="bg-bg-abyss/80 border border-cursed/10 rounded-sm">
      <div className="flex items-stretch divide-x divide-cursed/10">
        {tickers.map(t => {
          const isUp = t.changePct24h >= 0;
          return (
            <div key={t.market} className="flex-1 px-4 py-1.5 hover:bg-cursed/5 transition-colors">
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
            </div>
          );
        })}
      </div>
    </div>
  );
}

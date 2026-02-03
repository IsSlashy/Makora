'use client';

import { useEffect, useState } from 'react';

interface TokenBalance {
  symbol: string;
  amount: number;
  value: number;
  percentage: number;
}

export const PortfolioCard = () => {
  const [totalValue, setTotalValue] = useState(12450.50);

  const tokens: TokenBalance[] = [
    { symbol: 'SOL', amount: 45.2, value: 5602.50, percentage: 45 },
    { symbol: 'mSOL', amount: 22.1, value: 3112.50, percentage: 25 },
    { symbol: 'USDC', amount: 3112.50, value: 3112.50, percentage: 25 },
    { symbol: 'SHIELDED', amount: 0, value: 622.50, percentage: 5 },
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setTotalValue(prev => prev + (Math.random() - 0.48) * 8);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="cursed-card p-5 animate-fade-up">
      <div className="section-title mb-5">Portfolio</div>

      <div className="mb-6">
        <div className="text-3xl font-bold text-text-primary font-mono">
          ${totalValue.toFixed(2)}
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-positive text-xs font-mono">+2.43%</span>
          <span className="text-text-muted text-[10px]">24h</span>
        </div>
      </div>

      <div className="space-y-3">
        {tokens.map((token) => (
          <div key={token.symbol}>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-text-primary">{token.symbol}</span>
                {token.symbol !== 'USDC' && token.symbol !== 'SHIELDED' && (
                  <span className="text-[10px] text-text-muted font-mono">
                    {token.amount.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="text-right">
                <span className="text-xs font-mono text-text-primary">${token.value.toFixed(0)}</span>
                <span className="text-[10px] text-text-muted ml-2">{token.percentage}%</span>
              </div>
            </div>

            <div className="relative h-[3px] bg-bg-inner">
              <div
                className="absolute left-0 top-0 h-full transition-all duration-500"
                style={{
                  width: `${token.percentage}%`,
                  background: token.symbol === 'SHIELDED'
                    ? 'linear-gradient(90deg, #6d28d9, #8b5cf6)'
                    : `linear-gradient(90deg, #a68520, #d4a829)`,
                  boxShadow: token.symbol === 'SHIELDED'
                    ? '0 0 8px rgba(109, 40, 217, 0.4)'
                    : '0 0 8px rgba(212, 168, 41, 0.3)',
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="ink-divider mt-5 mb-3" />
      <div className="flex items-center justify-between text-[10px] font-mono">
        <span className="text-text-muted tracking-wider uppercase">24h P&L</span>
        <span className="text-positive">+$295.40</span>
      </div>
    </div>
  );
};

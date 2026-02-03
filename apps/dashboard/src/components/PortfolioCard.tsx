'use client';

import { useEffect, useState } from 'react';

interface TokenBalance {
  symbol: string;
  amount: number;
  value: number;
  percentage: number;
  color: string;
}

export const PortfolioCard = () => {
  const [totalValue, setTotalValue] = useState(12450.50);

  const tokens: TokenBalance[] = [
    { symbol: 'SOL', amount: 45.2, value: 5602.50, percentage: 45, color: '#10b981' },
    { symbol: 'mSOL', amount: 22.1, value: 3112.50, percentage: 25, color: '#3b82f6' },
    { symbol: 'USDC', amount: 3112.50, value: 3112.50, percentage: 25, color: '#94a3b8' },
    { symbol: 'Shielded', amount: 0, value: 622.50, percentage: 5, color: '#8b5cf6' },
  ];

  useEffect(() => {
    // Simulate small portfolio value changes
    const interval = setInterval(() => {
      setTotalValue(prev => prev + (Math.random() - 0.5) * 10);
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="glass-card p-6 animate-fade-in">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-text-primary">Portfolio Value</h2>
        <div className="flex items-center gap-2 text-green-500 text-sm">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
          </svg>
          <span>+2.4%</span>
        </div>
      </div>

      <div className="mb-8">
        <div className="text-4xl font-bold text-text-primary mb-1">
          ${totalValue.toFixed(2)}
        </div>
        <div className="text-sm text-text-secondary">
          Last updated: {new Date().toLocaleTimeString()}
        </div>
      </div>

      <div className="space-y-4">
        {tokens.map((token) => (
          <div key={token.symbol} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: token.color }}
                />
                <span className="font-medium text-text-primary">{token.symbol}</span>
                {token.symbol !== 'USDC' && token.symbol !== 'Shielded' && (
                  <span className="text-text-secondary">
                    {token.amount.toFixed(2)}
                  </span>
                )}
              </div>
              <div className="text-right">
                <div className="text-text-primary font-medium">
                  ${token.value.toFixed(2)}
                </div>
                <div className="text-text-secondary text-xs">
                  {token.percentage}%
                </div>
              </div>
            </div>

            <div className="relative h-2 bg-bg-secondary rounded-full overflow-hidden">
              <div
                className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
                style={{
                  width: `${token.percentage}%`,
                  backgroundColor: token.color,
                  boxShadow: `0 0 10px ${token.color}`,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 pt-6 border-t border-accent/20">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">24h Change</span>
          <span className="text-green-500 font-medium">+$295.40 (+2.43%)</span>
        </div>
      </div>
    </div>
  );
};

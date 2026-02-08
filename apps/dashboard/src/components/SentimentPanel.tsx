'use client';

import type { MarketIntelligence } from '@/hooks/usePolymarket';

interface SentimentPanelProps {
  intelligence: MarketIntelligence;
  loading: boolean;
  error: string | null;
}

const BIAS_COLORS = {
  bullish: 'text-positive',
  neutral: 'text-caution',
  bearish: 'text-negative',
};

const BIAS_DOT = {
  bullish: 'bg-positive',
  neutral: 'bg-caution',
  bearish: 'bg-negative',
};

function formatVolume(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

export const SentimentPanel = ({ intelligence, loading, error }: SentimentPanelProps) => {
  const { cryptoMarkets, sentimentSummary } = intelligence;
  const bias = sentimentSummary.overallBias as 'bullish' | 'neutral' | 'bearish';

  return (
    <div className="cursed-card p-4 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <div className="section-title">Sentiment</div>
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${loading ? 'animate-pulse bg-caution' : BIAS_DOT[bias]}`} />
          <span className={`text-[10px] font-mono tracking-wider uppercase ${BIAS_COLORS[bias]}`}>
            {loading ? 'Loading' : bias}
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-2 text-[9px] font-mono text-caution">{error}</div>
      )}

      {/* Key metrics row */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="text-center p-2 bg-bg-inner border border-cursed/8">
          <div className="text-[8px] text-text-muted font-mono uppercase tracking-wider">Direction</div>
          <div className={`text-sm font-mono font-bold capitalize ${BIAS_COLORS[bias]}`}>
            {bias}
          </div>
        </div>
        <div className="text-center p-2 bg-bg-inner border border-cursed/8">
          <div className="text-[8px] text-text-muted font-mono uppercase tracking-wider">Conviction</div>
          <div className="text-sm font-mono font-bold text-cursed">
            {sentimentSummary.highConvictionCount}
          </div>
        </div>
        <div className="text-center p-2 bg-bg-inner border border-cursed/8">
          <div className="text-[8px] text-text-muted font-mono uppercase tracking-wider">Avg Prob</div>
          <div className="text-sm font-mono font-bold text-text-primary">
            {(sentimentSummary.averageProbability * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {/* Top markets */}
      <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
        {cryptoMarkets.slice(0, 5).map((market, idx) => {
          const changeColor = market.priceChange24h > 0 ? 'text-positive' : market.priceChange24h < 0 ? 'text-negative' : 'text-text-muted';
          return (
            <div key={idx} className="p-2 bg-bg-inner border border-transparent hover:border-cursed/10 transition-colors">
              <div className="text-[9px] font-mono text-text-secondary leading-snug mb-1 line-clamp-1">
                {market.question}
              </div>
              <div className="flex items-center justify-between text-[9px] font-mono">
                <div className="flex items-center gap-2">
                  <span className="text-text-primary font-bold">{(market.probability * 100).toFixed(0)}%</span>
                  <div className="w-12 h-1 bg-bg-void overflow-hidden">
                    <div className="h-full bg-cursed/40" style={{ width: `${market.probability * 100}%` }} />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={changeColor}>
                    {market.priceChange24h > 0 ? '+' : ''}{(market.priceChange24h * 100).toFixed(1)}%
                  </span>
                  <span className="text-text-muted">{formatVolume(market.volume24h)}</span>
                </div>
              </div>
            </div>
          );
        })}

        {cryptoMarkets.length === 0 && !loading && (
          <div className="flex items-center justify-center py-4">
            <span className="text-[10px] text-text-muted font-mono tracking-wider">No markets</span>
          </div>
        )}
      </div>
    </div>
  );
};

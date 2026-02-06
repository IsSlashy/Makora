'use client';

import type { MarketIntelligence } from '@/hooks/usePolymarket';

interface PolymarketPanelProps {
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

const RELEVANCE_COLORS = {
  high: 'text-cursed',
  medium: 'text-text-secondary',
  low: 'text-text-muted',
};

function formatVolume(v: number): string {
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function formatProbability(p: number): string {
  return `${(p * 100).toFixed(0)}%`;
}

export const PolymarketPanel = ({ intelligence, loading, error }: PolymarketPanelProps) => {
  const { cryptoMarkets, sentimentSummary } = intelligence;
  const bias = sentimentSummary.overallBias as 'bullish' | 'neutral' | 'bearish';

  return (
    <div className="cursed-card p-5 animate-fade-up">
      <div className="flex items-center justify-between mb-4">
        <div className="section-title">Polymarket</div>
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${loading ? 'animate-pulse bg-caution' : BIAS_DOT[bias]}`} />
          <span className={`text-[10px] font-mono tracking-wider uppercase ${BIAS_COLORS[bias]}`}>
            {loading ? 'Loading' : bias}
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-3 text-[11px] md:text-[9px] font-mono text-caution">{error}</div>
      )}

      {/* Sentiment summary */}
      <div className="mb-4 p-2.5 bg-bg-inner border border-cursed/8 flex items-center justify-between">
        <div className="text-[10px] font-mono text-text-muted">
          High Conviction: <span className="text-cursed">{sentimentSummary.highConvictionCount}</span>
        </div>
        <div className="text-[10px] font-mono text-text-muted">
          Avg: <span className="text-text-primary">{formatProbability(sentimentSummary.averageProbability)}</span>
        </div>
      </div>

      {/* Markets list */}
      <div className="space-y-2 max-h-[320px] overflow-y-auto">
        {cryptoMarkets.slice(0, 8).map((market, idx) => {
          const probPct = market.probability * 100;
          const changeColor = market.priceChange24h > 0 ? 'text-positive' : market.priceChange24h < 0 ? 'text-negative' : 'text-text-muted';

          return (
            <div
              key={idx}
              className="p-2.5 bg-bg-inner border border-transparent hover:border-cursed/10 transition-colors"
            >
              <div className="text-[10px] font-mono text-text-secondary leading-snug mb-1.5">
                {market.question}
              </div>
              <div className="flex items-center justify-between text-[11px] md:text-[9px] font-mono">
                <div className="flex items-center gap-3">
                  {/* Probability bar */}
                  <div className="flex items-center gap-1.5">
                    <span className="text-text-primary font-bold">{formatProbability(market.probability)}</span>
                    <span className="text-text-muted">YES</span>
                  </div>
                  <div className="w-20 md:w-16 h-1.5 md:h-1 bg-bg-void overflow-hidden">
                    <div
                      className="h-full bg-cursed/40"
                      style={{ width: `${probPct}%` }}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={changeColor}>
                    {market.priceChange24h > 0 ? '+' : ''}{(market.priceChange24h * 100).toFixed(1)}%
                  </span>
                  <span className="text-text-muted">{formatVolume(market.volume24h)}</span>
                  <span className={RELEVANCE_COLORS[market.relevance as keyof typeof RELEVANCE_COLORS]}>
                    {market.relevance}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {cryptoMarkets.length === 0 && !loading && (
        <div className="text-[10px] text-text-muted font-mono text-center py-4 tracking-wider">
          No prediction markets available
        </div>
      )}
    </div>
  );
};

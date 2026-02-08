'use client';

interface TokenRecommendation {
  token: string;
  action: 'strong_buy' | 'buy' | 'hold' | 'sell' | 'strong_sell';
  confidence: number;
  reasons: string[];
}

interface SentimentReport {
  timestamp: number;
  overallScore: number;
  direction: string;
  confidence: number;
  signals: {
    fearGreed: { value: number; classification: string };
    rsi: Record<string, { value: number; signal: string }>;
    momentum: { trend: string; volatility: string; changePct: number };
    polymarket: { bias: string; conviction: number };
    tvl: { tvl: number; change24hPct: number };
    dexVolume: { volume24h: number; change24hPct: number };
  };
  recommendations: TokenRecommendation[];
}

interface SentimentPanelTWAProps {
  report: SentimentReport | null;
  loading?: boolean;
}

const DIRECTION_COLORS: Record<string, string> = {
  strong_buy: '#22c55e',
  buy: '#4ade80',
  neutral: '#8b5cf6',
  sell: '#f97316',
  strong_sell: '#ef4444',
};

const ACTION_COLORS: Record<string, string> = {
  strong_buy: '#22c55e',
  buy: '#4ade80',
  hold: '#8b5cf6',
  sell: '#f97316',
  strong_sell: '#ef4444',
};

export const SentimentPanelTWA = ({ report, loading }: SentimentPanelTWAProps) => {
  if (loading) {
    return (
      <div className="cursed-card p-4">
        <div className="section-title mb-3">MARKET SENTIMENT</div>
        <div className="text-text-muted text-xs font-mono animate-pulse">Loading sentiment data...</div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="cursed-card p-4">
        <div className="section-title mb-3">MARKET SENTIMENT</div>
        <div className="text-text-muted text-xs font-mono">No sentiment data available</div>
      </div>
    );
  }

  const dirColor = DIRECTION_COLORS[report.direction] || '#8b5cf6';
  const scoreSign = report.overallScore >= 0 ? '+' : '';

  return (
    <div className="cursed-card p-4">
      <div className="section-title mb-3">MARKET SENTIMENT</div>

      {/* Score + Direction */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="text-3xl font-bold font-mono"
            style={{ color: dirColor }}
          >
            {scoreSign}{report.overallScore}
          </div>
          <div>
            <div
              className="text-xs font-mono font-bold tracking-wider uppercase px-2 py-0.5 rounded-sm"
              style={{
                color: dirColor,
                background: `${dirColor}15`,
                border: `1px solid ${dirColor}30`,
              }}
            >
              {report.direction.replace('_', ' ')}
            </div>
            <div className="text-text-muted text-[10px] font-mono mt-1">
              {report.confidence}% confidence
            </div>
          </div>
        </div>
      </div>

      {/* Signal breakdown */}
      <div className="space-y-2 mb-4">
        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-text-muted">Fear & Greed</span>
          <span style={{ color: report.signals.fearGreed.value < 30 ? '#22c55e' : report.signals.fearGreed.value > 70 ? '#ef4444' : '#8b5cf6' }}>
            {report.signals.fearGreed.value} ({report.signals.fearGreed.classification})
          </span>
        </div>

        {Object.entries(report.signals.rsi).map(([token, rsi]) => (
          <div key={token} className="flex items-center justify-between text-xs font-mono">
            <span className="text-text-muted">{token} RSI</span>
            <span style={{ color: rsi.value < 30 ? '#22c55e' : rsi.value > 70 ? '#ef4444' : '#8b5cf6' }}>
              {rsi.value.toFixed(0)} ({rsi.signal})
            </span>
          </div>
        ))}

        <div className="flex items-center justify-between text-xs font-mono">
          <span className="text-text-muted">Polymarket</span>
          <span style={{ color: report.signals.polymarket.bias === 'bullish' ? '#22c55e' : report.signals.polymarket.bias === 'bearish' ? '#ef4444' : '#8b5cf6' }}>
            {report.signals.polymarket.bias} ({report.signals.polymarket.conviction}%)
          </span>
        </div>

        {report.signals.tvl.tvl > 0 && (
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-text-muted">Solana TVL</span>
            <span style={{ color: report.signals.tvl.change24hPct >= 0 ? '#22c55e' : '#ef4444' }}>
              {report.signals.tvl.change24hPct >= 0 ? '+' : ''}{report.signals.tvl.change24hPct.toFixed(1)}% (24h)
            </span>
          </div>
        )}

        {report.signals.dexVolume.volume24h > 0 && (
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-text-muted">DEX Volume</span>
            <span style={{ color: report.signals.dexVolume.change24hPct >= 0 ? '#22c55e' : '#ef4444' }}>
              {report.signals.dexVolume.change24hPct >= 0 ? '+' : ''}{report.signals.dexVolume.change24hPct.toFixed(1)}% (24h)
            </span>
          </div>
        )}
      </div>

      {/* Token recommendations */}
      {report.recommendations.length > 0 && (
        <>
          <div className="ink-divider mb-3" />
          <div className="text-text-muted text-[10px] font-mono tracking-wider uppercase mb-2">RECOMMENDATIONS</div>
          <div className="space-y-2">
            {report.recommendations.map(rec => {
              const actionColor = ACTION_COLORS[rec.action] || '#8b5cf6';
              return (
                <div key={rec.token} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono font-bold" style={{ color: '#f0edf5' }}>{rec.token}</span>
                    <span
                      className="text-[10px] font-mono tracking-wider uppercase px-1.5 py-0.5 rounded-sm"
                      style={{
                        color: actionColor,
                        background: `${actionColor}15`,
                        border: `1px solid ${actionColor}30`,
                      }}
                    >
                      {rec.action.replace('_', ' ')}
                    </span>
                  </div>
                  {/* Confidence bar */}
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-bg-inner rounded-sm overflow-hidden">
                      <div
                        className="h-full rounded-sm"
                        style={{
                          width: `${rec.confidence}%`,
                          background: actionColor,
                        }}
                      />
                    </div>
                    <span className="text-[10px] font-mono text-text-muted">{rec.confidence}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};

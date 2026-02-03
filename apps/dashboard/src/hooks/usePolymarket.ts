'use client';

import { useState, useEffect, useCallback } from 'react';

export interface CryptoMarketSignal {
  question: string;
  probability: number;
  volume24h: number;
  priceChange24h: number;
  relevance: 'high' | 'medium' | 'low';
}

export interface MarketIntelligence {
  cryptoMarkets: CryptoMarketSignal[];
  sentimentSummary: {
    overallBias: 'bullish' | 'neutral' | 'bearish';
    highConvictionCount: number;
    averageProbability: number;
  };
  fetchedAt: number;
}

const FALLBACK: MarketIntelligence = {
  cryptoMarkets: [
    { question: 'Will Bitcoin reach $150k by end of 2026?', probability: 0.42, volume24h: 850000, priceChange24h: 0.02, relevance: 'medium' },
    { question: 'Will Solana surpass $300 by June 2026?', probability: 0.35, volume24h: 420000, priceChange24h: -0.01, relevance: 'high' },
  ],
  sentimentSummary: { overallBias: 'neutral', highConvictionCount: 0, averageProbability: 0.5 },
  fetchedAt: Date.now(),
};

export function usePolymarket() {
  const [intelligence, setIntelligence] = useState<MarketIntelligence>(FALLBACK);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/polymarket');
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const data: MarketIntelligence = await res.json();
      setIntelligence(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
      setIntelligence(FALLBACK);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { intelligence, loading, error, refresh };
}

'use client';

import { useState, useEffect, useCallback } from 'react';

export type StrategyTag = 'stake' | 'lend' | 'lp' | 'loop' | 'perps-lp';

export interface YieldOpportunity {
  protocol: string;
  symbol: string;
  apy: number;
  tvl: string;
  tvlRaw: number;
  risk: 'Low' | 'Medium' | 'High';
  strategyTag: StrategyTag;
  source: 'live' | 'fallback';
}

interface DefiLlamaPool {
  chain: string;
  project: string;
  symbol: string;
  tvlUsd: number;
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
  ilRisk: string;
  stablecoin: boolean;
  exposure: string;
}

// Protocol slugs on DefiLlama → display name
const SOLANA_PROJECTS: Record<string, string> = {
  'marinade-liquid-staking': 'Marinade',
  'jupiter-staked-sol': 'Jupiter',
  'jito-staked-sol': 'Jito',
  'jupiter-perps': 'Jupiter Perps',
  'kamino-lend': 'Kamino Lend',
  'kamino-liquidity': 'Kamino',
  'kamino-multiply': 'Kamino Multiply',
  'raydium-amm': 'Raydium',
  'raydium-concentrated-liquidity': 'Raydium CLMM',
};

// Map DefiLlama project slug → strategy tag
const PROJECT_STRATEGY_TAG: Record<string, StrategyTag> = {
  'marinade-liquid-staking': 'stake',
  'jupiter-staked-sol': 'stake',
  'jito-staked-sol': 'stake',
  'jupiter-perps': 'perps-lp',
  'kamino-lend': 'lend',
  'kamino-liquidity': 'lp',
  'kamino-multiply': 'loop',
  'raydium-amm': 'lp',
  'raydium-concentrated-liquidity': 'lp',
};

function formatTvl(tvl: number): string {
  if (tvl >= 1e9) return `$${(tvl / 1e9).toFixed(1)}B`;
  if (tvl >= 1e6) return `$${(tvl / 1e6).toFixed(0)}M`;
  if (tvl >= 1e3) return `$${(tvl / 1e3).toFixed(0)}K`;
  return `$${tvl.toFixed(0)}`;
}

function assessRisk(apy: number, ilRisk: string, exposure: string, tag: StrategyTag): 'Low' | 'Medium' | 'High' {
  // Leverage loops and perps-LP carry inherently higher risk
  if (tag === 'loop') return apy > 30 ? 'High' : 'Medium';
  if (tag === 'perps-lp') return apy > 40 ? 'High' : 'Medium';
  if (apy > 50 || ilRisk === 'yes') return 'High';
  if (apy > 15 || exposure === 'multi') return 'Medium';
  return 'Low';
}

// Fallback data if APIs are unreachable
const FALLBACK_DATA: YieldOpportunity[] = [
  { protocol: 'Marinade', symbol: 'mSOL', apy: 5.26, tvl: '$352M', tvlRaw: 352e6, risk: 'Low', strategyTag: 'stake', source: 'fallback' },
  { protocol: 'Jito', symbol: 'JitoSOL', apy: 6.9, tvl: '$1.8B', tvlRaw: 1.8e9, risk: 'Low', strategyTag: 'stake', source: 'fallback' },
  { protocol: 'Jupiter', symbol: 'jupSOL', apy: 7.8, tvl: '$200M', tvlRaw: 200e6, risk: 'Low', strategyTag: 'stake', source: 'fallback' },
  { protocol: 'Kamino Lend', symbol: 'USDC', apy: 8.9, tvl: '$450M', tvlRaw: 450e6, risk: 'Low', strategyTag: 'lend', source: 'fallback' },
  { protocol: 'Kamino Multiply', symbol: 'SOL-loop', apy: 18.5, tvl: '$120M', tvlRaw: 120e6, risk: 'Medium', strategyTag: 'loop', source: 'fallback' },
  { protocol: 'Jupiter Perps', symbol: 'JLP', apy: 24.3, tvl: '$680M', tvlRaw: 680e6, risk: 'Medium', strategyTag: 'perps-lp', source: 'fallback' },
  { protocol: 'Raydium', symbol: 'SOL-USDC', apy: 15.6, tvl: '$320M', tvlRaw: 320e6, risk: 'Medium', strategyTag: 'lp', source: 'fallback' },
];

async function fetchDefiLlama(): Promise<YieldOpportunity[]> {
  const res = await fetch('https://yields.llama.fi/pools');
  if (!res.ok) throw new Error(`DefiLlama API error: ${res.status}`);
  const data = await res.json();
  const pools: DefiLlamaPool[] = data.data || data;

  // Filter Solana pools from our target protocols, pick top by TVL
  const solanaTargets = pools.filter(
    (p) => p.chain === 'Solana' && SOLANA_PROJECTS[p.project] && p.apy !== null && p.tvlUsd > 100000
  );

  // Group by project, take the highest-TVL pool per project
  const byProject = new Map<string, DefiLlamaPool>();
  for (const pool of solanaTargets) {
    const existing = byProject.get(pool.project);
    if (!existing || pool.tvlUsd > existing.tvlUsd) {
      byProject.set(pool.project, pool);
    }
  }

  const results: YieldOpportunity[] = [];
  for (const [project, pool] of byProject) {
    const tag = PROJECT_STRATEGY_TAG[project] || 'lp';
    results.push({
      protocol: SOLANA_PROJECTS[project] || project,
      symbol: pool.symbol,
      apy: Math.round((pool.apy || 0) * 100) / 100,
      tvl: formatTvl(pool.tvlUsd),
      tvlRaw: pool.tvlUsd,
      risk: assessRisk(pool.apy || 0, pool.ilRisk, pool.exposure, tag),
      strategyTag: tag,
      source: 'live',
    });
  }

  // Sort by TVL descending (highest TVL first)
  results.sort((a, b) => b.tvlRaw - a.tvlRaw);

  return results.slice(0, 8); // Top 8 opportunities
}

async function fetchMarinadeApy(): Promise<{ apy: number } | null> {
  try {
    const res = await fetch('https://api.marinade.finance/msol/apy/7d');
    if (!res.ok) return null;
    const data = await res.json();
    return { apy: Math.round(data.value * 10000) / 100 }; // decimal -> percentage
  } catch {
    return null;
  }
}

export function useYieldData() {
  const [opportunities, setOpportunities] = useState<YieldOpportunity[]>(FALLBACK_DATA);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch from DefiLlama (covers all protocols)
      const results = await fetchDefiLlama();

      // Also fetch direct Marinade APY for more accuracy
      const marinadeApy = await fetchMarinadeApy();
      if (marinadeApy) {
        const marinadeEntry = results.find(r => r.protocol === 'Marinade');
        if (marinadeEntry) {
          marinadeEntry.apy = marinadeApy.apy;
        }
      }

      if (results.length > 0) {
        setOpportunities(results);
        setLastUpdated(new Date());
      } else {
        setOpportunities(FALLBACK_DATA);
        setError('No data from API, showing reference values');
      }
    } catch (e: any) {
      setOpportunities(FALLBACK_DATA);
      setError(e.message || 'Failed to fetch yield data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    // Refresh every 5 minutes
    const interval = setInterval(fetchData, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { opportunities, loading, lastUpdated, error, refresh: fetchData };
}

'use client';

import { useState, useCallback, useRef } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import type { AllocationSlot } from './useOODALoop';
import { computeAllocationDiff, type AllocationDiff, type CurrentPosition } from '@/lib/allocation-diff';

export interface PositionEntry {
  symbol: string;
  mint: string;
  balance: number;
  uiAmount: number;
  decimals: number;
}

export interface PositionSnapshot {
  positions: PositionEntry[];
  allocation: CurrentPosition[];
  totalValueSol: number;
  timestamp: number;
}

export function usePositionTracker() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [snapshot, setSnapshot] = useState<PositionSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const lastFetchRef = useRef(0);

  const fetchPositions = useCallback(async (): Promise<PositionSnapshot | null> => {
    if (!publicKey) return null;

    // Throttle: don't fetch more than once per 10s
    const now = Date.now();
    if (now - lastFetchRef.current < 10_000 && snapshot) return snapshot;
    lastFetchRef.current = now;

    setLoading(true);
    try {
      const res = await fetch(`/api/agent/positions?wallet=${publicKey.toBase58()}`);
      if (!res.ok) {
        console.warn('Position fetch failed:', res.status);
        return null;
      }
      const data: PositionSnapshot = await res.json();
      setSnapshot(data);
      return data;
    } catch (err) {
      console.warn('Position fetch error:', err);
      return null;
    } finally {
      setLoading(false);
    }
  }, [publicKey, snapshot]);

  /**
   * Compute drift between current positions and a target allocation.
   */
  const computeDrift = useCallback(
    (targetAllocation: AllocationSlot[], driftThreshold: number = 3): AllocationDiff | null => {
      if (!snapshot) return null;
      const target = targetAllocation.map(a => ({
        symbol: a.symbol,
        pct: a.pct,
        protocol: a.protocol,
        strategyTag: a.strategyTag,
      }));
      return computeAllocationDiff(snapshot.allocation, target, driftThreshold);
    },
    [snapshot],
  );

  const currentPositions = snapshot?.positions ?? [];
  const allocationPct = snapshot?.allocation ?? [];
  const totalValueSol = snapshot?.totalValueSol ?? 0;

  return {
    snapshot,
    currentPositions,
    allocationPct,
    totalValueSol,
    loading,
    fetchPositions,
    computeDrift,
  };
}

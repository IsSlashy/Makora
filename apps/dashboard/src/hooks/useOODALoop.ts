'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useVault } from './useVault';
import { useStrategy } from './useStrategy';
import { useActivityFeed } from './useActivityFeed';
import type { YieldOpportunity, StrategyTag } from './useYieldData';

export type OODAPhase = 'IDLE' | 'OBSERVE' | 'ORIENT' | 'DECIDE' | 'ACT';

export interface SessionInfo {
  id: string;
  walletAddress: string;
  fundedAmount: number;
  timeRemainingMs: number;
  status: string;
  tradeCount: number;
}

export interface OODAState {
  phase: OODAPhase;
  phaseIndex: number;
  adaptations: number;
  confidence: number;
  isRunning: boolean;
  lastObservation: ObservationData | null;
  lastDecision: DecisionData | null;
  phaseDescription: string;
  stealthSessions: SessionInfo[];
  totalInSession: number;
  stealthActive: boolean;
}

export interface ObservationData {
  walletBalance: number;
  vaultBalance: number;
  totalPortfolio: number;
  timestamp: number;
}

export interface AllocationSlot {
  protocol: string;
  symbol: string;
  pct: number;
  expectedApy: number;
  strategyTag: StrategyTag;
  risk: 'Low' | 'Medium' | 'High';
}

export interface DecisionData {
  recommendation: string;
  confidence: number;
  riskScore: number;
  action: string;
  allocation: AllocationSlot[];
  blendedApy: number;
}

const PHASE_ORDER: OODAPhase[] = ['OBSERVE', 'ORIENT', 'DECIDE', 'ACT'];
const PHASE_DESCRIPTIONS: Record<OODAPhase, string> = {
  IDLE: 'Waiting for wallet connection',
  OBSERVE: 'Reading on-chain portfolio state',
  ORIENT: 'Evaluating strategy & market context',
  DECIDE: 'Validating action against risk limits',
  ACT: 'Presenting recommendation',
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ─── Delta-Neutral Allocation Engine (pure function) ────────────────────────

interface TierSlot {
  tag: StrategyTag;
  pct: number;
}

const CONSERVATIVE_TIER: TierSlot[] = [
  { tag: 'stake', pct: 50 },
  { tag: 'lend', pct: 30 },
  // 20% reserve (no slot — cash)
];

const BALANCED_TIER: TierSlot[] = [
  { tag: 'stake', pct: 35 },
  { tag: 'lend', pct: 25 },
  { tag: 'loop', pct: 25 },
  { tag: 'perps-lp', pct: 15 },
];

const AGGRESSIVE_TIER: TierSlot[] = [
  { tag: 'stake', pct: 20 },
  { tag: 'lend', pct: 20 },
  { tag: 'loop', pct: 30 },
  { tag: 'perps-lp', pct: 30 },
];

function pickBestYield(
  yields: YieldOpportunity[],
  tag: StrategyTag,
  usedProtocols?: Set<string>,
): YieldOpportunity | null {
  const candidates = yields
    .filter(y => y.strategyTag === tag && y.apy > 0)
    .sort((a, b) => b.apy - a.apy);
  if (candidates.length === 0) return null;
  // Prefer a protocol not already used in the allocation
  if (usedProtocols) {
    const unused = candidates.find(c => !usedProtocols.has(c.protocol));
    if (unused) return unused;
  }
  return candidates[0];
}

export function computeAllocation(
  yields: YieldOpportunity[],
  confidence: number,
): AllocationSlot[] {
  const tier = confidence >= 80
    ? AGGRESSIVE_TIER
    : confidence >= 60
      ? BALANCED_TIER
      : CONSERVATIVE_TIER;

  const usedProtocols = new Set<string>();
  const slots: AllocationSlot[] = [];

  for (const { tag, pct } of tier) {
    const best = pickBestYield(yields, tag, usedProtocols);
    if (best) {
      usedProtocols.add(best.protocol);
      slots.push({
        protocol: best.protocol,
        symbol: best.symbol,
        pct,
        expectedApy: best.apy,
        strategyTag: tag,
        risk: best.risk,
      });
    } else {
      // No yield for this tag — pick best unused yield from any tag
      const anyBest = yields
        .filter(y => y.apy > 0 && !usedProtocols.has(y.protocol))
        .sort((a, b) => b.apy - a.apy)[0];
      if (anyBest) {
        usedProtocols.add(anyBest.protocol);
        slots.push({
          protocol: anyBest.protocol,
          symbol: anyBest.symbol,
          pct,
          expectedApy: anyBest.apy,
          strategyTag: tag,
          risk: anyBest.risk,
        });
      }
    }
  }

  return slots;
}

export function getStrategyLabel(confidence: number): string {
  if (confidence >= 80) return 'Aggressive';
  if (confidence >= 60) return 'Balanced';
  return 'Conservative';
}

function computeBlendedApy(allocation: AllocationSlot[]): number {
  const totalPct = allocation.reduce((s, a) => s + a.pct, 0);
  if (totalPct === 0) return 0;
  const weighted = allocation.reduce((s, a) => s + a.pct * a.expectedApy, 0);
  return Math.round((weighted / totalPct) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────

export function useOODALoop() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { vaultState, vaultBalance, fetchVaultState } = useVault();
  const { strategyState, totalCycles, logAction, fetchStrategyState } = useStrategy();
  const { addActivity } = useActivityFeed();

  const [state, setState] = useState<OODAState>({
    phase: 'IDLE',
    phaseIndex: -1,
    adaptations: 0,
    confidence: 0,
    isRunning: false,
    lastObservation: null,
    lastDecision: null,
    phaseDescription: PHASE_DESCRIPTIONS.IDLE,
    stealthSessions: [],
    totalInSession: 0,
    stealthActive: false,
  });

  const runningRef = useRef(false);

  // External yields injected via setYields (called from page component)
  const yieldsRef = useRef<YieldOpportunity[]>([]);
  const setYields = useCallback((y: YieldOpportunity[]) => {
    yieldsRef.current = y;
  }, []);

  // Store all dependencies in refs so the loop function stays stable
  // and doesn't restart on every state change.
  const depsRef = useRef({
    connection,
    publicKey,
    vaultState,
    vaultBalance,
    strategyState,
    fetchVaultState,
    fetchStrategyState,
    logAction,
    addActivity,
  });

  // Keep refs up to date on every render
  useEffect(() => {
    depsRef.current = {
      connection,
      publicKey,
      vaultState,
      vaultBalance,
      strategyState,
      fetchVaultState,
      fetchStrategyState,
      logAction,
      addActivity,
    };
  });

  const setPhase = useCallback((phase: OODAPhase) => {
    const phaseIndex = PHASE_ORDER.indexOf(phase);
    setState(prev => ({
      ...prev,
      phase,
      phaseIndex,
      phaseDescription: PHASE_DESCRIPTIONS[phase],
    }));
  }, []);

  // Single stable cycle function that reads deps from ref
  const runCycle = useCallback(async () => {
    const deps = depsRef.current;
    if (!deps.publicKey) return;

    // ===== OBSERVE =====
    setPhase('OBSERVE');
    let observation: ObservationData | null = null;
    try {
      const walletBal = await deps.connection.getBalance(deps.publicKey);
      try { await deps.fetchVaultState(); } catch { /* optional */ }

      const currentVaultBal = depsRef.current.vaultBalance;
      observation = {
        walletBalance: walletBal / LAMPORTS_PER_SOL,
        vaultBalance: currentVaultBal,
        totalPortfolio: (walletBal / LAMPORTS_PER_SOL) + currentVaultBal,
        timestamp: Date.now(),
      };

      setState(prev => ({ ...prev, lastObservation: observation }));
      deps.addActivity({
        action: `Observed portfolio: ${observation.totalPortfolio.toFixed(4)} SOL total`,
        status: 'adapt',
      });
    } catch (e) {
      console.error('OBSERVE error:', e);
      return;
    }

    await sleep(2000);

    // ===== ORIENT =====
    setPhase('ORIENT');
    await sleep(800);
    try { await deps.fetchStrategyState(); } catch { /* optional */ }

    // Re-read after fetches
    const currentDeps = depsRef.current;
    let confidence = 50;
    if (observation.totalPortfolio > 1) confidence += 10;
    if (observation.totalPortfolio > 5) confidence += 10;
    if (observation.totalPortfolio > 10) confidence += 5;
    if (currentDeps.vaultState) confidence += 10;
    if (currentDeps.strategyState) confidence += 10;
    confidence = Math.min(98, Math.max(30, confidence));
    confidence += Math.floor(Math.random() * 5) - 2;

    setState(prev => ({ ...prev, confidence }));
    deps.addActivity({
      action: `Strategy evaluation: ${confidence}% confidence`,
      status: 'adapt',
    });

    await sleep(1500);

    // ===== DECIDE =====
    setPhase('DECIDE');
    await sleep(600);

    const riskLimits = currentDeps.vaultState?.riskLimits;
    let riskScore = 3.0;
    if (riskLimits) {
      const positionRisk = riskLimits.maxPositionSizePct / 100;
      const slippageRisk = riskLimits.maxSlippageBps / 10000;
      const lossRisk = riskLimits.maxDailyLossPct / 100;
      riskScore = (positionRisk * 3 + slippageRisk * 2 + lossRisk * 5) * 10;
      riskScore = Math.min(10, Math.max(1, riskScore));
    }

    // Compute allocation using live yield data
    const yields = yieldsRef.current;
    const allocation = yields.length > 0
      ? computeAllocation(yields, confidence)
      : [];
    const blendedApy = computeBlendedApy(allocation);
    const stratLabel = getStrategyLabel(confidence);

    let recommendation: string;
    let action: string;
    if (!currentDeps.vaultState) {
      recommendation = 'Initialize vault to enable on-chain management';
      action = 'init_vault';
    } else if (observation.walletBalance > 2 && observation.vaultBalance < 0.5) {
      recommendation = 'Deposit SOL into vault for managed allocation';
      action = 'deposit';
    } else if (allocation.length > 0) {
      recommendation = `${stratLabel}: ${allocation.map(a => `${a.symbol} ${a.pct}%`).join(', ')} → ${blendedApy}% APY`;
      action = 'allocate';
    } else {
      recommendation = 'Maintain current allocation, risk within limits';
      action = 'hold';
    }

    const decision: DecisionData = { recommendation, confidence, riskScore, action, allocation, blendedApy };
    setState(prev => ({ ...prev, lastDecision: decision }));
    deps.addActivity({
      action: allocation.length > 0
        ? `${stratLabel} allocation: ${blendedApy}% blended APY (risk ${riskScore.toFixed(1)}/10)`
        : `Decision: ${recommendation} (risk ${riskScore.toFixed(1)}/10)`,
      status: confidence > 70 ? 'success' : 'warning',
    });

    await sleep(1000);

    // ===== ACT =====
    setPhase('ACT');
    await sleep(400);

    const latestDeps = depsRef.current;
    if (latestDeps.strategyState) {
      try {
        const tx = await latestDeps.logAction(
          decision.action,
          'makora',
          decision.recommendation.slice(0, 64),
          false,
          true,
        );
        deps.addActivity({
          action: 'Action logged on-chain',
          status: 'success',
          txSig: tx,
        });
      } catch {
        deps.addActivity({
          action: 'Cycle complete (off-chain — init strategy to log on-chain)',
          status: 'adapt',
        });
      }
    } else {
      deps.addActivity({
        action: 'OODA cycle complete (advisory)',
        status: 'adapt',
      });
    }

    // Update stealth session state from vault's in_session_amount
    const latestVault = depsRef.current.vaultState;
    const isAutoMode = latestVault && 'auto' in latestVault.mode;
    const inSessionLamports = (latestVault as any)?.inSessionAmount?.toNumber?.() ?? 0;
    const inSessionSol = inSessionLamports / 1_000_000_000;

    // Build session info from on-chain data
    // The real session manager runs in the agent-core; the dashboard shows
    // the aggregate in_session_amount from the vault state
    const sessionInfos: SessionInfo[] = inSessionSol > 0 ? [{
      id: 'vault-session',
      walletAddress: 'ephemeral',
      fundedAmount: inSessionSol,
      timeRemainingMs: 0, // Not tracked on-chain
      status: 'active',
      tradeCount: 0,
    }] : [];

    setState(prev => ({
      ...prev,
      adaptations: prev.adaptations + 1,
      stealthSessions: sessionInfos,
      totalInSession: inSessionSol,
      stealthActive: isAutoMode === true && inSessionSol > 0,
    }));
  }, [setPhase]); // Only depends on setPhase which is stable

  // Stable ref for runCycle so startLoop never changes
  const runCycleRef = useRef(runCycle);
  useEffect(() => { runCycleRef.current = runCycle; }, [runCycle]);

  // startLoop has NO dependencies — it never recreates, so the useEffect
  // below only fires once per wallet connect/disconnect.
  const startLoop = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setState(prev => ({ ...prev, isRunning: true }));

    const loop = async () => {
      // Wait 5s before first cycle so wallet adapter finishes its own RPC calls
      await sleep(5000);
      while (runningRef.current) {
        try {
          await runCycleRef.current();
        } catch (e) {
          console.warn('OODA cycle error (will retry):', e);
        }
        // Wait 60s between cycles to avoid RPC rate limits on public devnet
        await sleep(60000);
      }
    };
    loop().catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopLoop = useCallback(() => {
    runningRef.current = false;
    setState(prev => ({
      ...prev,
      isRunning: false,
      phase: 'IDLE',
      phaseIndex: -1,
      phaseDescription: PHASE_DESCRIPTIONS.IDLE,
    }));
  }, []);

  // Auto-start when wallet connects, auto-stop when disconnects
  useEffect(() => {
    if (publicKey) {
      startLoop();
    } else {
      stopLoop();
    }
    return () => { runningRef.current = false; };
  }, [publicKey, startLoop, stopLoop]);

  // Use on-chain cycle count if available
  const totalAdaptations = totalCycles > 0 ? totalCycles + state.adaptations : state.adaptations;

  return {
    ...state,
    adaptations: totalAdaptations,
    runCycle,
    startLoop,
    stopLoop,
    setYields,
  };
}

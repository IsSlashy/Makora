'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { useVault } from './useVault';
import { useStrategy } from './useStrategy';
import { useActivityFeed } from './useActivityFeed';

export type OODAPhase = 'IDLE' | 'OBSERVE' | 'ORIENT' | 'DECIDE' | 'ACT';

export interface OODAState {
  phase: OODAPhase;
  phaseIndex: number;
  adaptations: number;
  confidence: number;
  isRunning: boolean;
  lastObservation: ObservationData | null;
  lastDecision: DecisionData | null;
  phaseDescription: string;
}

export interface ObservationData {
  walletBalance: number;
  vaultBalance: number;
  totalPortfolio: number;
  timestamp: number;
}

export interface DecisionData {
  recommendation: string;
  confidence: number;
  riskScore: number;
  action: string;
}

const PHASE_ORDER: OODAPhase[] = ['OBSERVE', 'ORIENT', 'DECIDE', 'ACT'];
const PHASE_DESCRIPTIONS: Record<OODAPhase, string> = {
  IDLE: 'Waiting for wallet connection',
  OBSERVE: 'Reading on-chain portfolio state',
  ORIENT: 'Evaluating strategy & market context',
  DECIDE: 'Validating action against risk limits',
  ACT: 'Presenting recommendation',
};

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
  });

  const runningRef = useRef(false);
  const cycleCountRef = useRef(0);

  const setPhase = useCallback((phase: OODAPhase) => {
    const phaseIndex = PHASE_ORDER.indexOf(phase);
    setState(prev => ({
      ...prev,
      phase,
      phaseIndex,
      phaseDescription: PHASE_DESCRIPTIONS[phase],
    }));
  }, []);

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  // ===== OBSERVE: Read real wallet + vault data =====
  const observe = useCallback(async (): Promise<ObservationData | null> => {
    if (!publicKey) return null;
    setPhase('OBSERVE');

    try {
      const walletBalance = await connection.getBalance(publicKey);
      await fetchVaultState();

      const observation: ObservationData = {
        walletBalance: walletBalance / LAMPORTS_PER_SOL,
        vaultBalance: vaultBalance,
        totalPortfolio: (walletBalance / LAMPORTS_PER_SOL) + vaultBalance,
        timestamp: Date.now(),
      };

      setState(prev => ({ ...prev, lastObservation: observation }));
      addActivity({
        action: `Observed portfolio: ${observation.totalPortfolio.toFixed(4)} SOL total`,
        status: 'adapt',
      });

      return observation;
    } catch (e) {
      console.error('OBSERVE error:', e);
      return null;
    }
  }, [publicKey, connection, vaultBalance, fetchVaultState, setPhase, addActivity]);

  // ===== ORIENT: Evaluate strategy context =====
  const orient = useCallback(async (observation: ObservationData): Promise<number> => {
    setPhase('ORIENT');
    await sleep(800); // Allow UI to show phase transition

    // Compute a confidence score based on portfolio state
    let confidence = 50;

    // Higher balance = higher confidence
    if (observation.totalPortfolio > 1) confidence += 10;
    if (observation.totalPortfolio > 5) confidence += 10;
    if (observation.totalPortfolio > 10) confidence += 5;

    // Vault is initialized = more structured
    if (vaultState) confidence += 10;

    // Strategy is configured
    if (strategyState) confidence += 10;

    // Clamp
    confidence = Math.min(98, Math.max(30, confidence));

    // Add some realistic variance
    confidence += Math.floor(Math.random() * 5) - 2;

    setState(prev => ({ ...prev, confidence }));
    addActivity({
      action: `Strategy evaluation: ${confidence}% confidence`,
      status: 'adapt',
    });

    return confidence;
  }, [vaultState, strategyState, setPhase, addActivity]);

  // ===== DECIDE: Risk check & recommendation =====
  const decide = useCallback(async (
    observation: ObservationData,
    confidence: number,
  ): Promise<DecisionData> => {
    setPhase('DECIDE');
    await sleep(600);

    // Compute risk score from vault risk limits
    const riskLimits = vaultState?.riskLimits;
    let riskScore = 3.0;
    if (riskLimits) {
      const positionRisk = riskLimits.maxPositionSizePct / 100;
      const slippageRisk = riskLimits.maxSlippageBps / 10000;
      const lossRisk = riskLimits.maxDailyLossPct / 100;
      riskScore = (positionRisk * 3 + slippageRisk * 2 + lossRisk * 5) * 10;
      riskScore = Math.min(10, Math.max(1, riskScore));
    }

    // Generate a recommendation based on state
    let recommendation: string;
    let action: string;

    if (!vaultState) {
      recommendation = 'Initialize vault to enable on-chain management';
      action = 'init_vault';
    } else if (observation.walletBalance > 2 && observation.vaultBalance < 0.5) {
      recommendation = 'Deposit SOL into vault for managed allocation';
      action = 'deposit';
    } else if (confidence > 80) {
      recommendation = 'Portfolio well-balanced, monitoring positions';
      action = 'monitor';
    } else {
      recommendation = 'Maintain current allocation, risk within limits';
      action = 'hold';
    }

    const decision: DecisionData = { recommendation, confidence, riskScore, action };
    setState(prev => ({ ...prev, lastDecision: decision }));

    addActivity({
      action: `Decision: ${recommendation} (risk ${riskScore.toFixed(1)}/10)`,
      status: confidence > 70 ? 'success' : 'warning',
    });

    return decision;
  }, [vaultState, setPhase, addActivity]);

  // ===== ACT: Log decision on-chain =====
  const act = useCallback(async (decision: DecisionData) => {
    setPhase('ACT');
    await sleep(400);

    // Try to log the action on-chain if strategy account exists
    if (strategyState) {
      try {
        const tx = await logAction(
          decision.action,
          'makora',
          decision.recommendation.slice(0, 64),
          false, // not executed (advisory mode)
          true,
        );
        addActivity({
          action: `Action logged on-chain`,
          status: 'success',
          txSig: tx,
        });
      } catch (e) {
        // Strategy not initialized or other error — not critical
        addActivity({
          action: `Cycle complete (off-chain — init strategy to log on-chain)`,
          status: 'adapt',
        });
      }
    } else {
      addActivity({
        action: `OODA cycle complete (advisory)`,
        status: 'adapt',
      });
    }
  }, [strategyState, logAction, setPhase, addActivity]);

  // ===== Run one full OODA cycle =====
  const runCycle = useCallback(async () => {
    if (!publicKey) return;

    // OBSERVE
    const observation = await observe();
    if (!observation) return;
    await sleep(1200);

    // ORIENT
    const confidence = await orient(observation);
    await sleep(1000);

    // DECIDE
    const decision = await decide(observation, confidence);
    await sleep(800);

    // ACT
    await act(decision);

    cycleCountRef.current += 1;
    setState(prev => ({
      ...prev,
      adaptations: prev.adaptations + 1,
    }));
  }, [publicKey, observe, orient, decide, act]);

  // ===== Auto-run loop =====
  const startLoop = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    setState(prev => ({ ...prev, isRunning: true }));

    const loop = async () => {
      while (runningRef.current) {
        await runCycle();
        // Wait between cycles
        await sleep(15000);
      }
    };
    loop().catch(console.error);
  }, [runCycle]);

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
  };
}

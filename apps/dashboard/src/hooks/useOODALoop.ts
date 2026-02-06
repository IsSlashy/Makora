'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { LAMPORTS_PER_SOL, VersionedTransaction } from '@solana/web3.js';
import { useVault } from './useVault';
import { useStrategy } from './useStrategy';
import { useActivityFeed } from './useActivityFeed';
import type { YieldOpportunity, StrategyTag } from './useYieldData';
import { computeAllocationDiff } from '@/lib/allocation-diff';
import { sendTransactionViaJito, isJitoSupported, DEFAULT_JITO_CONFIG, URGENT_JITO_CONFIG } from '@/lib/jito';
import { formatSimulatedPositionsForLLM, getSimulatedPositions } from '@/lib/simulated-perps';
import { observeMarket, formatMarketObservationForLLM, type MarketObservation } from '@/lib/market-observer';

export type OODAPhase = 'IDLE' | 'OBSERVE' | 'ORIENT' | 'DECIDE' | 'ACT';

// ─── Trading Modes ───────────────────────────────────────────────────────────
// INVEST: Long-term DeFi yield (stake, lend, LP) - slow cycles (5-10 min)
// PERPS: Fast Jupiter Perps trading (long/short) - fast cycles (15-30s) + Jito
export type TradingMode = 'invest' | 'perps';

export interface TradingModeConfig {
  mode: TradingMode;
  cycleIntervalMs: number;
  strategies: string[];
  useJito: boolean;
  description: string;
}

export const TRADING_MODES: Record<TradingMode, TradingModeConfig> = {
  invest: {
    mode: 'invest',
    cycleIntervalMs: 5 * 60 * 1000, // 5 minutes
    strategies: ['stake', 'lend', 'lp', 'loop'],
    useJito: false,
    description: 'Long-term yield optimization (stake, lend, LP)',
  },
  perps: {
    mode: 'perps',
    cycleIntervalMs: 3 * 1000, // 3 seconds - ultra-fast for perps scalping
    strategies: ['perp-long', 'perp-short', 'perp-close'],
    useJito: true, // Fast execution is critical for perps
    description: 'Ultra-fast trading on Jupiter Perps (3s cycles)',
  },
};

export interface LLMAnalysisResult {
  marketAssessment: {
    sentiment: 'bullish' | 'neutral' | 'bearish';
    confidence: number;
    reasoning: string;
    keyFactors: string[];
  };
  allocation: Array<{
    protocol: string;
    action: string;
    token: string;
    percentOfPortfolio: number;
    rationale: string;
  }>;
  riskAssessment: {
    overallRisk: number;
    warnings: string[];
  };
  riskParams?: {
    maxPositionPct: number;
    maxSlippageBps: number;
    dailyLossLimitPct: number;
    stopLossPct: number;
  };
  explanation: string;
}

export interface LLMOrientState {
  analysis: LLMAnalysisResult | null;
  reasoning: string;
  provider: string;
  model: string;
  latencyMs: number;
  error: string | null;
}

export interface SessionInfo {
  id: string;
  walletAddress: string;
  fundedAmount: number;
  timeRemainingMs: number;
  status: string;
  tradeCount: number;
}

export interface ExecutionResultEntry {
  action: string;
  protocol: string;
  signature?: string;
  success: boolean;
  error?: string;
  simulated?: boolean;
  unsignedTx?: string; // base64-encoded unsigned tx (wallet signing mode)
  riskAssessment: {
    approved: boolean;
    riskScore: number;
    summary: string;
  };
  quote?: {
    inputAmount: string;
    expectedOutput: string;
    priceImpactPct: number;
  };
}

export interface PositionSnapshotData {
  positions: Array<{
    symbol: string;
    mint: string;
    balance: number;
    uiAmount: number;
    decimals: number;
  }>;
  allocation: Array<{ symbol: string; pct: number }>;
  valueMap?: Array<{ symbol: string; valueSol: number }>;
  totalValueSol: number;
  timestamp: number;
}

export interface AgentRiskParams {
  maxPositionPct: number;
  maxSlippageBps: number;
  dailyLossLimitPct: number;
  stopLossPct: number;
  source: 'agent' | 'default' | 'vault';
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
  llmOrient: LLMOrientState;
  executionResults: ExecutionResultEntry[];
  positionSnapshot: PositionSnapshotData | null;
  agentRiskParams: AgentRiskParams | null;
}

export interface ObservationData {
  walletBalance: number;
  vaultBalance: number;
  totalPortfolio: number;
  timestamp: number;
  positions?: PositionSnapshotData;
  solPrice?: number; // SOL/USD price for P&L calculations
}

export interface AllocationSlot {
  protocol: string;
  symbol: string;
  pct: number;
  expectedApy: number;
  strategyTag: StrategyTag;
  risk: 'Low' | 'Medium' | 'High';
  leverage?: number; // For perps: 1-50x leverage
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
  ORIENT: 'Agent analyzing market context',
  DECIDE: 'Validating action against risk limits',
  ACT: 'Executing allocation decisions',
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Fast delays for PERPS mode (100ms), normal for INVEST mode
const getPhaseDelay = (normalMs: number, isPerps: boolean) => isPerps ? Math.min(100, normalMs) : normalMs;

// ─── MoltBot Intelligence: 100% LLM-driven allocation ────────────────────────
// REMOVED: Hardcoded tiers (CONSERVATIVE_TIER, BALANCED_TIER, AGGRESSIVE_TIER)
// REMOVED: computeAllocation() - MoltBot decisions come from LLM only
// REMOVED: getStrategyLabel() - Strategy labels come from LLM sentiment

function computeBlendedApy(allocation: AllocationSlot[]): number {
  const totalPct = allocation.reduce((s, a) => s + a.pct, 0);
  if (totalPct === 0) return 0;
  const weighted = allocation.reduce((s, a) => s + a.pct * a.expectedApy, 0);
  return Math.round((weighted / totalPct) * 100) / 100;
}

// ─────────────────────────────────────────────────────────────────────────────

export interface OpenClawGatewayConfig {
  endpoint: string;
  token?: string;
  llmKeys?: Partial<Record<string, string>>; // cloud API keys (anthropic, openai, qwen)
}

// ─── Strategy Memory (sliding window for ORIENT context) ────────────────────

interface StrategyMemoryEntry {
  timestamp: number;
  sentiment: string;
  confidence: number;
  allocation: string;
}

const STRATEGY_MEMORY_KEY = 'makora_strategy_memory';
const MAX_MEMORY_ENTRIES = 10;

function loadStrategyMemory(): StrategyMemoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STRATEGY_MEMORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveStrategyMemory(entries: StrategyMemoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STRATEGY_MEMORY_KEY, JSON.stringify(entries.slice(-MAX_MEMORY_ENTRIES)));
  } catch { /* storage full */ }
}

function getStrategyTrendSummary(entries: StrategyMemoryEntry[]): string {
  if (entries.length < 2) return 'Insufficient history for trend analysis.';
  const recent = entries.slice(-5);
  const sentiments = recent.map(e => e.sentiment);
  const confidences = recent.map(e => e.confidence);
  const bullish = sentiments.filter(s => s === 'bullish').length;
  const bearish = sentiments.filter(s => s === 'bearish').length;
  const avgConf = Math.round(confidences.reduce((s, c) => s + c, 0) / confidences.length);
  const confTrend = confidences.length >= 3
    ? (confidences[confidences.length - 1] > confidences[0] ? 'rising' : confidences[confidences.length - 1] < confidences[0] ? 'falling' : 'stable')
    : 'stable';
  return `${bullish}/${recent.length} bullish, ${bearish}/${recent.length} bearish. Confidence ${confTrend} (avg ${avgConf}%).`;
}

// ─── Multi-Call Consensus (calibrates LLM confidence) ────────────────────────

const CONSENSUS_CALLS = 3;

interface ConsensusResult {
  analysis: LLMAnalysisResult;
  rawConfidences: number[];
  consensusConfidence: number;
  agreement: number;
  modelLabel: string;
}

function resolveConsensus(
  responses: Array<{ analysis: LLMAnalysisResult; model: string } | null>,
): ConsensusResult | null {
  const valid = responses.filter((r): r is { analysis: LLMAnalysisResult; model: string } => r !== null);
  if (valid.length === 0) return null;
  if (valid.length === 1) {
    return {
      analysis: valid[0].analysis,
      rawConfidences: [valid[0].analysis.marketAssessment.confidence],
      consensusConfidence: valid[0].analysis.marketAssessment.confidence,
      agreement: 1,
      modelLabel: valid[0].model,
    };
  }

  // Sort confidences — median is more robust than mean against outliers
  const confidences = valid.map(v => v.analysis.marketAssessment.confidence).sort((a, b) => a - b);
  const medianConfidence = confidences[Math.floor(confidences.length / 2)];

  // Count sentiment agreement
  const sentiments = valid.map(v => v.analysis.marketAssessment.sentiment);
  const counts: Record<string, number> = {};
  for (const s of sentiments) counts[s] = (counts[s] || 0) + 1;
  const [dominantSentiment, dominantCount] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const agreementRatio = dominantCount / valid.length;

  // Penalize confidence when LLMs disagree on sentiment direction
  // Full agreement (3/3): no penalty
  // Partial (2/3): ~15% penalty
  // Split (1/3 each): ~30% penalty
  let calibrated = medianConfidence;
  if (agreementRatio < 1) {
    calibrated = Math.round(medianConfidence * (0.7 + 0.3 * agreementRatio));
  }

  // Pick analysis with dominant sentiment closest to calibrated confidence
  const candidates = valid.filter(v => v.analysis.marketAssessment.sentiment === dominantSentiment);
  const best = (candidates.length > 0 ? candidates : valid).reduce((b, c) =>
    Math.abs(c.analysis.marketAssessment.confidence - calibrated) <
    Math.abs(b.analysis.marketAssessment.confidence - calibrated) ? c : b,
  );

  const result: LLMAnalysisResult = JSON.parse(JSON.stringify(best.analysis));
  result.marketAssessment.confidence = calibrated;

  return {
    analysis: result,
    rawConfidences: confidences,
    consensusConfidence: calibrated,
    agreement: agreementRatio,
    modelLabel: best.model,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

export function useOODALoop() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const { vaultState, vaultBalance, fetchVaultState } = useVault();
  const { strategyState, totalCycles, logAction, fetchStrategyState, initializeStrategy } = useStrategy();
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
    llmOrient: {
      analysis: null,
      reasoning: '',
      provider: '',
      model: '',
      latencyMs: 0,
      error: null,
    },
    executionResults: [],
    positionSnapshot: null,
    agentRiskParams: null,
  });

  const runningRef = useRef(false);
  const agentRiskParamsRef = useRef<AgentRiskParams | null>(null);

  // OpenClaw gateway config (always used for ORIENT)
  const gatewayRef = useRef<OpenClawGatewayConfig | null>(null);
  const setGateway = useCallback((config: OpenClawGatewayConfig | null) => {
    gatewayRef.current = config;
  }, []);

  // External Polymarket intelligence injected via setPolymarketData
  const polymarketRef = useRef<{
    cryptoMarkets: Array<{ question: string; probability: number; volume24h: number; priceChange24h: number; relevance: string }>;
    sentimentSummary: { overallBias: string; highConvictionCount: number; averageProbability: number };
  } | null>(null);
  const setPolymarketData = useCallback((data: typeof polymarketRef.current) => {
    polymarketRef.current = data;
  }, []);

  // External yields injected via setYields (called from page component)
  const yieldsRef = useRef<YieldOpportunity[]>([]);
  const setYields = useCallback((y: YieldOpportunity[]) => {
    yieldsRef.current = y;
  }, []);

  // Strategy memory (persisted sliding window)
  const strategyMemoryRef = useRef<StrategyMemoryEntry[]>([]);
  useEffect(() => {
    strategyMemoryRef.current = loadStrategyMemory();
  }, []);

  // Local auto mode — persisted to localStorage for page reload survival
  const AUTO_MODE_KEY = 'makora_auto_mode';
  const localAutoModeRef = useRef(false);
  // Ref for startLoop so setAutoMode can call it without TDZ issues
  // (startLoop is defined after runCycle, ~800 lines below)
  const startLoopRef = useRef<() => void>(() => {});

  // Load persisted auto mode on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem(AUTO_MODE_KEY);
      if (saved === 'true') {
        localAutoModeRef.current = true;
        setState(prev => ({ ...prev }));
      }
    } catch { /* ignore */ }
  }, []);

  const setAutoMode = useCallback((auto: boolean) => {
    localAutoModeRef.current = auto;
    try { localStorage.setItem(AUTO_MODE_KEY, String(auto)); } catch { /* ignore */ }
    if (auto && !runningRef.current) {
      startLoopRef.current();
    }
    setState(prev => ({ ...prev })); // trigger re-render
  }, []);

  // Session params — set by useTradingSession via page.tsx
  const sessionParamsRef = useRef<{
    walletPct: number;
    strategy: string;
    focusTokens?: string[];
  } | null>(null);
  const setSessionParams = useCallback((params: typeof sessionParamsRef.current) => {
    sessionParamsRef.current = params;
  }, []);

  // Configurable cycle interval (default 60s, min 2s for perps, max 5min)
  const cycleIntervalRef = useRef(60000);
  const setCycleInterval = useCallback((ms: number) => {
    cycleIntervalRef.current = Math.max(2000, Math.min(300000, ms)); // Min 2s for ultra-fast perps
  }, []);

  // Signing mode: 'agent' = server keypair, 'wallet' = Phantom approval
  const signingModeRef = useRef<'agent' | 'wallet'>('agent');
  const setSigningMode = useCallback((mode: 'agent' | 'wallet') => {
    signingModeRef.current = mode;
  }, []);

  // Jito fast execution: ~100ms faster block inclusion (mainnet only)
  const jitoEnabledRef = useRef(false);
  const jitoUrgentRef = useRef(false); // Higher tip for time-sensitive trades (perps)
  const setJitoEnabled = useCallback((enabled: boolean) => {
    jitoEnabledRef.current = enabled;
  }, []);
  const setJitoUrgent = useCallback((urgent: boolean) => {
    jitoUrgentRef.current = urgent;
  }, []);

  // ── TRADING MODE: INVEST (long-term) vs PERPS (fast trading) ───────────────
  const tradingModeRef = useRef<TradingMode>('invest');
  const setTradingMode = useCallback((mode: TradingMode) => {
    tradingModeRef.current = mode;
    const config = TRADING_MODES[mode];

    // Auto-configure based on mode
    cycleIntervalRef.current = config.cycleIntervalMs;
    jitoEnabledRef.current = config.useJito;
    jitoUrgentRef.current = mode === 'perps'; // Urgent tips for perps

    setState(prev => ({ ...prev })); // trigger re-render
    try { localStorage.setItem('makora_trading_mode', mode); } catch { /* ignore */ }
  }, []);

  // Load persisted trading mode
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const saved = localStorage.getItem('makora_trading_mode') as TradingMode | null;
      if (saved && (saved === 'invest' || saved === 'perps')) {
        tradingModeRef.current = saved;
        const config = TRADING_MODES[saved];
        cycleIntervalRef.current = config.cycleIntervalMs;
        jitoEnabledRef.current = config.useJito;
        jitoUrgentRef.current = saved === 'perps';
      }
    } catch { /* ignore */ }
  }, []);

  // Cumulative SOL spent by the agent in this session (prevents exceeding vault budget)
  const cumulativeSpendRef = useRef(0);

  // Trade guard callbacks (injected from page via setTradeGuard)
  const tradeGuardRef = useRef<{
    initSession: (val: number) => void;
    updateValue: (val: number) => void;
    updatePositions: (positions: Array<{ symbol: string; valueSol: number }>) => void;
    vetTrade: (symbol: string, sizeSol: number) => { allowed: boolean; reason?: string };
    getStopLossTriggers: () => Array<{ symbol: string; pnlPct: number; currentValueSol: number }>;
    recordEntry: (symbol: string, valueSol: number, preTradePositionValueSol?: number) => void;
    isDailyHalted: () => boolean;
    setConfig: (updates: Partial<{ maxDailyLossPct: number; stopLossPct: number; minTradeSizeSol: number }>) => void;
  } | null>(null);
  const setTradeGuard = useCallback((guard: typeof tradeGuardRef.current) => {
    tradeGuardRef.current = guard;
  }, []);

  // Store all dependencies in refs so the loop function stays stable
  // and doesn't restart on every state change.
  const depsRef = useRef({
    connection,
    publicKey,
    signTransaction,
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
      signTransaction,
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

    // PERPS mode uses ultra-fast delays (100ms max) for rapid trading
    const isPerps = tradingModeRef.current === 'perps';
    const fastDelay = (normalMs: number) => getPhaseDelay(normalMs, isPerps);

    // ===== OBSERVE =====
    setPhase('OBSERVE');
    let observation: ObservationData | null = null;
    try {
      const walletBal = await deps.connection.getBalance(deps.publicKey);
      try { await deps.fetchVaultState(); } catch { /* optional */ }

      const currentVaultBal = depsRef.current.vaultBalance;
      const walletSol = walletBal / LAMPORTS_PER_SOL;
      // HARDCODED devnet for hackathon - vault holds real SOL in PDA
      const isMainnet = false;
      observation = {
        walletBalance: walletSol,
        vaultBalance: currentVaultBal,
        totalPortfolio: isMainnet ? walletSol : walletSol + currentVaultBal,
        timestamp: Date.now(),
      };

      // Fetch SPL token positions for position awareness
      try {
        const posRes = await fetch(`/api/agent/positions?wallet=${deps.publicKey.toBase58()}`);
        if (posRes.ok) {
          const positions: PositionSnapshotData = await posRes.json();
          observation.positions = positions;
          setState(prev => ({ ...prev, positionSnapshot: positions }));
        }
      } catch {
        // Position fetch is non-critical
      }

      setState(prev => ({ ...prev, lastObservation: observation }));

      // Feed trade guard with operating budget (vault-scoped when available)
      const guard = tradeGuardRef.current;
      const operatingBudget = observation.vaultBalance > 0
        ? observation.vaultBalance
        : observation.totalPortfolio;
      if (guard) {
        guard.initSession(operatingBudget);
        // Use real portfolio value (including token positions priced via Jupiter)
        // instead of static vault balance — this makes P&L reflect actual token value changes
        const livePortfolioValue = observation.positions?.totalValueSol ?? operatingBudget;
        guard.updateValue(livePortfolioValue);
        // Update position tracking for stop-loss monitoring
        if (observation.positions?.valueMap) {
          guard.updatePositions(observation.positions.valueMap);
        }
      }

      // MARKET OBSERVATION: Fetch real-time market data
      let marketObs: MarketObservation | null = null;
      try {
        marketObs = await observeMarket();
        deps.addActivity({
          action: `Market: SOL $${marketObs.prices.SOL.toFixed(2)} [${marketObs.momentum.SOL}] | Sentiment: ${marketObs.marketSentiment}`,
          status: 'adapt',
        });
      } catch (e) {
        console.warn('Market observation failed:', e);
      }

      const posCount = observation.positions?.positions?.length ?? 0;
      deps.addActivity({
        action: `Portfolio: ${observation.totalPortfolio.toFixed(4)} SOL${posCount > 1 ? ` (${posCount} tokens)` : ''}`,
        status: 'adapt',
      });

      // Store market observation for ORIENT phase
      (observation as any).marketObservation = marketObs;
      // Store SOL price for P&L calculations
      if (marketObs) {
        observation.solPrice = marketObs.prices.SOL;
        // Update state with solPrice
        setState(prev => ({ ...prev, lastObservation: observation }));
      }
    } catch (e) {
      console.error('OBSERVE error:', e);
      return;
    }

    await sleep(fastDelay(2000));

    // ===== ORIENT =====
    setPhase('ORIENT');
    await sleep(fastDelay(800));
    try { await deps.fetchStrategyState(); } catch { /* optional */ }

    // Re-read after fetches
    const currentDeps = depsRef.current;
    let confidence = 50;
    let llmOrientUpdate: LLMOrientState = { analysis: null, reasoning: '', provider: '', model: '', latencyMs: 0, error: null };

    const gateway = gatewayRef.current;
    if (gateway) {
      // Build shared context for analysis (ENHANCED with positions, history, trend)
      const contextParts: string[] = [];
      contextParts.push(`## PORTFOLIO\nTotal: ${observation.totalPortfolio.toFixed(4)} SOL\nWallet: ${observation.walletBalance.toFixed(4)} SOL\nVault: ${observation.vaultBalance.toFixed(4)} SOL`);

      // CURRENT POSITIONS (NEW)
      if (observation.positions && observation.positions.positions.length > 0) {
        const posLines = observation.positions.positions.map(p =>
          `  ${p.symbol}: ${p.uiAmount.toFixed(4)}`
        );
        const allocLines = observation.positions.allocation.map(a =>
          `  ${a.symbol}: ${a.pct}%`
        );
        contextParts.push(`## CURRENT POSITIONS\n${posLines.join('\n')}\n\n## CURRENT ALLOCATION\n${allocLines.join('\n')}`);
      }

      // REAL-TIME MARKET OBSERVATION (from OBSERVE phase)
      const marketObs = (observation as any).marketObservation as MarketObservation | null;
      if (marketObs) {
        contextParts.push(formatMarketObservationForLLM(marketObs));
      }

      const yields = yieldsRef.current;
      if (yields.length > 0) {
        contextParts.push(`## YIELD OPPORTUNITIES\n${yields.map(y => `  ${y.protocol} | ${y.symbol} | ${y.apy}% APY | TVL ${y.tvl} | Risk: ${y.risk}`).join('\n')}`);
      }

      const poly = polymarketRef.current;
      if (poly && poly.cryptoMarkets.length > 0) {
        contextParts.push(`## PREDICTION MARKETS (Polymarket)\nBias: ${poly.sentimentSummary.overallBias}\nHigh conviction: ${poly.sentimentSummary.highConvictionCount}\n${poly.cryptoMarkets.slice(0, 5).map(m => `  "${m.question}" → ${(m.probability * 100).toFixed(1)}% YES | vol $${(m.volume24h / 1000).toFixed(0)}k | ${m.relevance}`).join('\n')}`);
      } else {
        contextParts.push(`## PREDICTION MARKETS (Polymarket)\nNo prediction market data available. Rely on on-chain data and price trends.`);
      }

      // MARKET CONDITIONS (live price trends from Jupiter feed)
      try {
        const { getMarketConditions } = await import('@/lib/price-feed');
        const conditions = getMarketConditions();
        if (conditions) {
          const tokenLines = conditions.tokenTrends.map(t =>
            `  ${t.symbol}: $${t.price.toFixed(4)} (${t.changePct30m >= 0 ? '+' : ''}${t.changePct30m.toFixed(2)}% 30m) ${t.trend}`
          ).join('\n');
          contextParts.push(`## MARKET CONDITIONS\nSOL: $${conditions.solPrice.toFixed(2)} (${conditions.sol30mChangePct >= 0 ? '+' : ''}${conditions.sol30mChangePct.toFixed(2)}% 30m) ${conditions.solTrend}\nVolatility: ${conditions.volatility}\nOverall: ${conditions.overallDirection}\n${tokenLines}`);
        }
      } catch {
        // price-feed import may fail on first load
      }

      // POSITION ALERTS (stop-loss warnings from trade guard)
      const guardForAlerts = tradeGuardRef.current;
      if (guardForAlerts) {
        const triggers = guardForAlerts.getStopLossTriggers();
        if (triggers.length > 0) {
          const alertLines = triggers.map(t =>
            `  ⚠ ${t.symbol}: down ${Math.abs(t.pnlPct).toFixed(1)}% from entry (current value: ${t.currentValueSol.toFixed(4)} SOL)`
          ).join('\n');
          contextParts.push(`## POSITION ALERTS\n${alertLines}\nConsider reducing or exiting these positions.`);
        }
      }

      // STRATEGY TREND (NEW)
      const memoryEntries = strategyMemoryRef.current;
      if (memoryEntries.length > 0) {
        const trendSummary = getStrategyTrendSummary(memoryEntries);
        const recentHistory = memoryEntries.slice(-5).map((e, i) => {
          const ago = Math.round((Date.now() - e.timestamp) / 60_000);
          return `  ${i + 1}. [${ago}m ago] ${e.sentiment} ${e.confidence}% — ${e.allocation}`;
        }).join('\n');
        contextParts.push(`## STRATEGY TREND\n${trendSummary}\n\n## RECENT ANALYSES\n${recentHistory}`);
      }

      // RISK LIMITS (NEW)
      const rl = currentDeps.vaultState?.riskLimits;
      if (rl) {
        contextParts.push(`## RISK LIMITS\nMax position: ${rl.maxPositionSizePct}%\nMax slippage: ${rl.maxSlippageBps}bps\nMax daily loss: ${rl.maxDailyLossPct}%\nMin SOL reserve: ${(rl.minSolReserve as any)?.toNumber?.() ? ((rl.minSolReserve as any).toNumber() / LAMPORTS_PER_SOL).toFixed(3) : rl.minSolReserve} SOL\nMax protocol exposure: ${rl.maxProtocolExposurePct}%`);
      }

      // SESSION CONTEXT (injected when trading session is active)
      const sp = sessionParamsRef.current;
      if (sp) {
        contextParts.push(`## ACTIVE SESSION\nBudget: ${sp.walletPct}% of portfolio\nStrategy: ${sp.strategy}${sp.focusTokens?.length ? `\nFocus tokens: ${sp.focusTokens.join(', ')}` : ''}`);
      }

      // TRADING MODE CONTEXT (tells LLM which strategies to suggest)
      const tradingMode = tradingModeRef.current;
      const tradingModeConfig = TRADING_MODES[tradingMode];
      if (tradingMode === 'perps') {
        // Get current simulated positions
        const positionsContext = formatSimulatedPositionsForLLM();
        const simPositions = getSimulatedPositions();
        const hasOpenPositions = simPositions.length > 0;

        contextParts.push(`## TRADING MODE: PERPS (Fast Perpetual Futures Trading)
${tradingModeConfig.description}

**CRITICAL: You are in PERPS MODE. You MUST ONLY suggest perpetual futures trades.**

${positionsContext}

ONLY USE THESE ACTIONS:
- "long" → Open a LONG position (bet price goes UP)
- "short" → Open a SHORT position (bet price goes DOWN)
- "close" → Close an existing position
- "hold" → Keep current positions, return empty allocation array

AVAILABLE MARKETS: SOL-PERP, ETH-PERP, BTC-PERP

${hasOpenPositions ? `**YOU ALREADY HAVE OPEN POSITIONS. Consider:**
- If profitable: hold or take profits (close)
- If losing: hold, cut losses (close), or average down
- Do NOT open duplicate positions in the same market` : `No open positions. Look for entry opportunities based on market conditions.`}

Use leverage 2-5x for safety. Set percentOfPortfolio as collateral amount.
Cycle time: ${tradingModeConfig.cycleIntervalMs / 1000}s — make quick, decisive calls.

**FORBIDDEN IN PERPS MODE: stake, lend, lp, loop, swap to mSOL/USDC/JLP. These are INVEST mode actions.**`);
      } else {
        contextParts.push(`## TRADING MODE: INVEST (Long-Term Yield)
${tradingModeConfig.description}
ALLOWED ACTIONS: ${tradingModeConfig.strategies.join(', ')}, sell, swap
Focus on DeFi yield strategies: staking, lending, liquidity provision.
Cycle time: ${tradingModeConfig.cycleIntervalMs / 60000}min — take time for thorough analysis.
DO NOT suggest perp-long, perp-short, or perp-close actions in INVEST mode.`);
      }

      const context = contextParts.join('\n\n');
      let analysisOk = false;

      // Check if local gateway is configured (non-empty endpoint)
      const hasLocalGateway = gateway.endpoint && gateway.endpoint.length > 0 && !gateway.endpoint.includes('localhost:1234');

      // 1) Try local model first ONLY if configured (skip to save time otherwise)
      if (hasLocalGateway) {
        try {
          const orientStart = Date.now();
          const fetchLocal = () =>
            fetch('/api/openclaw/analyze', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                context,
                gatewayUrl: gateway.endpoint,
                token: gateway.token || undefined,
                sessionId: 'makora-ooda',
              }),
            })
              .then(r => r.ok ? r.json() : null)
              .then(d => d ? { analysis: d.analysis as LLMAnalysisResult, model: (d.model || 'local') as string } : null)
              .catch(() => null);

          const responses = await Promise.all(Array.from({ length: CONSENSUS_CALLS }, fetchLocal));
          const consensus = resolveConsensus(responses);

          if (consensus) {
            const latencyMs = Date.now() - orientStart;
            confidence = consensus.consensusConfidence;
            llmOrientUpdate = {
              analysis: consensus.analysis,
              reasoning: consensus.analysis.marketAssessment.reasoning,
              provider: 'local',
              model: consensus.modelLabel,
              latencyMs,
              error: null,
            };

            const rawStr = consensus.rawConfidences.join('/');
            const validCount = responses.filter(r => r !== null).length;
            deps.addActivity({
              action: `Local LLM consensus (${validCount}/${CONSENSUS_CALLS}): ${consensus.analysis.marketAssessment.sentiment} — ${confidence}% [raw: ${rawStr}, agree: ${Math.round(consensus.agreement * 100)}%] (${(latencyMs / 1000).toFixed(1)}s)`,
              status: 'adapt',
            });
            analysisOk = true;
          } else {
            throw new Error('All local consensus calls failed');
          }
        } catch (gwErr: any) {
          deps.addActivity({ action: `Gateway failed: ${gwErr.message || 'unknown'} — trying cloud LLM...`, status: 'warning' });
        }
      }

      // 2) Use cloud LLM keys (primary path when no local gateway)
      if (!analysisOk && gateway.llmKeys) {
        // Pick first available key: anthropic > openai > qwen
        const providerOrder: Array<{ id: string; model: string }> = [
          { id: 'anthropic', model: 'claude-sonnet-4-20250514' },
          { id: 'openai', model: 'gpt-4o-mini' },
          { id: 'qwen', model: 'qwen-plus' },
        ];

        for (const prov of providerOrder) {
          const key = gateway.llmKeys[prov.id];
          if (!key || key.length === 0) continue;

          try {
            const orientStart = Date.now();
            const fetchCloud = () =>
              fetch('/api/llm/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  provider: prov.id,
                  apiKey: key,
                  model: prov.model,
                  temperature: 0.3,
                  context,
                }),
              })
                .then(r => r.ok ? r.json() : null)
                .then(d => d ? { analysis: d.analysis as LLMAnalysisResult, model: (d.model || prov.model) as string } : null)
                .catch(() => null);

            const responses = await Promise.all(Array.from({ length: CONSENSUS_CALLS }, fetchCloud));
            const consensus = resolveConsensus(responses);

            if (consensus) {
              const latencyMs = Date.now() - orientStart;
              confidence = consensus.consensusConfidence;
              llmOrientUpdate = {
                analysis: consensus.analysis,
                reasoning: consensus.analysis.marketAssessment.reasoning,
                provider: prov.id,
                model: consensus.modelLabel,
                latencyMs,
                error: null,
              };

              const rawStr = consensus.rawConfidences.join('/');
              const validCount = responses.filter(r => r !== null).length;
              deps.addActivity({
                action: `Cloud LLM consensus (${consensus.modelLabel}, ${validCount}/${CONSENSUS_CALLS}): ${consensus.analysis.marketAssessment.sentiment} — ${confidence}% [raw: ${rawStr}, agree: ${Math.round(consensus.agreement * 100)}%] (${(latencyMs / 1000).toFixed(1)}s)`,
                status: 'adapt',
              });
              analysisOk = true;
              break;
            }
          } catch {
            // try next provider
          }
        }
      }

      // 3) All failed → MoltBot requires LLM, HOLD with zero confidence
      if (!analysisOk) {
        const reason = 'All LLM sources failed — configure working LLM in Settings';
        llmOrientUpdate = {
          ...llmOrientUpdate,
          error: reason,
          analysis: null,
        };

        // CRITICAL: Zero confidence = no execution, MoltBot will HOLD
        confidence = 0;

        deps.addActivity({
          action: `HOLD: ${reason}`,
          status: 'error',
        });
      }

      // Record analysis in strategy memory
      if (llmOrientUpdate.analysis) {
        const analysis = llmOrientUpdate.analysis;
        const entry: StrategyMemoryEntry = {
          timestamp: Date.now(),
          sentiment: analysis.marketAssessment.sentiment,
          confidence: analysis.marketAssessment.confidence,
          allocation: analysis.allocation.map(a => `${a.token} ${a.percentOfPortfolio}%`).join(', '),
        };
        strategyMemoryRef.current = [...strategyMemoryRef.current, entry].slice(-MAX_MEMORY_ENTRIES);
        saveStrategyMemory(strategyMemoryRef.current);
      }
    } else {
      // No gateway configured — MoltBot requires LLM to make decisions
      const reason = 'No LLM configured — MoltBot requires AI to make decisions';
      llmOrientUpdate = {
        ...llmOrientUpdate,
        error: reason,
        analysis: null,
      };

      // CRITICAL: Zero confidence = no execution, MoltBot will HOLD
      confidence = 0;

      deps.addActivity({
        action: `HOLD: ${reason}`,
        status: 'error',
      });
    }

    // ── Extract + apply agent risk params ──────────────────────────────────
    let riskParamsUpdate: AgentRiskParams | null = null;
    const llmRisk = llmOrientUpdate.analysis?.riskParams;
    if (llmRisk) {
      // Clamp LLM values to safe ranges
      riskParamsUpdate = {
        maxPositionPct: Math.max(5, Math.min(40, llmRisk.maxPositionPct)),
        maxSlippageBps: Math.max(10, Math.min(500, llmRisk.maxSlippageBps)),
        dailyLossLimitPct: Math.max(1, Math.min(15, llmRisk.dailyLossLimitPct)),
        stopLossPct: Math.max(2, Math.min(20, llmRisk.stopLossPct)),
        source: 'agent',
      };
    } else if (currentDeps.vaultState?.riskLimits) {
      const rl = currentDeps.vaultState.riskLimits;
      riskParamsUpdate = {
        maxPositionPct: rl.maxPositionSizePct,
        maxSlippageBps: rl.maxSlippageBps,
        dailyLossLimitPct: rl.maxDailyLossPct,
        stopLossPct: 8, // vault doesn't have stop-loss, use sensible default
        source: 'vault',
      };
    } else {
      riskParamsUpdate = {
        maxPositionPct: 20,
        maxSlippageBps: 100,
        dailyLossLimitPct: 5,
        stopLossPct: 8,
        source: 'default',
      };
    }
    agentRiskParamsRef.current = riskParamsUpdate;

    // Apply to TradeGuard — also scale minTradeSizeSol to 1% of operating budget
    const guardForConfig = tradeGuardRef.current;
    if (guardForConfig?.setConfig) {
      const budgetRaw = observation.vaultBalance > 0 ? observation.vaultBalance : observation.totalPortfolio;
      const budget = Math.max(0, budgetRaw - cumulativeSpendRef.current);
      guardForConfig.setConfig({
        maxDailyLossPct: riskParamsUpdate.dailyLossLimitPct,
        stopLossPct: riskParamsUpdate.stopLossPct,
        minTradeSizeSol: Math.max(0.0001, budget * 0.01),
      });
    }

    deps.addActivity({
      action: `MoltBot risk params: maxPos ${riskParamsUpdate.maxPositionPct}%, slippage ${riskParamsUpdate.maxSlippageBps}bps, dailyLoss ${riskParamsUpdate.dailyLossLimitPct}%, stopLoss ${riskParamsUpdate.stopLossPct}% [${riskParamsUpdate.source}]`,
      status: 'adapt',
    });

    setState(prev => ({ ...prev, confidence, llmOrient: llmOrientUpdate, agentRiskParams: riskParamsUpdate }));
    deps.addActivity({
      action: `Strategy evaluation: ${confidence}% confidence`,
      status: 'adapt',
    });

    await sleep(fastDelay(1500));

    // ===== DECIDE =====
    setPhase('DECIDE');
    await sleep(fastDelay(600));

    const riskLimits = currentDeps.vaultState?.riskLimits;
    let riskScore = 3.0;
    const arp = agentRiskParamsRef.current;
    if (arp) {
      const positionRisk = arp.maxPositionPct / 100;
      const slippageRisk = arp.maxSlippageBps / 10000;
      const lossRisk = arp.dailyLossLimitPct / 100;
      riskScore = (positionRisk * 3 + slippageRisk * 2 + lossRisk * 5) * 10;
      riskScore = Math.min(10, Math.max(1, riskScore));
    } else if (riskLimits) {
      const positionRisk = riskLimits.maxPositionSizePct / 100;
      const slippageRisk = riskLimits.maxSlippageBps / 10000;
      const lossRisk = riskLimits.maxDailyLossPct / 100;
      riskScore = (positionRisk * 3 + slippageRisk * 2 + lossRisk * 5) * 10;
      riskScore = Math.min(10, Math.max(1, riskScore));
    }

    // Compute allocation — LLM-only, no hardcoded fallback
    const yields = yieldsRef.current;
    const llmAnalysis = llmOrientUpdate.analysis;
    let allocation: AllocationSlot[];
    let blendedApy: number;
    let stratLabel: string;

    // Get current trading mode for strategy filtering
    const currentTradingMode = tradingModeRef.current;
    const modeConfig = TRADING_MODES[currentTradingMode];

    if (llmAnalysis && llmAnalysis.allocation.length > 0) {
      // Map LLM allocation to AllocationSlot format with perps support
      const mapActionToTag = (action: string): StrategyTag => {
        if (action === 'sell') return 'sell';
        if (action === 'swap') return 'swap';
        if (action === 'stake') return 'stake';
        if (action === 'lend') return 'lend';
        if (action === 'lp') return 'lp';
        if (action === 'long' || action === 'perp-long') return 'perp-long';
        if (action === 'short' || action === 'perp-short') return 'perp-short';
        if (action === 'close' || action === 'perp-close') return 'perp-close';
        return 'lend'; // fallback
      };

      allocation = llmAnalysis.allocation.map(a => ({
        protocol: a.protocol,
        symbol: a.token,
        pct: a.percentOfPortfolio,
        expectedApy: 0, // LLM doesn't predict exact APY
        strategyTag: mapActionToTag(a.action),
        risk: (llmAnalysis.riskAssessment.overallRisk > 60 ? 'High' : llmAnalysis.riskAssessment.overallRisk > 30 ? 'Medium' : 'Low') as 'Low' | 'Medium' | 'High',
        leverage: (a as any).leverage || undefined, // Pass leverage for perps trades
      }));

      // Filter allocations to only include strategies allowed by current trading mode
      const preFilterCount = allocation.length;
      allocation = allocation.filter(a => {
        // Always allow sell/swap regardless of mode
        if (a.strategyTag === 'sell' || a.strategyTag === 'swap') return true;
        // Check if strategy is in allowed list for this mode
        return modeConfig.strategies.includes(a.strategyTag);
      });

      if (allocation.length < preFilterCount) {
        deps.addActivity({
          action: `Filtered ${preFilterCount - allocation.length} allocation(s) not matching ${currentTradingMode.toUpperCase()} mode`,
          status: 'adapt',
        });
      }

      // Try to enrich APY from yield data
      for (const slot of allocation) {
        const match = yields.find(y =>
          y.protocol.toLowerCase().includes(slot.protocol.toLowerCase()) ||
          y.symbol.toLowerCase() === slot.symbol.toLowerCase()
        );
        if (match) slot.expectedApy = match.apy;
      }

      blendedApy = computeBlendedApy(allocation);
      stratLabel = `AI ${llmAnalysis.marketAssessment.sentiment}`;
    } else if (llmOrientUpdate.error) {
      // LLM failed → HOLD with zero confidence, no hardcoded allocation
      allocation = [];
      blendedApy = 0;
      stratLabel = 'LLM REQUIRED';
      // confidence already set to 0 in ORIENT phase
    } else if (llmAnalysis && llmAnalysis.allocation.length === 0) {
      // LLM returned empty allocation intentionally → HOLD
      allocation = [];
      blendedApy = 0;
      stratLabel = 'AI HOLD';
    } else {
      // Fallback: no LLM analysis available → HOLD
      allocation = [];
      blendedApy = 0;
      stratLabel = 'WAITING';
    }

    // DRIFT DETECTION (NEW): skip execution if current allocation is close to target
    let driftSkip = false;
    if (allocation.length > 0 && observation.positions?.allocation) {
      const diff = computeAllocationDiff(
        observation.positions.allocation,
        allocation.map(a => ({ symbol: a.symbol, pct: a.pct, protocol: a.protocol, strategyTag: a.strategyTag })),
        3, // 3% drift threshold
      );
      if (!diff.needsRebalance) {
        driftSkip = true;
        deps.addActivity({
          action: `Portfolio within target (max drift ${diff.maxDrift.toFixed(1)}%) — skipping execution`,
          status: 'adapt',
        });
      }
    }

    let recommendation: string;
    let action: string;

    // Check LLM requirement first - MoltBot needs AI to make decisions
    if (llmOrientUpdate.error) {
      // LLM failed or not configured → HOLD, never execute without AI
      recommendation = `MoltBot requires LLM: ${llmOrientUpdate.error}`;
      action = 'hold';
    } else if (!currentDeps.vaultState) {
      // Vault not initialized
      recommendation = 'Initialize vault to enable on-chain management';
      action = 'init_vault';
    } else if (observation.walletBalance > 2 && observation.vaultBalance < 0.5) {
      recommendation = 'Deposit SOL into vault for managed allocation';
      action = 'deposit';
    } else if (driftSkip) {
      recommendation = 'Portfolio allocation within target — holding';
      action = 'hold';
    } else if (allocation.length > 0) {
      recommendation = `${stratLabel}: ${allocation.map(a => `${a.symbol} ${a.pct}%`).join(', ')} → ${blendedApy}% APY`;
      action = 'allocate';
    } else {
      // No allocation from LLM → AI recommends holding
      recommendation = stratLabel === 'AI HOLD' ? 'AI recommends holding current positions' : 'Maintain current allocation, risk within limits';
      action = 'hold';
    }

    const decision: DecisionData = { recommendation, confidence, riskScore, action, allocation, blendedApy };
    setState(prev => ({ ...prev, lastDecision: decision }));
    deps.addActivity({
      action: allocation.length > 0 && !driftSkip
        ? `${stratLabel} allocation: ${blendedApy}% blended APY (risk ${riskScore.toFixed(1)}/10)`
        : `Decision: ${recommendation} (risk ${riskScore.toFixed(1)}/10)`,
      status: confidence > 70 ? 'success' : 'warning',
    });

    await sleep(fastDelay(1000));

    // ===== ACT =====
    setPhase('ACT');
    await sleep(fastDelay(400));

    // ── AUTO TAKE-PROFIT (deterministic, no LLM needed) ─────────────────────
    // Check for profitable positions and close them automatically
    if (isPerps) {
      try {
        const positionsRes = await fetch(`/api/agent/positions?wallet=${deps.publicKey.toBase58()}`);
        if (positionsRes.ok) {
          const posData = await positionsRes.json();
          const perpPositions = posData.perpPositions || [];

          for (const pos of perpPositions) {
            const pnlPct = pos.unrealizedPnlPct ?? 0;
            // Auto TP threshold: 2% profit (covers fees with margin)
            const AUTO_TP_THRESHOLD = 2.0;
            // Auto SL threshold: -5% loss
            const AUTO_SL_THRESHOLD = -5.0;

            if (pnlPct >= AUTO_TP_THRESHOLD) {
              deps.addActivity({
                action: `AUTO-TP: ${pos.market} +${pnlPct.toFixed(1)}% — closing position`,
                status: 'success',
              });

              // Execute close via API
              await fetch('/api/agent/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  allocation: [{
                    protocol: 'Jupiter-Perps',
                    symbol: pos.market,
                    pct: 100,
                    expectedApy: 0,
                    strategyTag: 'perp-close',
                    risk: 'Low',
                  }],
                  walletPublicKey: deps.publicKey.toBase58(),
                  riskLimits: {
                    maxPositionSizePct: 100,
                    maxSlippageBps: 100,
                    maxDailyLossPct: 10,
                    minSolReserve: 0.01,
                    maxProtocolExposurePct: 100,
                  },
                  confidence: 100,
                  portfolioValueSol: observation?.totalPortfolio || 1,
                  tradingMode: 'perps',
                }),
              });
            } else if (pnlPct <= AUTO_SL_THRESHOLD) {
              deps.addActivity({
                action: `AUTO-SL: ${pos.market} ${pnlPct.toFixed(1)}% — cutting loss`,
                status: 'warning',
              });

              // Execute close via API
              await fetch('/api/agent/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  allocation: [{
                    protocol: 'Jupiter-Perps',
                    symbol: pos.market,
                    pct: 100,
                    expectedApy: 0,
                    strategyTag: 'perp-close',
                    risk: 'High',
                  }],
                  walletPublicKey: deps.publicKey.toBase58(),
                  riskLimits: {
                    maxPositionSizePct: 100,
                    maxSlippageBps: 100,
                    maxDailyLossPct: 10,
                    minSolReserve: 0.01,
                    maxProtocolExposurePct: 100,
                  },
                  confidence: 100,
                  portfolioValueSol: observation?.totalPortfolio || 1,
                  tradingMode: 'perps',
                }),
              });
            }
          }
        }
      } catch (e) {
        console.warn('Auto-TP check failed:', e);
      }
    }

    const latestDeps = depsRef.current;
    const latestVault = latestDeps.vaultState;
    const onChainAuto = latestVault && 'auto' in latestVault.mode;
    const isAutoMode = onChainAuto || localAutoModeRef.current;
    // Cap threshold at 55% so neutral-sentiment (60%) can still execute on demo
    const rawThreshold = currentDeps.strategyState?.confidenceThreshold ?? 45;
    const meetsThreshold = confidence >= Math.min(rawThreshold, 55);

    // ── TRADE GUARD CHECKS ──────────────────────────────────────────────────
    const guard = tradeGuardRef.current;

    // Check daily loss halt
    if (guard?.isDailyHalted()) {
      deps.addActivity({
        action: 'TRADE GUARD: Daily loss limit reached — all execution halted',
        status: 'error',
      });
      // Skip execution entirely, fall through to advisory logging
    }

    // Check stop-loss triggers — queue sell-back trades
    if (guard && !guard.isDailyHalted()) {
      const triggers = guard.getStopLossTriggers();
      for (const trigger of triggers) {
        deps.addActivity({
          action: `STOP-LOSS: ${trigger.symbol} down ${Math.abs(trigger.pnlPct).toFixed(1)}% — queuing sell`,
          status: 'warning',
        });
        // Force action to 'allocate' when stop-loss triggers (even if decision was "hold")
        decision.action = 'allocate';
        // Add a sell-back-to-SOL allocation to the front of the decision
        decision.allocation.unshift({
          protocol: 'Jupiter',
          symbol: trigger.symbol,
          pct: 100, // sell entire position
          expectedApy: 0,
          strategyTag: 'sell' as StrategyTag,
          risk: 'High',
        });
      }
    }

    // REAL EXECUTION: call /api/agent/execute when in Auto mode with sufficient confidence
    const currentSigningMode = signingModeRef.current;
    const guardBlocked = guard?.isDailyHalted() ?? false;
    const canExecute = !guardBlocked && isAutoMode && meetsThreshold && decision.action === 'allocate' && decision.allocation.length > 0;

    // Log why we can/can't execute (helps debug)
    if (!canExecute && isAutoMode) {
      const reasons: string[] = [];
      if (guardBlocked) reasons.push('daily limit halted');
      if (!meetsThreshold) reasons.push(`confidence ${confidence}% < threshold`);
      if (decision.action !== 'allocate') reasons.push(`action="${decision.action}" not allocate`);
      if (decision.allocation.length === 0) reasons.push('empty allocation');
      if (reasons.length > 0) {
        deps.addActivity({
          action: `Auto mode: skipping execution — ${reasons.join(', ')}`,
          status: 'warning',
        });
      }
    }

    if (canExecute) {
      deps.addActivity({
        action: `Auto mode (${currentSigningMode}): executing ${decision.allocation.length} allocation(s)...`,
        status: 'adapt',
      });

      try {
        // Pre-filter allocations through trade guard
        let guardedAllocation = decision.allocation;
        if (guard) {
          guardedAllocation = decision.allocation.filter(slot => {
            // Sells always pass — they return SOL, don't spend budget
            if (slot.strategyTag === 'sell') return true;

            const guardBudgetRaw = (observation?.vaultBalance ?? 0) > 0 ? observation!.vaultBalance : (observation?.totalPortfolio ?? 0);
            const guardBudget = Math.max(0, guardBudgetRaw - cumulativeSpendRef.current);
            const tradeSizeSol = (slot.pct / 100) * guardBudget;
            const veto = guard.vetTrade(slot.symbol, tradeSizeSol);
            if (!veto.allowed) {
              deps.addActivity({
                action: `GUARD VETOED: ${slot.symbol} ${slot.pct}% — ${veto.reason}`,
                status: 'warning',
              });
            }
            return veto.allowed;
          });
          if (guardedAllocation.length === 0) {
            deps.addActivity({
              action: 'All allocations vetoed by trade guard — skipping execution',
              status: 'warning',
            });
            // Fall through to advisory
          }
        }

        if (guardedAllocation.length === 0) {
          // Nothing to execute after guard filtering
          deps.addActivity({ action: 'OODA cycle complete (all trades guarded)', status: 'adapt' });
        }

        // ── STRICT BUDGET ENFORCEMENT ──────────────────────────────────────────
        // Compute the user's HARD budget limit (never exceed this)
        const rawBudget = observation.vaultBalance > 0
          ? observation.vaultBalance
          : observation.totalPortfolio;

        // Session budget: user-specified percentage OR full vault
        const sessionBudgetLimit = sessionParamsRef.current
          ? (sessionParamsRef.current.walletPct / 100) * rawBudget
          : rawBudget;

        // Remaining budget after cumulative spend
        const remainingBudget = Math.max(0, sessionBudgetLimit - cumulativeSpendRef.current);

        // Filter out BUY allocations if budget exhausted (sells always allowed)
        const hasSells = guardedAllocation.some(s => s.strategyTag === 'sell');
        const hasBuys = guardedAllocation.some(s => s.strategyTag !== 'sell');

        // HARD STOP: Block ALL buys when budget exhausted
        if (remainingBudget <= 0.001 && hasBuys) {
          deps.addActivity({
            action: `BUDGET EXHAUSTED: spent ${cumulativeSpendRef.current.toFixed(4)} of ${sessionBudgetLimit.toFixed(4)} SOL limit — blocking all buys`,
            status: 'error',
          });

          // Only keep sell orders, remove all buys
          guardedAllocation = guardedAllocation.filter(s => s.strategyTag === 'sell');

          if (guardedAllocation.length === 0) {
            deps.addActivity({
              action: 'No sells to process — skipping execution entirely',
              status: 'warning',
            });
            // Fall through to advisory logging
          }
        }

        // Use remaining budget for execution (capped at what's left)
        const effectiveBudget = remainingBudget;

        // Build risk limits from agent params (preferred) or vault/defaults
        const currentArp = agentRiskParamsRef.current;
        const configuredReserve = typeof riskLimits?.minSolReserve === 'object'
          ? ((riskLimits.minSolReserve as any)?.toNumber?.() ?? 50_000_000) / LAMPORTS_PER_SOL
          : riskLimits?.minSolReserve ?? 0.1;
        // Scale reserve proportionally for small budgets (cap at 10% of budget)
        const scaledReserve = effectiveBudget < 1
          ? Math.min(configuredReserve, effectiveBudget * 0.1)
          : configuredReserve;
        const execRiskLimits = {
          maxPositionSizePct: currentArp?.maxPositionPct ?? riskLimits?.maxPositionSizePct ?? 15,
          maxSlippageBps: currentArp?.maxSlippageBps ?? riskLimits?.maxSlippageBps ?? 100,
          maxDailyLossPct: currentArp?.dailyLossLimitPct ?? riskLimits?.maxDailyLossPct ?? 5,
          minSolReserve: scaledReserve,
          maxProtocolExposurePct: riskLimits?.maxProtocolExposurePct ?? 40,
        };

        // Clamp BUY allocation percentages to maxPositionSizePct (sells keep their pct as % of position)
        guardedAllocation = guardedAllocation.map(slot => ({
          ...slot,
          pct: slot.strategyTag === 'sell' ? slot.pct : Math.min(slot.pct, execRiskLimits.maxPositionSizePct),
        }));

        // PERPS MODE: automatically enable Jito for faster execution
        const isPerpsMode = tradingModeRef.current === 'perps';
        const useJitoForExec = jitoEnabledRef.current || isPerpsMode;
        const useJitoUrgent = jitoUrgentRef.current || isPerpsMode;

        // Allow execution if we have allocations to process
        const execRes = guardedAllocation.length > 0 ? await fetch('/api/agent/execute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            allocation: guardedAllocation,
            walletPublicKey: deps.publicKey.toBase58(),
            riskLimits: execRiskLimits,
            confidence,
            portfolioValueSol: effectiveBudget,
            signingMode: currentSigningMode,
            positions: observation.positions?.positions,
            // Budget enforcement: pass hard limit so API can double-check
            budgetLimitSol: sessionBudgetLimit,
            spentSol: cumulativeSpendRef.current,
            // Jito fast execution (~100ms faster, mainnet only)
            // Auto-enabled for PERPS mode for time-sensitive trades
            useJito: useJitoForExec,
            jitoUrgent: useJitoUrgent,
            // Trading mode for strategy filtering
            tradingMode: tradingModeRef.current,
          }),
        }) : null;

        if (execRes && execRes.ok) {
          const execData = await execRes.json();
          let results: ExecutionResultEntry[] = execData.results ?? [];

          // WALLET SIGNING: sign and send unsigned txs client-side
          if (currentSigningMode === 'wallet' && depsRef.current.signTransaction) {
            const signedResults: ExecutionResultEntry[] = [];

            // Check if Jito should be used (mainnet only)
            // Auto-enabled for PERPS mode for time-sensitive trades
            const network = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'devnet';
            const useJito = (jitoEnabledRef.current || isPerpsMode) && isJitoSupported(network);

            for (const result of results) {
              if (result.unsignedTx && result.success) {
                try {
                  deps.addActivity({
                    action: `Wallet approval needed: ${result.action}`,
                    status: 'adapt',
                  });

                  // Deserialize the unsigned transaction
                  const txBuf = Buffer.from(result.unsignedTx, 'base64');
                  const tx = VersionedTransaction.deserialize(new Uint8Array(txBuf));

                  // Sign with wallet adapter (Phantom popup)
                  const signedTx = await depsRef.current.signTransaction!(tx);

                  let signature: string;
                  let usedJito = false;

                  // ── JITO FAST EXECUTION (~100ms faster, mainnet only) ──────────
                  if (useJito) {
                    const jitoConfig = jitoUrgentRef.current ? URGENT_JITO_CONFIG : DEFAULT_JITO_CONFIG;
                    const jitoResult = await sendTransactionViaJito(signedTx, jitoConfig);

                    if (jitoResult.success && jitoResult.signature) {
                      signature = jitoResult.signature;
                      usedJito = true;
                      deps.addActivity({
                        action: `Jito fast-lane: ${result.action.slice(0, 30)}`,
                        status: 'adapt',
                      });
                    } else {
                      // Jito failed, fallback to standard RPC
                      console.warn('Jito failed, falling back to standard RPC:', jitoResult.error);
                      signature = await depsRef.current.connection.sendRawTransaction(
                        signedTx.serialize(),
                        { skipPreflight: false, maxRetries: 3 },
                      );
                    }
                  } else {
                    // Standard RPC send
                    signature = await depsRef.current.connection.sendRawTransaction(
                      signedTx.serialize(),
                      { skipPreflight: false, maxRetries: 3 },
                    );
                  }

                  // Confirm
                  await depsRef.current.connection.confirmTransaction(signature, 'confirmed');

                  signedResults.push({
                    ...result,
                    signature,
                    protocol: usedJito ? `${result.protocol}+jito` : result.protocol,
                    success: true,
                    unsignedTx: undefined,
                  });
                } catch (signErr) {
                  const errMsg = signErr instanceof Error ? signErr.message : 'Signing failed';
                  const isRejected = errMsg.includes('rejected') || errMsg.includes('User rejected');
                  signedResults.push({
                    ...result,
                    success: false,
                    error: isRejected ? 'User rejected transaction' : errMsg,
                    unsignedTx: undefined,
                  });
                }
              } else {
                signedResults.push(result);
              }
            }
            results = signedResults;
          }

          setState(prev => ({ ...prev, executionResults: results }));

          // Log each trade result on-chain + in activity feed
          for (const result of results) {
            // Log on-chain
            if (latestDeps.strategyState) {
              try {
                const execTag = result.simulated ? 'SIM' : (result.success ? 'OK' : 'FAIL');
                await latestDeps.logAction(
                  result.action.slice(0, 16),
                  result.protocol.slice(0, 16),
                  `${execTag} ${result.signature?.slice(0, 16) ?? 'no-sig'}`.slice(0, 64),
                  !result.simulated, // executed = true only for real trades
                  result.success,
                );
              } catch {
                // Non-critical: on-chain logging may fail
              }
            }

            // Activity feed
            const simTag = result.simulated ? ' [SIM]' : '';
            deps.addActivity({
              action: `${result.action} via ${result.protocol}: ${result.success ? 'SUCCESS' : 'FAILED'}${simTag}${result.error ? ` — ${result.error.slice(0, 60)}` : ''}`,
              status: result.success ? 'success' : 'error',
              txSig: result.signature,
            });

            // Record entry in trade guard for stop-loss tracking
            if (result.success && !result.simulated && guard) {
              // Extract target token from action description (e.g. "Stake 0.1 SOL -> mSOL via Marinade")
              const arrowMatch = result.action.match(/->\s*(\w+)/);
              const targetSymbol = arrowMatch ? arrowMatch[1] : result.action.split(' ')[0];
              const inputSol = result.quote ? parseFloat(result.quote.inputAmount) / 1e9 : 0;
              if (inputSol > 0) {
                // Pass pre-trade position value so P&L excludes pre-existing holdings
                const preTradeValue = observation.positions?.valueMap?.find(
                  v => v.symbol.toUpperCase() === targetSymbol.toUpperCase()
                )?.valueSol ?? 0;
                guard.recordEntry(targetSymbol, inputSol, preTradeValue);
              }
            }
          }

          // Track cumulative SOL spent to enforce vault budget cap
          const realTrades = results.filter(r => r.success && !r.simulated && r.signature);
          for (const rt of realTrades) {
            const solSpent = rt.quote ? parseFloat(rt.quote.inputAmount) / 1e9 : 0;
            if (solSpent > 0) cumulativeSpendRef.current += solSpent;
          }

          const realExecuted = realTrades.length;
          const simulated = results.filter(r => r.simulated).length;
          const remainingBudget = Math.max(0, rawBudget - cumulativeSpendRef.current);
          deps.addActivity({
            action: `Execution complete: ${realExecuted} executed, ${simulated} simulated, ${execData.totalVetoed} vetoed (budget: ${remainingBudget.toFixed(4)} SOL remaining)`,
            status: realExecuted > 0 ? 'success' : 'warning',
          });
        } else if (execRes) {
          const errData = await execRes.json().catch(() => ({ error: `HTTP ${execRes.status}` }));
          deps.addActivity({
            action: `Execution failed: ${errData.error || 'Unknown error'}`,
            status: 'error',
          });

          // Fallback: log advisory on-chain
          if (latestDeps.strategyState) {
            try {
              await latestDeps.logAction(decision.action, 'makora', decision.recommendation.slice(0, 64), false, true);
            } catch { /* non-critical */ }
          }
        }
      } catch (execErr) {
        deps.addActivity({
          action: `Execution error: ${execErr instanceof Error ? execErr.message : 'Network error'}`,
          status: 'error',
        });

        // Fallback: log advisory on-chain
        if (latestDeps.strategyState) {
          try {
            await latestDeps.logAction(decision.action, 'makora', decision.recommendation.slice(0, 64), false, true);
          } catch { /* non-critical */ }
        }
      }
    } else {
      // Advisory mode: log recommendation on-chain with executed = false
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
            action: isAutoMode && !meetsThreshold
              ? `Advisory (confidence ${confidence}% < threshold ${currentDeps.strategyState?.confidenceThreshold ?? 50}%)`
              : 'Action logged on-chain (advisory)',
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
    }

    // Update stealth session state from vault's in_session_amount
    const finalVault = depsRef.current.vaultState;
    const finalAutoMode = (finalVault && 'auto' in finalVault.mode) || localAutoModeRef.current;
    const inSessionLamports = (finalVault as any)?.inSessionAmount?.toNumber?.() ?? 0;
    const inSessionSol = inSessionLamports / 1_000_000_000;

    const sessionInfos: SessionInfo[] = inSessionSol > 0 ? [{
      id: 'vault-session',
      walletAddress: 'ephemeral',
      fundedAmount: inSessionSol,
      timeRemainingMs: 0,
      status: 'active',
      tradeCount: 0,
    }] : [];

    setState(prev => ({
      ...prev,
      adaptations: prev.adaptations + 1,
      stealthSessions: sessionInfos,
      totalInSession: inSessionSol,
      stealthActive: finalAutoMode === true && inSessionSol > 0,
    }));
  }, [setPhase]); // Only depends on setPhase which is stable

  // Stable ref for runCycle so startLoop never changes
  const runCycleRef = useRef(runCycle);
  useEffect(() => { runCycleRef.current = runCycle; }, [runCycle]);

  const startLoop = useCallback(() => {
    if (runningRef.current) return;
    runningRef.current = true;
    cumulativeSpendRef.current = 0; // Reset budget tracker for new session
    setState(prev => ({ ...prev, isRunning: true }));

    const loop = async () => {
      // Wait before first cycle so wallet adapter finishes its own RPC calls
      // PERPS mode: 2s, INVEST mode: 5s
      const initDelay = tradingModeRef.current === 'perps' ? 2000 : 5000;
      await sleep(initDelay);
      while (runningRef.current) {
        try {
          await runCycleRef.current();
        } catch (e) {
          console.warn('OODA cycle error (will retry):', e);
        }
        // Wait between cycles (configurable, default 60s) to avoid RPC rate limits
        await sleep(cycleIntervalRef.current);
      }
    };
    loop().catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep startLoopRef in sync so setAutoMode (defined earlier) can call it
  startLoopRef.current = startLoop;

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

  // DISABLED: Auto-start on wallet connect
  // MoltBot should NOT start automatically - user must explicitly start via chat or UI
  // This was causing unwanted trades when user simply connected their wallet
  useEffect(() => {
    // Only stop when wallet disconnects, NEVER auto-start
    if (!publicKey) stopLoop();
    return () => { runningRef.current = false; };
  }, [publicKey, stopLoop]);

  // Use on-chain cycle count if available
  const totalAdaptations = totalCycles > 0 ? totalCycles + state.adaptations : state.adaptations;

  // Computed auto mode: on-chain vault OR local toggle
  const isAutoMode = (vaultState && 'auto' in vaultState.mode) || localAutoModeRef.current;

  return {
    ...state,
    adaptations: totalAdaptations,
    isAutoMode,
    signingMode: signingModeRef.current,
    agentRiskParams: state.agentRiskParams,
    strategyState,
    initializeStrategy,
    runCycle,
    startLoop,
    stopLoop,
    setYields,
    setGateway,
    setPolymarketData,
    setAutoMode,
    setSigningMode,
    setTradeGuard,
    setSessionParams,
    setCycleInterval,
    // Jito fast execution (~100ms faster, mainnet only)
    jitoEnabled: jitoEnabledRef.current,
    jitoUrgent: jitoUrgentRef.current,
    setJitoEnabled,
    setJitoUrgent,
    // Trading mode: INVEST (long-term) vs PERPS (fast trading)
    tradingMode: tradingModeRef.current,
    tradingModeConfig: TRADING_MODES[tradingModeRef.current],
    setTradingMode,
  };
}

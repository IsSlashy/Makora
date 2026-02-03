import { randomUUID } from 'crypto';
import type { PublicKey, Keypair, Connection } from '@solana/web3.js';
import type {
  AgentMode,
  OODAPhase,
  PortfolioState,
  ExecutionResult,
  RiskAssessment,
  Position,
} from '@makora/types';
import type {
  AgentEvent,
  AgentEventHandler,
  DecisionCycleResult,
  ProposedAction,
  ValidatedAction,
  MarketData,
} from '@makora/types';
import type { StrategySignal } from '@makora/types';

import { PortfolioReader } from '@makora/data-feed';
import { JupiterPriceFeed } from '@makora/data-feed';
import { StrategyEngine, type StrategyEvaluation } from '@makora/strategy-engine';
import { RiskManager } from '@makora/risk-manager';
import { ExecutionEngine } from '@makora/execution-engine';
import { ProtocolRouter, type RouteRequest } from '@makora/protocol-router';
import type { SessionManager, StealthSession } from '@makora/session-manager';

import { ActionExplainer } from './explainer.js';
import { DecisionLog } from './decision-log.js';
import type { ConfirmationCallback, DecisionLogEntry } from './types.js';
import { parseLLMAnalysis, convertAnalysisToEvaluation } from './llm-orient.js';
import type { LLMAnalysis } from './llm-orient.js';

/**
 * OODA Loop (AGENT-04)
 *
 * The core decision cycle: Observe -> Orient -> Decide -> Act
 *
 * - OBSERVE: Fetch portfolio state, market data, positions
 * - ORIENT: Analyze market conditions, evaluate strategies
 * - DECIDE: Select best strategy signal, validate actions through risk manager
 * - ACT: Execute (auto mode) or present to user (advisory mode)
 *
 * The loop runs continuously on a timer. Each cycle is independent.
 * The loop can be paused, resumed, or run as a single cycle.
 */
/** Minimal LLM provider interface (avoids hard dep on @makora/llm-provider). */
interface LLMProviderLike {
  readonly providerId: string;
  readonly model: string;
  complete(
    messages: Array<{ role: string; content: string }>,
    options?: { jsonMode?: boolean; temperature?: number },
  ): Promise<{ content: string; latencyMs: number }>;
}

/** Minimal Polymarket feed interface. */
interface PolymarketFeedLike {
  getMarketIntelligence(): Promise<{
    cryptoMarkets: Array<{ question: string; probability: number; volume24h: number; priceChange24h: number; relevance: string }>;
    sentimentSummary: { overallBias: string; highConvictionCount: number; averageProbability: number };
    fetchedAt: number;
  }>;
}

export class OODALoop {
  // Dependencies
  private portfolioReader: PortfolioReader;
  private priceFeed: JupiterPriceFeed;
  private strategyEngine: StrategyEngine;
  private riskManager: RiskManager;
  private executionEngine: ExecutionEngine;
  private router: ProtocolRouter;
  private explainer: ActionExplainer;
  private decisionLog: DecisionLog;
  private sessionManager: SessionManager | null = null;

  // LLM + Polymarket (optional)
  private llmProvider: LLMProviderLike | null = null;
  private polymarketFeed: PolymarketFeedLike | null = null;
  private lastLLMAnalysis: LLMAnalysis | null = null;

  // State
  private walletPublicKey: PublicKey;
  private signer: Keypair;
  private mode: AgentMode;
  private vaultPDA: PublicKey | null = null;
  private currentPhase: OODAPhase = 'observe';
  private isRunning = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private cycleIntervalMs: number;

  // Cached state from last observation
  private lastPortfolio: PortfolioState | null = null;
  private lastMarketData: MarketData | null = null;
  private lastEvaluation: StrategyEvaluation | null = null;

  // Callbacks
  private eventHandlers: AgentEventHandler[] = [];
  private confirmationCallback: ConfirmationCallback | null = null;

  constructor(
    walletPublicKey: PublicKey,
    signer: Keypair,
    mode: AgentMode,
    cycleIntervalMs: number,
    portfolioReader: PortfolioReader,
    priceFeed: JupiterPriceFeed,
    strategyEngine: StrategyEngine,
    riskManager: RiskManager,
    executionEngine: ExecutionEngine,
    router: ProtocolRouter,
  ) {
    this.walletPublicKey = walletPublicKey;
    this.signer = signer;
    this.mode = mode;
    this.cycleIntervalMs = cycleIntervalMs;
    this.portfolioReader = portfolioReader;
    this.priceFeed = priceFeed;
    this.strategyEngine = strategyEngine;
    this.riskManager = riskManager;
    this.executionEngine = executionEngine;
    this.router = router;
    this.explainer = new ActionExplainer();
    this.decisionLog = new DecisionLog();
  }

  /**
   * Run a single OODA cycle. Returns the cycle result.
   *
   * This is the core method. The continuous loop calls this on each tick.
   * Can also be called directly for single-shot evaluation.
   */
  async runCycle(): Promise<DecisionCycleResult> {
    const cycleStart = Date.now();
    const cycleId = randomUUID();
    const phaseTimings: Record<string, number> = {};

    let proposedActions: ProposedAction[] = [];
    let approvedActions: ValidatedAction[] = [];
    let rejectedActions: ValidatedAction[] = [];
    let executionResults: ExecutionResult[] = [];
    let evaluation: StrategyEvaluation | null = null;

    try {
      // ====== OBSERVE ======
      this.setPhase('observe');
      const observeStart = Date.now();

      const portfolio = await this.portfolioReader.getPortfolio(this.walletPublicKey);
      this.lastPortfolio = portfolio;

      // Build market data from portfolio price info
      const marketData = this.buildMarketData(portfolio);
      this.lastMarketData = marketData;

      // Update risk manager with fresh portfolio
      this.riskManager.updatePortfolio(portfolio);

      // Fetch positions from all protocols
      const positions = await this.router.getAllPositions(this.walletPublicKey);
      this.riskManager.updatePositions(positions);

      phaseTimings.observe = Date.now() - observeStart;

      // ====== ORIENT ======
      this.setPhase('orient');
      const orientStart = Date.now();

      if (this.llmProvider) {
        // LLM-powered orientation
        try {
          const intelligence = await this.polymarketFeed?.getMarketIntelligence().catch(() => null);

          // Build context for the LLM
          const contextParts: string[] = [];
          contextParts.push(`## PORTFOLIO STATE\nTotal Value: $${portfolio.totalValueUsd.toFixed(2)}\nSOL Balance: ${portfolio.solBalance.toFixed(4)} SOL`);
          contextParts.push(`## MARKET DATA\nSOL Price: $${marketData.solPriceUsd.toFixed(2)}\n24h Change: ${marketData.solChange24hPct.toFixed(2)}%\nVolatility: ${marketData.volatilityIndex}/100`);

          if (intelligence) {
            const mkts = intelligence.cryptoMarkets.slice(0, 8).map(
              (m) => `  "${m.question}" → ${(m.probability * 100).toFixed(1)}% YES | Vol: $${m.volume24h.toLocaleString()}`
            ).join('\n');
            contextParts.push(`## PREDICTION MARKET SIGNALS\nBias: ${intelligence.sentimentSummary.overallBias}\n${mkts}`);
          }

          const context = contextParts.join('\n\n');
          const systemPrompt = `You are Makora, an autonomous DeFi agent on Solana. Analyze market data and output ONLY valid JSON with: marketAssessment (sentiment, confidence 0-100, reasoning, keyFactors), allocation (protocol, action, token, percentOfPortfolio, rationale — max 5, sum ≤100%), riskAssessment (overallRisk 0-100, warnings), explanation. Protocols: Jupiter/Marinade/Raydium/Kamino. Tokens: SOL/USDC/mSOL/JitoSOL/JLP.`;

          const response = await this.llmProvider.complete(
            [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: `Analyze:\n\n${context}` },
            ],
            { jsonMode: true, temperature: 0.3 },
          );

          const analysis = parseLLMAnalysis(response.content);
          this.lastLLMAnalysis = analysis;
          evaluation = convertAnalysisToEvaluation(analysis, marketData);
        } catch (llmErr) {
          // LLM failed — fall back to strategy engine
          this.emit({ type: 'error', message: `LLM ORIENT failed, using strategy engine fallback: ${llmErr}` });
          evaluation = this.strategyEngine.evaluate(portfolio, marketData);
        }
      } else {
        // Classic strategy engine orientation
        evaluation = this.strategyEngine.evaluate(portfolio, marketData);
      }

      this.lastEvaluation = evaluation;
      phaseTimings.orient = Date.now() - orientStart;

      // ====== DECIDE ======
      this.setPhase('decide');
      const decideStart = Date.now();

      // Get the recommended signal
      const signal = evaluation.recommended;
      proposedActions = signal.actions;

      // Emit proposed actions
      for (const action of proposedActions) {
        this.emit({ type: 'action_proposed', action });
      }

      // Validate each action through risk manager
      for (const action of proposedActions) {
        const assessment = await this.riskManager.validate(action);
        const validated: ValidatedAction = {
          ...action,
          riskAssessment: assessment,
          approved: assessment.approved,
        };

        if (assessment.approved) {
          approvedActions.push(validated);
          this.emit({ type: 'action_approved', action: validated });
        } else {
          rejectedActions.push(validated);
          this.emit({
            type: 'action_rejected',
            action: validated,
            reason: assessment.summary,
          });
        }
      }

      phaseTimings.decide = Date.now() - decideStart;

      // ====== ACT ======
      this.setPhase('act');
      const actStart = Date.now();

      if (approvedActions.length > 0) {
        if (this.mode === 'auto') {
          // Auto mode with stealth sessions: route trades through ephemeral wallets
          if (this.sessionManager) {
            // Rotate expired sessions before trading
            for (const expired of this.sessionManager.getExpiredSessions()) {
              this.emit({ type: 'session_rotating' as any, sessionId: expired.id });
              await this.sessionManager.rotateSession(expired.id);
            }

            // Start sessions if none active
            if (!this.sessionManager.hasActiveSession()) {
              const totalAmount = approvedActions.reduce((sum, a) => sum + (a.amount ?? 0), 0);
              if (totalAmount > 0) {
                const sessions = await this.sessionManager.startSession(totalAmount);
                for (const s of sessions) {
                  this.emit({ type: 'session_started' as any, session: s });
                }
              }
            }

            // Execute trades using session wallet as signer
            executionResults = await this.executeActionsWithSessions(approvedActions, portfolio);
          } else {
            // No session manager — direct execution (fallback)
            executionResults = await this.executeActions(approvedActions, portfolio);
          }
        } else {
          // Advisory mode: present to user and wait for confirmation
          if (this.confirmationCallback) {
            const explanation = this.explainer.explainSuggestion(
              signal,
              evaluation,
              portfolio,
            );

            const confirmed = await this.confirmationCallback(approvedActions, explanation);

            if (confirmed) {
              executionResults = await this.executeActions(approvedActions, portfolio);
            }
          }
          // If no confirmation callback, actions are just presented (no execution)
        }
      }

      phaseTimings.act = Date.now() - actStart;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', message: `OODA cycle failed: ${errorMessage}`, details: err });
    }

    const totalTime = Date.now() - cycleStart;

    // Build cycle result
    const result: DecisionCycleResult = {
      phase: this.currentPhase,
      proposedActions,
      approvedActions,
      rejectedActions,
      executionResults: executionResults.length > 0 ? executionResults : undefined,
      cycleTimeMs: totalTime,
      timestamp: Date.now(),
    };

    // Log the cycle
    this.logCycle(cycleId, result, evaluation, phaseTimings, totalTime);

    // Emit cycle completed
    this.emit({ type: 'cycle_completed', result });

    return result;
  }

  /**
   * Start the continuous OODA loop.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Run first cycle immediately
    this.runCycle().catch((err) => {
      this.emit({ type: 'error', message: `Cycle error: ${err}` });
    });

    // Then run on interval
    this.intervalHandle = setInterval(() => {
      if (this.isRunning) {
        this.runCycle().catch((err) => {
          this.emit({ type: 'error', message: `Cycle error: ${err}` });
        });
      }
    }, this.cycleIntervalMs);
  }

  /**
   * Stop the continuous OODA loop.
   */
  stop(): void {
    this.isRunning = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Get current OODA phase.
   */
  getPhase(): OODAPhase {
    return this.currentPhase;
  }

  /**
   * Get whether the loop is running.
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get the decision log.
   */
  getDecisionLog(): DecisionLog {
    return this.decisionLog;
  }

  /**
   * Get last portfolio snapshot.
   */
  getLastPortfolio(): PortfolioState | null {
    return this.lastPortfolio;
  }

  /**
   * Get last market data.
   */
  getLastMarketData(): MarketData | null {
    return this.lastMarketData;
  }

  /**
   * Get last strategy evaluation.
   */
  getLastEvaluation(): StrategyEvaluation | null {
    return this.lastEvaluation;
  }

  /**
   * Set the agent mode.
   */
  setMode(mode: AgentMode): void {
    this.mode = mode;
    this.emit({ type: 'mode_changed', mode });
  }

  /**
   * Get the agent mode.
   */
  getMode(): AgentMode {
    return this.mode;
  }

  /**
   * Register an event handler.
   */
  onEvent(handler: AgentEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Set the confirmation callback for advisory mode.
   */
  setConfirmationCallback(callback: ConfirmationCallback): void {
    this.confirmationCallback = callback;
  }

  /**
   * Set the session manager for stealth trading.
   * When set, auto-mode trades are routed through ephemeral session wallets.
   */
  setSessionManager(manager: SessionManager): void {
    this.sessionManager = manager;
  }

  /**
   * Get the session manager (if configured).
   */
  getSessionManager(): SessionManager | null {
    return this.sessionManager;
  }

  /**
   * Set the vault PDA for agent operations.
   */
  setVaultPDA(pda: PublicKey): void {
    this.vaultPDA = pda;
  }

  /**
   * Set the LLM provider for AI-powered ORIENT phase.
   * When set, the ORIENT phase will call the LLM instead of the strategy engine.
   */
  setLLMProvider(provider: LLMProviderLike): void {
    this.llmProvider = provider;
  }

  /**
   * Get the LLM provider (if configured).
   */
  getLLMProvider(): LLMProviderLike | null {
    return this.llmProvider;
  }

  /**
   * Set the Polymarket feed for prediction market intelligence.
   */
  setPolymarketFeed(feed: PolymarketFeedLike): void {
    this.polymarketFeed = feed;
  }

  /**
   * Get the last LLM analysis (if any).
   */
  getLastLLMAnalysis(): LLMAnalysis | null {
    return this.lastLLMAnalysis;
  }

  // ---- Private ----

  private setPhase(phase: OODAPhase): void {
    this.currentPhase = phase;
    this.emit({ type: 'cycle_started', phase });
  }

  private emit(event: AgentEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.warn('Event handler error:', err);
      }
    }
  }

  /**
   * Build a MarketData object from the current portfolio and price feed.
   * In production, this would also use Pyth WebSocket data.
   */
  private buildMarketData(portfolio: PortfolioState): MarketData {
    const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');
    const solPrice = solBalance?.priceUsd ?? 0;

    // Build prices map from portfolio
    const prices = new Map<string, number>();
    for (const balance of portfolio.balances) {
      if (balance.priceUsd > 0) {
        prices.set(balance.token.mint.toBase58(), balance.priceUsd);
      }
    }

    return {
      solPriceUsd: solPrice,
      solChange24hPct: 0, // Would come from a historical price API
      volatilityIndex: 30, // Default moderate; would come from Pyth or computed
      totalTvlUsd: 0, // Would come from protocol APIs
      timestamp: Date.now(),
      prices,
    };
  }

  /**
   * Execute a list of approved actions.
   */
  private async executeActions(
    actions: ValidatedAction[],
    prePortfolio: PortfolioState,
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    for (const action of actions) {
      try {
        // Route the action to get instructions
        const routeRequest: RouteRequest = {
          actionType: action.type,
          protocol: action.protocol,
          params: this.buildRouteParams(action),
        };

        const routeResult = await this.router.route(routeRequest);

        // Execute via the execution engine
        const result = await this.executionEngine.execute({
          instructions: routeResult.instructions,
          signer: this.signer,
          description: action.description,
          action,
        });

        results.push(result);

        // Record execution in risk manager
        const postPortfolio = await this.portfolioReader.getPortfolio(this.walletPublicKey);
        this.riskManager.recordExecution(
          result,
          prePortfolio.totalValueUsd,
          postPortfolio.totalValueUsd,
        );

        // Emit execution event
        this.emit({ type: 'action_executed', action, result });

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const failResult: ExecutionResult = {
          success: false,
          error: errorMsg,
          timestamp: Date.now(),
        };
        results.push(failResult);
        this.emit({ type: 'action_executed', action, result: failResult });
      }
    }

    return results;
  }

  /**
   * Execute actions through stealth session wallets.
   * Each trade is signed by an ephemeral keypair instead of the main signer.
   */
  private async executeActionsWithSessions(
    actions: ValidatedAction[],
    prePortfolio: PortfolioState,
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];
    if (!this.sessionManager) return results;

    for (const action of actions) {
      try {
        const sessionKeypair = this.sessionManager.getSessionKeypairForTrade(action.amount ?? 0);
        const signerToUse = sessionKeypair ?? this.signer;

        const routeRequest: RouteRequest = {
          actionType: action.type,
          protocol: action.protocol,
          params: this.buildRouteParams(action),
        };

        const routeResult = await this.router.route(routeRequest);

        const result = await this.executionEngine.execute({
          instructions: routeResult.instructions,
          signer: signerToUse,
          description: action.description,
          action,
        });

        results.push(result);

        // Record trade in session log
        if (sessionKeypair) {
          const session = this.sessionManager.findSessionByKeypair(sessionKeypair);
          if (session) {
            this.sessionManager.recordTrade(session.id, {
              signature: result.signature,
              action: action.type,
              amount: action.amount ?? 0,
              timestamp: Date.now(),
              success: result.success,
              error: result.error,
            });
          }
        }

        // Record execution in risk manager
        const postPortfolio = await this.portfolioReader.getPortfolio(this.walletPublicKey);
        this.riskManager.recordExecution(
          result,
          prePortfolio.totalValueUsd,
          postPortfolio.totalValueUsd,
        );

        this.emit({ type: 'action_executed', action, result });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const failResult: ExecutionResult = {
          success: false,
          error: errorMsg,
          timestamp: Date.now(),
        };
        results.push(failResult);
        this.emit({ type: 'action_executed', action, result: failResult });
      }
    }

    return results;
  }

  /**
   * Build RouteRequest params from a ProposedAction.
   * Maps the action's token/amount fields into the adapter's expected params.
   */
  private buildRouteParams(action: ProposedAction): RouteRequest['params'] {
    switch (action.type) {
      case 'swap':
        return {
          inputToken: action.inputToken.mint,
          outputToken: action.outputToken!.mint,
          amount: action.amount,
          maxSlippageBps: action.maxSlippageBps,
          userPublicKey: this.walletPublicKey,
        };

      case 'stake':
      case 'unstake':
        return {
          amount: action.amount,
          userPublicKey: this.walletPublicKey,
        };

      case 'deposit':
      case 'provide_liquidity':
        return {
          token: action.inputToken.mint,
          amount: action.amount,
          destination: action.outputToken?.mint ?? action.inputToken.mint,
          userPublicKey: this.walletPublicKey,
        };

      case 'withdraw':
      case 'remove_liquidity':
        return {
          token: action.inputToken.mint,
          amount: action.amount,
          source: action.outputToken?.mint ?? action.inputToken.mint,
          userPublicKey: this.walletPublicKey,
        };

      default:
        return {
          amount: action.amount,
          userPublicKey: this.walletPublicKey,
        };
    }
  }

  /**
   * Log a cycle to the decision log.
   */
  private logCycle(
    cycleId: string,
    result: DecisionCycleResult,
    evaluation: StrategyEvaluation | null,
    phaseTimings: Record<string, number>,
    totalTime: number,
  ): void {
    const entry: DecisionLogEntry = {
      cycleId,
      timestamp: Date.now(),
      mode: this.mode,
      phaseDurations: {
        observe: phaseTimings.observe ?? 0,
        orient: phaseTimings.orient ?? 0,
        decide: phaseTimings.decide ?? 0,
        act: phaseTimings.act ?? 0,
        total: totalTime,
      },
      portfolioSnapshot: {
        totalValueUsd: this.lastPortfolio?.totalValueUsd ?? 0,
        solBalance: this.lastPortfolio?.solBalance ?? 0,
        tokenCount: this.lastPortfolio?.balances.length ?? 0,
      },
      marketSummary: evaluation?.marketCondition.summary ?? 'N/A',
      strategySummary: evaluation?.recommended.explanation ?? 'N/A',
      proposedActions: result.proposedActions.map((a) => ({
        id: a.id,
        type: a.type,
        protocol: a.protocol,
        description: a.description,
      })),
      approvedActions: result.approvedActions.map((a) => ({
        id: a.id,
        riskScore: a.riskAssessment.riskScore,
        summary: a.riskAssessment.summary,
      })),
      rejectedActions: result.rejectedActions.map((a) => ({
        id: a.id,
        reason: a.riskAssessment.summary,
      })),
      executedActions: (result.executionResults ?? []).map((r, i) => ({
        id: result.approvedActions[i]?.id ?? `exec-${i}`,
        success: r.success,
        signature: r.signature,
        error: r.error,
      })),
      rationale: this.buildRationale(result, evaluation),
    };

    this.decisionLog.record(entry);
  }

  private buildRationale(
    result: DecisionCycleResult,
    evaluation: StrategyEvaluation | null,
  ): string {
    const parts: string[] = [];

    if (evaluation) {
      parts.push(`Market: ${evaluation.marketCondition.summary}`);
      parts.push(`Strategy: ${evaluation.recommended.strategyName} (confidence: ${evaluation.recommended.confidence}/100)`);
    }

    parts.push(`Proposed: ${result.proposedActions.length} action(s)`);
    parts.push(`Approved: ${result.approvedActions.length}`);
    parts.push(`Rejected: ${result.rejectedActions.length}`);

    if (result.executionResults) {
      const successes = result.executionResults.filter((r) => r.success).length;
      parts.push(`Executed: ${successes}/${result.executionResults.length} succeeded`);
    }

    return parts.join('. ') + '.';
  }
}

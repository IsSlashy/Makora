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

import { ActionExplainer } from './explainer.js';
import { DecisionLog } from './decision-log.js';
import type { ConfirmationCallback, DecisionLogEntry } from './types.js';

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

  // State
  private walletPublicKey: PublicKey;
  private signer: Keypair;
  private mode: AgentMode;
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

      evaluation = this.strategyEngine.evaluate(portfolio, marketData);
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
          // Auto mode: execute immediately
          executionResults = await this.executeActions(approvedActions, portfolio);
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

import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import type {
  AgentMode,
  OODAPhase,
  PortfolioState,
  RiskLimits,
} from '@makora/types';
import type {
  AgentEvent,
  AgentEventHandler,
  DecisionCycleResult,
  ProposedAction,
  ValidatedAction,
} from '@makora/types';

import { createConnection, PortfolioReader, JupiterPriceFeed, PolymarketFeed } from '@makora/data-feed';
import { StrategyEngine, type StrategyEvaluation } from '@makora/strategy-engine';
import { RiskManager } from '@makora/risk-manager';
import { ExecutionEngine } from '@makora/execution-engine';
import { ProtocolRouter, AdapterRegistry } from '@makora/protocol-router';

import { OODALoop } from './ooda-loop.js';
import { NLParser } from './nl-parser.js';
import { ActionExplainer } from './explainer.js';
import { DecisionLog } from './decision-log.js';
import type { AgentConfig, ConfirmationCallback, ParsedIntent, DecisionLogEntry } from './types.js';
import { DEFAULT_AGENT_CONFIG } from './types.js';
import type { LLMAnalysis } from './llm-orient.js';

/**
 * Makora Agent (AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05)
 *
 * The top-level agent class that ties the entire system together.
 * This is the primary interface for CLI and dashboard.
 *
 * Responsibilities:
 * - Initialize all subsystems (data feed, strategy engine, risk manager, etc.)
 * - Run the OODA loop (continuous or single-shot)
 * - Parse natural language commands
 * - Route user commands to the appropriate subsystem
 * - Emit events for external consumers (CLI, dashboard)
 *
 * Usage:
 *   const agent = new MakoraAgent(config);
 *   await agent.initialize(registry);
 *   agent.onEvent((event) => console.log(event));
 *   await agent.start(); // Start OODA loop
 *   // Or:
 *   const result = await agent.executeCommand("swap 10 SOL to USDC");
 */
export class MakoraAgent {
  // Core components
  private connection: Connection;
  private portfolioReader: PortfolioReader;
  private priceFeed: JupiterPriceFeed;
  private strategyEngine: StrategyEngine;
  private riskManager: RiskManager;
  private executionEngine: ExecutionEngine;
  private router!: ProtocolRouter;
  private oodaLoop!: OODALoop;

  // Utilities
  private nlParser: NLParser;
  private explainer: ActionExplainer;

  // Configuration
  private config: AgentConfig;
  private initialized = false;

  constructor(config: AgentConfig) {
    this.config = config;
    this.connection = config.connection;

    // Initialize core components
    this.portfolioReader = new PortfolioReader(this.connection, config.cluster);
    this.priceFeed = new JupiterPriceFeed();
    this.strategyEngine = new StrategyEngine();
    this.riskManager = new RiskManager(0, config.riskLimits);
    this.executionEngine = new ExecutionEngine(this.connection, {}, this.riskManager);

    // Initialize utilities
    this.nlParser = new NLParser();
    this.explainer = new ActionExplainer();
  }

  /**
   * Initialize the agent with a pre-configured adapter registry.
   *
   * The registry must already have adapters registered.
   * This separation allows the CLI/dashboard to configure adapters
   * before passing them to the agent.
   */
  async initialize(registry: AdapterRegistry): Promise<void> {
    if (this.initialized) {
      throw new Error('Agent is already initialized');
    }

    // Initialize the protocol router
    this.router = new ProtocolRouter(registry);

    // Initialize the adapter registry
    await registry.initialize({
      rpcUrl: this.config.rpcUrl,
      walletPublicKey: this.config.walletPublicKey,
    });

    // Wire up the execution engine with the risk manager
    this.executionEngine.setRiskValidator(this.riskManager);

    // Create the OODA loop
    this.oodaLoop = new OODALoop(
      this.config.walletPublicKey,
      this.config.signer,
      this.config.mode,
      this.config.cycleIntervalMs,
      this.portfolioReader,
      this.priceFeed,
      this.strategyEngine,
      this.riskManager,
      this.executionEngine,
      this.router,
    );

    // Wire up LLM provider if configured (uses OODALoop's provider-agnostic interface)
    if (this.config.llmConfig) {
      this.oodaLoop.setLLMProvider(this.createLLMProviderAdapter(this.config.llmConfig));
    }

    // Wire up Polymarket feed if enabled
    if (this.config.enablePolymarket !== false) {
      this.oodaLoop.setPolymarketFeed(new PolymarketFeed());
    }

    this.initialized = true;
  }

  /**
   * Start the continuous OODA loop.
   */
  start(): void {
    this.ensureInitialized();
    this.oodaLoop.start();
  }

  /**
   * Stop the OODA loop.
   */
  stop(): void {
    this.ensureInitialized();
    this.oodaLoop.stop();
  }

  /**
   * Run a single OODA cycle (without starting the continuous loop).
   */
  async runSingleCycle(): Promise<DecisionCycleResult> {
    this.ensureInitialized();
    return this.oodaLoop.runCycle();
  }

  /**
   * Execute a natural language command.
   *
   * Parses the command, determines the intent, and either:
   * - Executes an action (advisory: present + wait, auto: execute)
   * - Returns query results (portfolio, strategy)
   * - Changes agent configuration (mode switch)
   *
   * @returns A human-readable response string
   */
  async executeCommand(input: string): Promise<string> {
    this.ensureInitialized();

    const intent = this.nlParser.parse(input);

    switch (intent.type) {
      case 'swap':
        return this.handleSwapIntent(intent);
      case 'stake':
        return this.handleStakeIntent(intent);
      case 'unstake':
        return this.handleUnstakeIntent(intent);
      case 'portfolio':
        return this.handlePortfolioQuery(intent);
      case 'strategy':
        return this.handleStrategyQuery(intent);
      case 'mode':
        return this.handleModeSwitch(intent);
      case 'help':
        return this.handleHelp();
      case 'unknown':
        return `I don't understand "${intent.rawInput}". Type "help" for available commands.`;
      default:
        return 'Unrecognized command.';
    }
  }

  /**
   * Parse a natural language command without executing it.
   */
  parseCommand(input: string): ParsedIntent {
    return this.nlParser.parse(input);
  }

  // ---- Mode management ----

  /**
   * Get the current agent mode.
   */
  getMode(): AgentMode {
    return this.oodaLoop?.getMode() ?? this.config.mode;
  }

  /**
   * Set the agent mode.
   */
  setMode(mode: AgentMode): void {
    this.ensureInitialized();
    this.oodaLoop.setMode(mode);
  }

  // ---- Event system ----

  /**
   * Register an event handler.
   */
  onEvent(handler: AgentEventHandler): void {
    if (this.oodaLoop) {
      this.oodaLoop.onEvent(handler);
    }
  }

  /**
   * Set the confirmation callback for advisory mode.
   */
  setConfirmationCallback(callback: ConfirmationCallback): void {
    if (this.oodaLoop) {
      this.oodaLoop.setConfirmationCallback(callback);
    }
  }

  // ---- Accessors ----

  /**
   * Get the current OODA phase.
   */
  getPhase(): OODAPhase {
    return this.oodaLoop?.getPhase() ?? 'observe';
  }

  /**
   * Get whether the OODA loop is running.
   */
  isRunning(): boolean {
    return this.oodaLoop?.getIsRunning() ?? false;
  }

  /**
   * Get the last portfolio state.
   */
  getLastPortfolio(): PortfolioState | null {
    return this.oodaLoop?.getLastPortfolio() ?? null;
  }

  /**
   * Get the last strategy evaluation.
   */
  getLastEvaluation(): StrategyEvaluation | null {
    return this.oodaLoop?.getLastEvaluation() ?? null;
  }

  /**
   * Get the decision log.
   */
  getDecisionLog(): DecisionLog {
    return this.oodaLoop?.getDecisionLog() ?? new DecisionLog();
  }

  /**
   * Get the last LLM analysis (if LLM provider is configured).
   */
  getLastLLMAnalysis(): LLMAnalysis | null {
    return this.oodaLoop?.getLastLLMAnalysis() ?? null;
  }

  /**
   * Get risk manager snapshot.
   */
  getRiskSnapshot() {
    return this.riskManager.getRiskSnapshot();
  }

  /**
   * Update risk limits.
   */
  setRiskLimits(limits: Partial<RiskLimits>): void {
    this.riskManager.setLimits(limits);
  }

  /**
   * Get portfolio directly (without waiting for OODA cycle).
   */
  async getPortfolio(): Promise<PortfolioState> {
    return this.portfolioReader.getPortfolio(this.config.walletPublicKey);
  }

  /**
   * Get the strategy engine.
   */
  getStrategyEngine(): StrategyEngine {
    return this.strategyEngine;
  }

  /**
   * Get the NL parser (for testing/inspection).
   */
  getNLParser(): NLParser {
    return this.nlParser;
  }

  /**
   * Get the explainer.
   */
  getExplainer(): ActionExplainer {
    return this.explainer;
  }

  // ---- Intent handlers ----

  private async handleSwapIntent(
    intent: Extract<ParsedIntent, { type: 'swap' }>
  ): Promise<string> {
    const portfolio = await this.getPortfolio();
    const fromBalance = portfolio.balances.find(
      (b) => b.token.symbol.toUpperCase() === intent.fromToken
    );

    if (!fromBalance) {
      return `You don't have any ${intent.fromToken} in your portfolio.`;
    }

    // Calculate amount
    let rawAmount: bigint;
    if (intent.amountIsPercent) {
      rawAmount = (fromBalance.rawBalance * BigInt(Math.floor(intent.amount))) / 100n;
    } else {
      rawAmount = BigInt(Math.floor(intent.amount * (10 ** fromBalance.token.decimals)));
    }

    if (rawAmount <= 0n) {
      return `Invalid amount for ${intent.fromToken}.`;
    }

    if (rawAmount > fromBalance.rawBalance) {
      return `Insufficient ${intent.fromToken}. You have ${fromBalance.uiBalance.toFixed(4)} ${intent.fromToken}.`;
    }

    // For advisory mode, describe what would happen
    const amountStr = intent.amountIsPercent
      ? `${intent.amount}% of ${intent.fromToken}`
      : `${intent.amount} ${intent.fromToken}`;

    return (
      `Swap: ${amountStr} -> ${intent.toToken}\n` +
      `Protocol: Jupiter (optimal routing)\n` +
      `Amount: ${(Number(rawAmount) / (10 ** fromBalance.token.decimals)).toFixed(4)} ${intent.fromToken}\n` +
      `Slippage: 0.5% max\n` +
      `\nIn advisory mode, run the OODA cycle to get a full strategy evaluation ` +
      `or switch to auto mode for immediate execution.`
    );
  }

  private async handleStakeIntent(
    intent: Extract<ParsedIntent, { type: 'stake' }>
  ): Promise<string> {
    const portfolio = await this.getPortfolio();
    const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');

    if (!solBalance || solBalance.rawBalance <= BigInt(50_000_000)) {
      return 'Insufficient SOL balance for staking (need to keep 0.05 SOL for gas).';
    }

    let rawAmount: bigint;
    if (intent.amountIsPercent) {
      rawAmount = (solBalance.rawBalance * BigInt(Math.floor(intent.amount))) / 100n;
    } else {
      rawAmount = BigInt(Math.floor(intent.amount * 1e9));
    }

    // Reserve gas
    const maxStake = solBalance.rawBalance - BigInt(50_000_000);
    if (rawAmount > maxStake) {
      rawAmount = maxStake;
    }

    const solAmount = Number(rawAmount) / 1e9;

    return (
      `Stake: ${solAmount.toFixed(4)} SOL via Marinade\n` +
      `You will receive: ~${solAmount.toFixed(4)} mSOL\n` +
      `Expected APY: ~7.2%\n` +
      `mSOL is liquid -- you can unstake anytime.\n` +
      `Risk: Very low (liquid staking, audited protocol)`
    );
  }

  private async handleUnstakeIntent(
    intent: Extract<ParsedIntent, { type: 'unstake' }>
  ): Promise<string> {
    const portfolio = await this.getPortfolio();
    const msolBalance = portfolio.balances.find(
      (b) => b.token.symbol.toUpperCase() === 'MSOL'
    );

    if (!msolBalance || msolBalance.rawBalance <= 0n) {
      return 'You don\'t have any mSOL to unstake.';
    }

    let rawAmount: bigint;
    if (intent.amountIsPercent) {
      rawAmount = (msolBalance.rawBalance * BigInt(Math.floor(intent.amount))) / 100n;
    } else {
      rawAmount = BigInt(Math.floor(intent.amount * 1e9));
    }

    if (rawAmount > msolBalance.rawBalance) {
      rawAmount = msolBalance.rawBalance;
    }

    const msolAmount = Number(rawAmount) / 1e9;

    return (
      `Unstake: ${msolAmount.toFixed(4)} mSOL via Marinade\n` +
      `You will receive: ~${msolAmount.toFixed(4)} SOL\n` +
      `Note: Instant unstake may have a small fee (~0.3%).`
    );
  }

  private async handlePortfolioQuery(
    intent: Extract<ParsedIntent, { type: 'portfolio' }>
  ): Promise<string> {
    const portfolio = await this.getPortfolio();
    const lines: string[] = [];

    lines.push(`Portfolio Value: $${portfolio.totalValueUsd.toFixed(2)}`);
    lines.push(`SOL Balance: ${portfolio.solBalance.toFixed(4)} SOL`);
    lines.push('');
    lines.push('Holdings:');

    for (const balance of portfolio.balances) {
      if (balance.uiBalance > 0) {
        lines.push(
          `  ${balance.token.symbol}: ${balance.uiBalance.toFixed(4)} ($${balance.usdValue.toFixed(2)})`
        );
      }
    }

    return lines.join('\n');
  }

  private async handleStrategyQuery(
    intent: Extract<ParsedIntent, { type: 'strategy' }>
  ): Promise<string> {
    if (intent.query === 'current') {
      const evaluation = this.getLastEvaluation();
      if (!evaluation) {
        return 'No strategy evaluation available. Run an OODA cycle first.';
      }

      const signal = evaluation.recommended;
      return (
        `Current Strategy: ${signal.strategyName}\n` +
        `Type: ${signal.type}\n` +
        `Confidence: ${signal.confidence}/100\n` +
        `Expected APY: ${signal.expectedApy?.toFixed(1) ?? 'N/A'}%\n` +
        `Risk Score: ${signal.riskScore}/100\n` +
        `\n${signal.explanation}`
      );
    }

    if (intent.query === 'opportunities') {
      const evaluation = this.getLastEvaluation();
      if (!evaluation || evaluation.yieldOpportunities.length === 0) {
        return 'No yield opportunities available. Run an OODA cycle first.';
      }

      const lines = ['Yield Opportunities:'];
      for (const op of evaluation.yieldOpportunities) {
        lines.push(`  ${op.description}`);
      }
      return lines.join('\n');
    }

    if (intent.query === 'rebalance') {
      const portfolio = await this.getPortfolio();
      const rebalancer = this.strategyEngine.getRebalancer();
      const table = rebalancer.getAllocationTable(portfolio);

      if (table.length === 0) {
        return 'No allocation data available.';
      }

      const lines = ['Portfolio Allocation:'];
      for (const entry of table) {
        const target = entry.targetPct !== undefined ? ` (target: ${entry.targetPct}%)` : '';
        lines.push(
          `  ${entry.token.symbol}: ${entry.currentPct.toFixed(1)}%${target} -- $${entry.usdValue.toFixed(2)}`
        );
      }

      const needsRebalance = rebalancer.needsRebalance(portfolio);
      lines.push('');
      lines.push(needsRebalance
        ? 'Rebalancing recommended. Run OODA cycle for specific actions.'
        : 'Portfolio is within target allocation. No rebalancing needed.'
      );

      return lines.join('\n');
    }

    return 'Unknown strategy query.';
  }

  private handleModeSwitch(
    intent: Extract<ParsedIntent, { type: 'mode' }>
  ): string {
    const currentMode = this.getMode();

    if (currentMode === intent.mode) {
      return `Already in ${intent.mode} mode.`;
    }

    this.setMode(intent.mode);

    if (intent.mode === 'auto') {
      return (
        `Switched to AUTO mode.\n` +
        `The agent will now execute approved actions automatically within your risk limits.\n` +
        `Current limits: max position ${this.config.riskLimits.maxPositionSizePct}%, ` +
        `max slippage ${this.config.riskLimits.maxSlippageBps}bps, ` +
        `max daily loss ${this.config.riskLimits.maxDailyLossPct}%.\n` +
        `To return to advisory mode: "switch to advisory mode"`
      );
    } else {
      return (
        `Switched to ADVISORY mode.\n` +
        `The agent will suggest actions but wait for your confirmation before executing.`
      );
    }
  }

  private handleHelp(): string {
    const examples = this.nlParser.getExamples();
    return (
      `Makora Agent Commands:\n\n` +
      examples.map((e) => `  ${e}`).join('\n') +
      `\n\nCurrent mode: ${this.getMode()}\n` +
      `OODA loop: ${this.isRunning() ? 'running' : 'stopped'}`
    );
  }

  /**
   * Create an LLM provider adapter from config (avoids importing @makora/llm-provider).
   * The OODALoop only needs { providerId, model, complete, ping }.
   */
  private createLLMProviderAdapter(cfg: NonNullable<AgentConfig['llmConfig']>) {
    const isAnthropic = cfg.providerId === 'anthropic';
    const baseUrl = cfg.baseUrl ??
      (isAnthropic
        ? 'https://api.anthropic.com'
        : cfg.providerId === 'qwen'
          ? 'https://dashscope.aliyuncs.com/compatible-mode'
          : 'https://api.openai.com');

    return {
      providerId: cfg.providerId,
      model: cfg.model,
      async complete(
        messages: Array<{ role: string; content: string }>,
        options?: { jsonMode?: boolean; temperature?: number },
      ) {
        const start = Date.now();
        const temp = options?.temperature ?? cfg.temperature ?? 0.3;
        const maxTokens = cfg.maxTokens ?? 4096;

        let url: string;
        let headers: Record<string, string>;
        let body: Record<string, unknown>;

        if (isAnthropic) {
          url = `${baseUrl}/v1/messages`;
          headers = { 'Content-Type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01' };
          const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
          const chat = messages.filter(m => m.role !== 'system');
          body = { model: cfg.model, max_tokens: maxTokens, temperature: temp, messages: chat };
          if (system) (body as any).system = system;
        } else {
          url = `${baseUrl}/v1/chat/completions`;
          headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` };
          body = { model: cfg.model, max_tokens: maxTokens, temperature: temp, messages };
          if (options?.jsonMode) body.response_format = { type: 'json_object' };
        }

        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        if (!res.ok) throw new Error(`LLM API ${res.status}`);
        const data = await res.json();

        const content = isAnthropic
          ? (data.content?.map((b: any) => b.text || '').join('') ?? '')
          : (data.choices?.[0]?.message?.content ?? '');

        return { content, latencyMs: Date.now() - start };
      },
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'Agent is not initialized. Call agent.initialize(registry) first.'
      );
    }
  }
}

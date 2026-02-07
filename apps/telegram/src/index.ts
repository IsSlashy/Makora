/**
 * Makora Telegram Bot — Intelligent DeFi Agent
 *
 * Full LLM integration with tool execution, inline keyboards,
 * proactive alerts, and conversational memory.
 */

import { Bot, session } from 'grammy';
import { config as loadDotenv } from 'dotenv';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SolanaCluster, AgentMode, RiskLimits } from '@makora/types';
import { createConnection, PortfolioReader, JupiterPriceFeed, findTokenBySymbol, type ConnectionConfig } from '@makora/data-feed';
import { MakoraAgent, type AgentConfig } from '@makora/agent-core';
import { StrategyEngine } from '@makora/strategy-engine';
import { AdapterRegistry } from '@makora/protocol-router';
import { JupiterAdapter } from '@makora/adapters-jupiter';
import { MarinadeAdapter } from '@makora/adapters-marinade';
import { PrivacyAdapter } from '@makora/adapters-privacy';

import { type MakoraContext, type SessionData, initialSession, pushChatHistory } from './session.js';
import { callLLMWithTools, type LLMConfig } from './llm.js';
import {
  tradeConfirmKeyboard,
  oodaApproveKeyboard,
  strategySelectKeyboard,
  tradingModeKeyboard,
  alertsKeyboard,
  miniAppKeyboard,
  mainMenuKeyboard,
  settingsInlineKeyboard,
  autoModeKeyboard,
} from './keyboards.js';
import {
  registerUserChat,
  setUserAlerts,
  isUserAlertsEnabled,
  registerAlertHandlers,
  resolveOODA,
} from './alerts.js';
import { getSimulatedPositions, formatSimulatedPositionsForLLM } from './simulated-perps.js';
import { executeTool, type ToolExecutionContext } from './tools.js';
import { analyzeSentiment } from './sentiment.js';
import { startAutonomousScan, stopAutonomousScan, startNewsMonitor, stopNewsMonitor, runSingleScan } from './autonomous.js';
import { fetchCryptoNews, formatNewsForDisplay } from './social-feed.js';

// Load env
loadDotenv();

// ============================================================================
// Globals
// ============================================================================

let agent: MakoraAgent | null = null;
let connection: Connection;
let wallet: Keypair;
let cluster: SolanaCluster;
let llmConfig: LLMConfig | null = null;

// ============================================================================
// Safe Markdown Reply (fallback to plain text on parse error)
// ============================================================================

function escapeMarkdown(text: string): string {
  // Strip markdown entities that Telegram can't parse rather than escaping
  return text.replace(/[*_`\[]/g, '');
}

async function safeReply(
  ctx: MakoraContext,
  text: string,
  opts?: Record<string, unknown>,
): Promise<void> {
  try {
    await ctx.reply(text, { parse_mode: 'Markdown', ...opts } as any);
  } catch {
    // Markdown parse failed — retry as plain text
    try {
      await ctx.reply(escapeMarkdown(text), opts as any);
    } catch {
      // Last resort
      await ctx.reply(text.slice(0, 4000)).catch(() => {});
    }
  }
}

// ============================================================================
// Initialize
// ============================================================================

function loadLLMConfig(): LLMConfig | null {
  const provider = (process.env.LLM_PROVIDER || '').toLowerCase();
  const apiKey = process.env.LLM_API_KEY || '';

  if (!apiKey || !['anthropic', 'openai', 'qwen'].includes(provider)) {
    return null;
  }

  return {
    provider: provider as 'anthropic' | 'openai' | 'qwen',
    apiKey,
    model: process.env.LLM_MODEL || undefined,
  };
}

async function initializeAgent(): Promise<void> {
  cluster = (process.env.SOLANA_NETWORK || 'devnet') as SolanaCluster;

  const connectionConfig: ConnectionConfig = {
    cluster,
    heliusApiKey: process.env.HELIUS_API_KEY,
    customRpcUrl: process.env.SOLANA_RPC_URL,
  };

  connection = createConnection(connectionConfig);

  // Load wallet
  const walletPath = process.env.WALLET_PATH || resolve(
    process.env.HOME || process.env.USERPROFILE || '~',
    '.config', 'solana', 'id.json'
  );

  const raw = readFileSync(walletPath, 'utf-8');
  wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));

  const rpcUrl = process.env.SOLANA_RPC_URL || `https://api.${cluster}.solana.com`;

  const riskLimits: RiskLimits = {
    maxPositionSizePct: 25,
    maxSlippageBps: 100,
    maxDailyLossPct: 5,
    minSolReserve: 0.05,
    maxProtocolExposurePct: 50,
  };

  const agentConfig: AgentConfig = {
    connection,
    signer: wallet,
    walletPublicKey: wallet.publicKey,
    cluster,
    mode: 'advisory' as AgentMode,
    riskLimits,
    cycleIntervalMs: 30_000,
    autoStart: false,
    rpcUrl,
  };

  agent = new MakoraAgent(agentConfig);

  const registry = new AdapterRegistry();
  registry.register(new JupiterAdapter());
  registry.register(new MarinadeAdapter());
  registry.register(new PrivacyAdapter());

  await agent.initialize(registry);

  // Load LLM config
  llmConfig = loadLLMConfig();

  console.log('[Makora] Agent initialized with Jupiter + Marinade + Privacy');
  console.log(`[Makora] LLM: ${llmConfig ? `${llmConfig.provider} (${llmConfig.model || 'default'})` : 'disabled (no LLM_API_KEY)'}`);
}

// ============================================================================
// Bot Setup
// ============================================================================

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN not set in environment');
  process.exit(1);
}

const bot = new Bot<MakoraContext>(token);

// Intercept Markdown parse failures and retry without parse_mode
bot.api.config.use(async (prev, method, payload, signal) => {
  const result = await prev(method, payload, signal);
  if (
    !result.ok &&
    result.error_code === 400 &&
    typeof result.description === 'string' &&
    result.description.includes("can't parse entities")
  ) {
    // Strip parse_mode and retry as plain text
    const cleaned = { ...payload } as Record<string, unknown>;
    delete cleaned.parse_mode;
    if (typeof cleaned.text === 'string') {
      cleaned.text = cleaned.text.replace(/[*_`\[]/g, '');
    }
    return prev(method, cleaned as any, signal);
  }
  return result;
});

bot.use(session({
  initial: initialSession,
}));

// Global error handler
bot.catch((err) => {
  console.error('[Bot] Error:', err);
});

// ============================================================================
// Helper: get tool execution context
// ============================================================================

async function getToolCtx(): Promise<ToolExecutionContext> {
  let walletSolBalance = 0;
  try {
    const lamports = await connection.getBalance(wallet.publicKey);
    walletSolBalance = lamports / LAMPORTS_PER_SOL;
  } catch {
    // will be 0
  }
  return { connection, wallet, walletSolBalance };
}

// ============================================================================
// Commands
// ============================================================================

bot.command('start', async (ctx) => {
  // Register user for alerts
  if (ctx.from) {
    registerUserChat(ctx.from.id, ctx.chat.id);
  }

  const llmStatus = llmConfig ? `LLM: *${llmConfig.provider}*` : 'LLM: _disabled_';

  // Send welcome with persistent menu keyboard
  await ctx.reply(
    `*Makora - Autonomous DeFi Trading Agent*\n\n` +
    `I'm an intelligent trading agent for Solana. Talk to me in natural language or use the buttons below!\n\n` +
    `*What I can do:*\n` +
    `- Open/close leveraged perp positions (SOL, ETH, BTC)\n` +
    `- Swap tokens on-chain via Jupiter\n` +
    `- Real-time market sentiment from 6 live sources\n` +
    `- Run autonomous OODA trading cycles\n\n` +
    `*Try saying:*\n` +
    `"What's my portfolio?"\n` +
    `"Open a 5x long on SOL"\n` +
    `"Scan the market for me"\n\n` +
    `_Wallet: \`${wallet.publicKey.toBase58().slice(0, 8)}...${wallet.publicKey.toBase58().slice(-4)}\`_\n` +
    `_Network: ${cluster} | ${llmStatus}_`,
    { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
  );

  // Also send the dashboard button as a separate inline message
  await ctx.reply('Open the full dashboard:', {
    reply_markup: miniAppKeyboard(wallet.publicKey.toBase58(), ctx.chat.id),
  });
});

bot.command('menu', async (ctx) => {
  await ctx.reply('Menu activated. Use the buttons below:', {
    reply_markup: mainMenuKeyboard(),
  });
});

bot.command('app', async (ctx) => {
  if (ctx.from) registerUserChat(ctx.from.id, ctx.chat.id);
  await ctx.reply('Open the Makora dashboard:', {
    reply_markup: miniAppKeyboard(wallet.publicKey.toBase58(), ctx.chat.id),
  });
});

bot.command('status', async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized. Please wait...');
    return;
  }

  // If LLM is available, use it for a richer response
  if (llmConfig) {
    try {
      const result = await callLLMWithTools(
        llmConfig,
        'Show me my portfolio status with balances and positions.',
        ctx.session,
        connection,
        wallet,
      );
      if (result) {
        pushChatHistory(ctx.session, 'user', '/status');
        pushChatHistory(ctx.session, 'assistant', result.content);
        await ctx.reply(result.content, { parse_mode: 'Markdown' });
        return;
      }
    } catch {
      // Fallback to basic mode
    }
  }

  // Fallback: basic status
  try {
    const reader = new PortfolioReader(connection, cluster);
    const portfolio = await reader.getPortfolio(wallet.publicKey);

    let msg = `*Portfolio Status*\n\n`;
    msg += `Wallet: \`${wallet.publicKey.toBase58().slice(0, 8)}...${wallet.publicKey.toBase58().slice(-4)}\`\n`;
    msg += `Total Value: *$${portfolio.totalValueUsd.toFixed(2)}*\n\n`;

    msg += `*Balances:*\n`;
    for (const balance of portfolio.balances) {
      const pct = portfolio.totalValueUsd > 0
        ? (balance.usdValue / portfolio.totalValueUsd * 100).toFixed(1)
        : '0';
      msg += `  ${balance.token.symbol}: ${balance.uiBalance.toFixed(4)} ($${balance.usdValue.toFixed(2)}) [${pct}%]\n`;
    }

    // Add positions summary
    const positions = getSimulatedPositions();
    if (positions.length > 0) {
      msg += `\n*Open Positions:* ${positions.length}\n`;
      for (const p of positions) {
        const pnlSign = (p.unrealizedPnlPct ?? 0) >= 0 ? '+' : '';
        msg += `  ${p.side.toUpperCase()} ${p.market} ${p.leverage}x: ${pnlSign}${(p.unrealizedPnlPct ?? 0).toFixed(2)}%\n`;
      }
    }

    msg += `\n_Updated: ${new Date().toLocaleTimeString()}_`;
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command('positions', async (ctx) => {
  const positions = getSimulatedPositions();
  if (positions.length === 0) {
    await ctx.reply('No open perp positions.');
    return;
  }

  let msg = `*Open Positions (${positions.length})*\n\n`;
  for (const p of positions) {
    const pnlSign = (p.unrealizedPnlPct ?? 0) >= 0 ? '+' : '';
    const hoursOpen = ((Date.now() - p.openedAt) / (1000 * 60 * 60)).toFixed(1);
    msg += `*${p.side.toUpperCase()} ${p.market}* ${p.leverage}x\n`;
    msg += `  Collateral: $${p.collateralUsd.toFixed(2)}\n`;
    msg += `  Entry: $${p.entryPrice.toFixed(2)} | Current: $${(p.currentPrice ?? 0).toFixed(2)}\n`;
    msg += `  P&L: ${pnlSign}${(p.unrealizedPnlPct ?? 0).toFixed(2)}% ($${pnlSign}${(p.unrealizedPnl ?? 0).toFixed(2)})\n`;
    msg += `  Open: ${hoursOpen}h\n\n`;
  }

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('mode', async (ctx) => {
  const modeArg = ctx.match?.trim().toLowerCase();

  if (modeArg === 'perps' || modeArg === 'invest') {
    ctx.session.tradingMode = modeArg;
    await ctx.reply(`Trading mode set to *${modeArg.toUpperCase()}*.`, { parse_mode: 'Markdown' });
    return;
  }

  await ctx.reply(
    `*Current mode:* ${ctx.session.tradingMode.toUpperCase()}\n\nSelect trading mode:`,
    { parse_mode: 'Markdown', reply_markup: tradingModeKeyboard() }
  );
});

bot.command('swap', async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized.');
    return;
  }

  const args = ctx.match?.trim();
  if (!args) {
    await ctx.reply('Usage: /swap <amount> <from> <to>\nExample: /swap 0.1 SOL USDC');
    return;
  }

  // If LLM is available, let it handle the swap via tools
  if (llmConfig) {
    try {
      const result = await callLLMWithTools(
        llmConfig,
        `Swap ${args}`,
        ctx.session,
        connection,
        wallet,
      );
      if (result) {
        pushChatHistory(ctx.session, 'user', `/swap ${args}`);
        pushChatHistory(ctx.session, 'assistant', result.content);
        await ctx.reply(result.content, { parse_mode: 'Markdown' });
        return;
      }
    } catch {
      // Fallback
    }
  }

  // Fallback: basic quote
  const parts = args.split(/\s+/);
  if (parts.length < 3) {
    await ctx.reply('Usage: /swap <amount> <from> <to>');
    return;
  }

  const [amountStr, from, to] = parts;
  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('Invalid amount.');
    return;
  }

  const fromToken = findTokenBySymbol(from.toUpperCase(), cluster);
  const toToken = findTokenBySymbol(to.toUpperCase(), cluster);

  if (!fromToken || !toToken) {
    await ctx.reply(`Unknown token. Supported: SOL, USDC, mSOL`);
    return;
  }

  await ctx.reply(`Fetching Jupiter quote for ${amount} ${from.toUpperCase()} -> ${to.toUpperCase()}...`);

  try {
    const jupiter = new JupiterAdapter();
    await jupiter.initialize({ rpcUrl: connection.rpcEndpoint, walletPublicKey: wallet.publicKey });

    const rawAmount = BigInt(Math.floor(amount * 10 ** fromToken.decimals));
    const quote = await jupiter.getQuote({
      inputToken: fromToken.mint,
      outputToken: toToken.mint,
      amount: rawAmount,
      maxSlippageBps: 50,
    });

    const expectedOutput = Number(quote.expectedOutputAmount) / 10 ** toToken.decimals;
    const minOutput = Number(quote.minimumOutputAmount) / 10 ** toToken.decimals;

    let msg = `*Swap Quote*\n\n`;
    msg += `${amount} ${fromToken.symbol} -> ~${expectedOutput.toFixed(4)} ${toToken.symbol}\n`;
    msg += `Min output: ${minOutput.toFixed(4)} ${toToken.symbol}\n`;
    msg += `Price impact: ${quote.priceImpactPct.toFixed(4)}%\n`;
    msg += `Route: ${quote.routeDescription}`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`Swap error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command('stake', async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized.');
    return;
  }

  const amountStr = ctx.match?.trim();
  if (!amountStr) {
    await ctx.reply('Usage: /stake <amount>\nExample: /stake 5');
    return;
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('Invalid amount.');
    return;
  }

  await ctx.reply(`Fetching Marinade staking quote for ${amount} SOL...`);

  try {
    const marinade = new MarinadeAdapter();
    await marinade.initialize({ rpcUrl: connection.rpcEndpoint, walletPublicKey: wallet.publicKey });

    const rawAmount = BigInt(Math.floor(amount * LAMPORTS_PER_SOL));
    const quote = await marinade.getQuote({
      inputToken: new PublicKey('So11111111111111111111111111111111111111112'),
      outputToken: new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'),
      amount: rawAmount,
      maxSlippageBps: 10,
    });

    const expectedMsol = Number(quote.expectedOutputAmount) / LAMPORTS_PER_SOL;

    let msg = `*Stake Quote*\n\n`;
    msg += `${amount} SOL -> ~${expectedMsol.toFixed(4)} mSOL\n`;
    msg += `Route: ${quote.routeDescription}\n`;
    msg += `Protocol: Marinade Finance (audited)`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`Stake error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command('strategy', async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized.');
    return;
  }

  // If LLM is available, use it
  if (llmConfig) {
    try {
      const result = await callLLMWithTools(
        llmConfig,
        'Evaluate the current market and suggest a trading strategy.',
        ctx.session,
        connection,
        wallet,
      );
      if (result) {
        pushChatHistory(ctx.session, 'user', '/strategy');
        pushChatHistory(ctx.session, 'assistant', result.content);
        await ctx.reply(result.content, {
          parse_mode: 'Markdown',
          reply_markup: strategySelectKeyboard(),
        });
        return;
      }
    } catch {
      // Fallback
    }
  }

  // Fallback: basic strategy
  await ctx.reply('Running strategy evaluation...');

  try {
    const reader = new PortfolioReader(connection, cluster);
    const portfolio = await reader.getPortfolio(wallet.publicKey);

    const strategyEngine = new StrategyEngine();
    const solBalance = portfolio.balances.find(b => b.token.symbol === 'SOL');
    const solPrice = solBalance?.priceUsd ?? 0;

    const prices = new Map<string, number>();
    for (const balance of portfolio.balances) {
      if (balance.priceUsd > 0) {
        prices.set(balance.token.mint.toBase58(), balance.priceUsd);
      }
    }

    const marketData = {
      solPriceUsd: solPrice,
      solChange24hPct: 0,
      volatilityIndex: 30,
      totalTvlUsd: 0,
      timestamp: Date.now(),
      prices,
    };

    const evaluation = strategyEngine.evaluate(portfolio, marketData);
    const rec = evaluation.recommended;

    let msg = `*Strategy Evaluation*\n\n`;
    msg += `*Recommended:* ${rec.strategyName}\n`;
    msg += `Confidence: ${rec.confidence}/100\n`;
    msg += `Risk: ${rec.riskScore}/100\n\n`;
    msg += `*Market:*\n`;
    msg += `${evaluation.marketCondition.summary}\n\n`;

    if (rec.actions.length > 0) {
      msg += `*Proposed Actions:*\n`;
      for (const action of rec.actions) {
        msg += `- ${action.type.toUpperCase()}: ${action.description}\n`;
      }
    }

    await ctx.reply(msg, {
      parse_mode: 'Markdown',
      reply_markup: strategySelectKeyboard(),
    });
  } catch (err) {
    await ctx.reply(`Strategy error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command('auto', async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized.');
    return;
  }

  const state = ctx.match?.trim().toLowerCase();

  if (state === 'cycle') {
    await ctx.reply('Running single OODA cycle...');
    try {
      const result = await agent.runSingleCycle();

      let msg = `*OODA Cycle Complete*\n\n`;
      msg += `Time: ${result.cycleTimeMs}ms\n`;
      msg += `Proposed: ${result.proposedActions.length}\n`;
      msg += `Approved: ${result.approvedActions.length}\n`;
      msg += `Rejected: ${result.rejectedActions.length}\n`;

      if (result.proposedActions.length > 0) {
        msg += `\n*Actions:*\n`;
        for (const action of result.proposedActions) {
          msg += `- ${action.type.toUpperCase()}: ${action.description}\n`;
        }
      }

      await ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err) {
      await ctx.reply(`Cycle error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  if (state === 'on') {
    agent.setMode('auto');
    agent.start();
    ctx.session.autoMode = true;
    await ctx.reply('Autonomous mode *ON*. OODA loop running every 30s.', { parse_mode: 'Markdown' });
    return;
  }

  if (state === 'off') {
    agent.setMode('advisory');
    agent.stop();
    ctx.session.autoMode = false;
    await ctx.reply('Autonomous mode *OFF*. Switched to advisory mode.', { parse_mode: 'Markdown' });
    return;
  }

  await ctx.reply(
    `*OODA Loop Control*\n\n` +
    `Current: ${ctx.session.autoMode ? 'ON (auto)' : 'OFF (advisory)'}\n\n` +
    `/auto on - Enable continuous OODA loop\n` +
    `/auto off - Switch to advisory mode\n` +
    `/auto cycle - Run a single cycle`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('alerts', async (ctx) => {
  const arg = ctx.match?.trim().toLowerCase();
  const userId = ctx.from?.id;
  if (!userId) return;

  if (arg === 'on') {
    setUserAlerts(userId, true);
    ctx.session.alertsEnabled = true;
    await ctx.reply('Alerts *enabled*.', { parse_mode: 'Markdown' });
    return;
  }

  if (arg === 'off') {
    setUserAlerts(userId, false);
    ctx.session.alertsEnabled = false;
    await ctx.reply('Alerts *disabled*.', { parse_mode: 'Markdown' });
    return;
  }

  const enabled = isUserAlertsEnabled(userId);
  await ctx.reply(
    `Alerts: *${enabled ? 'ON' : 'OFF'}*`,
    { parse_mode: 'Markdown', reply_markup: alertsKeyboard(enabled) }
  );
});

bot.command('health', async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized.');
    return;
  }

  try {
    const phase = agent.getPhase();
    const mode = agent.getMode();
    const running = agent.isRunning();

    const lamports = await connection.getBalance(wallet.publicKey);
    const solBalance = lamports / LAMPORTS_PER_SOL;

    const positions = getSimulatedPositions();

    let msg = `*Agent Health*\n\n`;
    msg += `Mode: ${mode}\n`;
    msg += `OODA Phase: ${phase}\n`;
    msg += `Loop Running: ${running ? 'Yes' : 'No'}\n`;
    msg += `SOL Balance: ${solBalance.toFixed(4)}\n`;
    msg += `Open Positions: ${positions.length}\n`;
    msg += `LLM: ${llmConfig ? `${llmConfig.provider}` : 'disabled'}\n`;
    msg += `Network: ${cluster}\n`;
    msg += `Wallet: \`${wallet.publicKey.toBase58().slice(0, 8)}...${wallet.publicKey.toBase58().slice(-4)}\``;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`Health check error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command('llm', async (ctx) => {
  const args = ctx.match?.trim();

  if (!args) {
    const status = llmConfig
      ? `*LLM Active:* ${llmConfig.provider} (${llmConfig.model || 'default'})`
      : '*LLM:* disabled';
    await ctx.reply(
      `${status}\n\n` +
      `*Configure:*\n` +
      `/llm anthropic sk-ant-api03-XXXX\n` +
      `/llm openai sk-XXXX\n` +
      `/llm off\n`,
      { parse_mode: 'Markdown' }
    );
    return;
  }

  if (args === 'off') {
    llmConfig = null;
    await ctx.reply('LLM *disabled*. Bot in basic command mode.', { parse_mode: 'Markdown' });
    return;
  }

  const parts = args.split(/\s+/);
  if (parts.length < 2) {
    await ctx.reply('Usage: `/llm <anthropic|openai> <api-key>`', { parse_mode: 'Markdown' });
    return;
  }

  const [provider, apiKey] = parts;
  if (!['anthropic', 'openai', 'qwen'].includes(provider)) {
    await ctx.reply('Provider must be: `anthropic`, `openai`, or `qwen`', { parse_mode: 'Markdown' });
    return;
  }

  llmConfig = {
    provider: provider as 'anthropic' | 'openai' | 'qwen',
    apiKey,
    model: parts[2] || undefined,
  };

  await ctx.reply(
    `LLM *enabled*: ${provider}\n` +
    `Model: ${llmConfig.model || 'default'}\n\n` +
    `_Try: "What's my portfolio?"_`,
    { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
  );
});

bot.command('zktest', async (ctx) => {
  if (ctx.from) registerUserChat(ctx.from.id, ctx.chat.id);

  await ctx.reply(
    `*ZK Proof Test — Groth16 over BN254*\n\n` +
    `Initializing Poseidon hash + loading circuit (2.7 MB WASM + 11 MB zkey)...\n` +
    `_This will take 30-60 seconds._`,
    { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
  );

  try {
    const { initPoseidon, generateShieldProof, PoseidonMerkleTree, formatProof, randomFieldElement } = await import('./zk-prover.js');

    await initPoseidon();

    const tree = new PoseidonMerkleTree(20);
    const spendingKey = randomFieldElement();
    const startTime = Date.now();

    const result = await generateShieldProof(1.0, spendingKey, tree);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    const lines = [
      `*Groth16 SNARK Proof Generated*`,
      ``,
      `*Circuit:* P01 transfer.circom (2-in-2-out UTXO)`,
      `*Hash:* Poseidon (ZK-friendly)`,
      `*Curve:* BN254`,
      `*Proof system:* Groth16`,
      ``,
      `*Commitment:* \`${result.commitment.toString(16).slice(0, 16)}...\``,
      `*Nullifier:* \`${result.nullifier.toString(16).slice(0, 16)}...\``,
      `*Public signals:* ${result.publicSignals.length}`,
      ``,
      formatProof(result.proof),
      ``,
      `*Verified:* ${result.verified ? 'YES' : 'NO'}`,
      `*Proof time:* ${elapsed}s`,
      ``,
      `_This is a real Groth16 zero-knowledge proof — the same crypto used in Zcash, Tornado Cash, and P01._`,
    ];

    await ctx.reply(lines.join('\n'), { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() })
      .catch(() => ctx.reply(lines.join('\n'), { reply_markup: mainMenuKeyboard() }));

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[ZK Test] Error:', err);
    await ctx.reply(`ZK test failed: ${msg}`, { reply_markup: mainMenuKeyboard() });
  }
});

bot.command('sentiment', async (ctx) => {
  if (ctx.from) registerUserChat(ctx.from.id, ctx.chat.id);

  try {
    const report = await analyzeSentiment();
    const scoreSign = report.overallScore >= 0 ? '+' : '';
    const fg = report.signals.fearGreed;

    let msg = `*Market Sentiment*\n\n`;
    msg += `Score: *${scoreSign}${report.overallScore}* (${report.direction.toUpperCase().replace('_', ' ')})\n`;
    msg += `Confidence: ${report.confidence}%\n\n`;
    msg += `*Signals:*\n`;
    msg += `  Fear & Greed: ${fg.value} (${fg.classification})\n`;

    for (const [token, rsi] of Object.entries(report.signals.rsi)) {
      msg += `  ${token} RSI: ${rsi.value.toFixed(0)} (${rsi.signal})\n`;
    }

    msg += `  Polymarket: ${report.signals.polymarket.bias} (${report.signals.polymarket.conviction}%)\n`;

    if (report.signals.tvl.tvl > 0) {
      const tvlSign = report.signals.tvl.change24hPct >= 0 ? '+' : '';
      msg += `  Solana TVL: ${tvlSign}${report.signals.tvl.change24hPct.toFixed(1)}% (24h)\n`;
    }

    if (report.signals.dexVolume.volume24h > 0) {
      const volSign = report.signals.dexVolume.change24hPct >= 0 ? '+' : '';
      msg += `  DEX Volume: ${volSign}${report.signals.dexVolume.change24hPct.toFixed(1)}% (24h)\n`;
    }

    if (report.signals.news.articleCount > 0) {
      msg += `  News: ${report.signals.news.bias} (${report.signals.news.score > 0 ? '+' : ''}${report.signals.news.score}, ${report.signals.news.articleCount} articles)\n`;
    }

    msg += `\n_Updated: ${new Date().toLocaleTimeString()}_`;
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`Sentiment error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command('scan', async (ctx) => {
  if (ctx.from) registerUserChat(ctx.from.id, ctx.chat.id);

  await ctx.reply('Running market scan...');

  try {
    const message = await runSingleScan({
      bot,
      connection,
      wallet,
      llmConfig,
    });

    // Split if too long
    if (message.length <= 4000) {
      await ctx.reply(message, { parse_mode: 'Markdown' }).catch(() => ctx.reply(message));
    } else {
      const chunks = splitMessage(message, 4000);
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(() => ctx.reply(chunk));
      }
    }
  } catch (err) {
    await ctx.reply(`Scan error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command('news', async (ctx) => {
  if (ctx.from) registerUserChat(ctx.from.id, ctx.chat.id);

  try {
    const feed = await fetchCryptoNews();
    if (feed.articles.length === 0) {
      await ctx.reply('No crypto news available right now. Try again later.');
      return;
    }

    const msg = formatNewsForDisplay(feed);
    if (msg.length <= 4000) {
      await ctx.reply(msg, { parse_mode: 'Markdown' }).catch(() => ctx.reply(msg));
    } else {
      const chunks = splitMessage(msg, 4000);
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(() => ctx.reply(chunk));
      }
    }
  } catch (err) {
    await ctx.reply(`News error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command('wallet', async (ctx) => {
  const pubkey = wallet.publicKey.toBase58();
  const secretKey = JSON.stringify(Array.from(wallet.secretKey));

  let msg = `*Wallet Info*\n\n`;
  msg += `*Public Key:*\n\`${pubkey}\`\n\n`;
  msg += `*Secret Key (JSON array):*\n\`\`\`\n${secretKey}\n\`\`\`\n\n`;
  msg += `_Network: ${cluster}_\n`;
  msg += `_Keep this secret! Do not share in public channels._`;

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

// ============================================================================
// Callback Query Handler (inline keyboards)
// ============================================================================

bot.on('callback_query:data', async (ctx) => {
  const data = ctx.callbackQuery.data;

  // ── Trade confirmation ──
  if (data.startsWith('confirm:')) {
    const actionId = data.slice('confirm:'.length);
    const pending = ctx.session.pendingAction;

    if (!pending || pending.id !== actionId) {
      await ctx.answerCallbackQuery({ text: 'Action expired.' });
      return;
    }

    if (Date.now() > pending.expiresAt) {
      ctx.session.pendingAction = null;
      await ctx.answerCallbackQuery({ text: 'Action expired.' });
      return;
    }

    // Execute the pending action
    try {
      const toolCtx = await getToolCtx();
      const result = await executeTool(pending.type, pending.params, toolCtx);
      ctx.session.pendingAction = null;
      await ctx.editMessageText(`*Executed:* ${result}`, { parse_mode: 'Markdown' });
    } catch (err) {
      await ctx.editMessageText(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    await ctx.answerCallbackQuery();
    return;
  }

  if (data.startsWith('cancel:')) {
    ctx.session.pendingAction = null;
    await ctx.editMessageText('Action cancelled.');
    await ctx.answerCallbackQuery({ text: 'Cancelled' });
    return;
  }

  // ── OODA approval ──
  if (data.startsWith('ooda:approve:')) {
    const cycleId = data.slice('ooda:approve:'.length);
    const resolved = resolveOODA(cycleId, true);
    await ctx.editMessageText(resolved ? 'Actions *approved*.' : 'Cycle already resolved.', { parse_mode: 'Markdown' });
    await ctx.answerCallbackQuery({ text: resolved ? 'Approved' : 'Expired' });
    return;
  }

  if (data.startsWith('ooda:reject:')) {
    const cycleId = data.slice('ooda:reject:'.length);
    const resolved = resolveOODA(cycleId, false);
    await ctx.editMessageText(resolved ? 'Actions *rejected*.' : 'Cycle already resolved.', { parse_mode: 'Markdown' });
    await ctx.answerCallbackQuery({ text: resolved ? 'Rejected' : 'Expired' });
    return;
  }

  // ── Strategy selection ──
  if (data.startsWith('strategy:')) {
    const strategy = data.slice('strategy:'.length) as 'conservative' | 'balanced' | 'aggressive';
    if (ctx.session.activeSession) {
      ctx.session.activeSession.strategy = strategy;
    }
    await ctx.editMessageText(`Strategy set to *${strategy}*.`, { parse_mode: 'Markdown' });
    await ctx.answerCallbackQuery({ text: `Strategy: ${strategy}` });
    return;
  }

  // ── Trading mode ──
  if (data.startsWith('mode:')) {
    const mode = data.slice('mode:'.length) as 'perps' | 'invest';
    ctx.session.tradingMode = mode;
    await ctx.editMessageText(`Trading mode: *${mode.toUpperCase()}*`, { parse_mode: 'Markdown' });
    await ctx.answerCallbackQuery({ text: `Mode: ${mode}` });
    return;
  }

  // ── Alerts toggle ──
  if (data === 'alerts:on' || data === 'alerts:off') {
    const enabled = data === 'alerts:on';
    if (ctx.from) {
      setUserAlerts(ctx.from.id, enabled);
    }
    ctx.session.alertsEnabled = enabled;
    await ctx.editMessageText(`Alerts: *${enabled ? 'ON' : 'OFF'}*`, { parse_mode: 'Markdown' });
    await ctx.answerCallbackQuery({ text: enabled ? 'Alerts enabled' : 'Alerts disabled' });
    return;
  }

  // ── Settings sub-menu ──
  if (data === 'settings:mode') {
    await ctx.editMessageText('Select trading mode:', { reply_markup: tradingModeKeyboard() });
    await ctx.answerCallbackQuery();
    return;
  }

  if (data === 'llm:openai' || data === 'llm:anthropic') {
    const provider = data.slice('llm:'.length);
    // Store provider choice in session, wait for key
    ctx.session.pendingLLMProvider = provider as 'openai' | 'anthropic';
    await ctx.editMessageText(
      `*Setup ${provider.charAt(0).toUpperCase() + provider.slice(1)}*\n\n` +
      `Just paste your API key below:\n\n` +
      `_${provider === 'openai' ? 'Starts with sk-proj-... or sk-...' : 'Starts with sk-ant-...'}_`,
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCallbackQuery({ text: `Paste your ${provider} key` });
    return;
  }

  if (data === 'llm:off') {
    llmConfig = null;
    ctx.session.pendingLLMProvider = undefined;
    await ctx.editMessageText('LLM *disabled*. Bot in basic command mode.', { parse_mode: 'Markdown' });
    await ctx.answerCallbackQuery({ text: 'LLM disabled' });
    return;
  }

  if (data === 'settings:wallet') {
    const pubkey = wallet.publicKey.toBase58();
    await ctx.editMessageText(
      `*Wallet*\n\n\`${pubkey}\`\n\n_Network: ${cluster}_`,
      { parse_mode: 'Markdown' }
    );
    await ctx.answerCallbackQuery();
    return;
  }

  // ── Auto mode controls ──
  if (data === 'auto:on') {
    if (agent) {
      agent.setMode('auto');
      agent.start();
      ctx.session.autoMode = true;
    }
    await ctx.editMessageText('Autonomous mode *ON*. OODA loop running.', {
      parse_mode: 'Markdown',
      reply_markup: autoModeKeyboard(true),
    });
    await ctx.answerCallbackQuery({ text: 'Auto started' });
    return;
  }

  if (data === 'auto:off') {
    if (agent) {
      agent.setMode('advisory');
      agent.stop();
      ctx.session.autoMode = false;
    }
    await ctx.editMessageText('Autonomous mode *OFF*. Advisory mode.', {
      parse_mode: 'Markdown',
      reply_markup: autoModeKeyboard(false),
    });
    await ctx.answerCallbackQuery({ text: 'Auto stopped' });
    return;
  }

  if (data === 'auto:cycle') {
    if (!agent) {
      await ctx.answerCallbackQuery({ text: 'Agent not ready' });
      return;
    }
    await ctx.answerCallbackQuery({ text: 'Running cycle...' });
    try {
      const result = await agent.runSingleCycle();
      let msg = `*OODA Cycle Complete*\n\n`;
      msg += `Time: ${result.cycleTimeMs}ms\n`;
      msg += `Proposed: ${result.proposedActions.length}\n`;
      msg += `Approved: ${result.approvedActions.length}\n`;
      if (result.proposedActions.length > 0) {
        msg += `\n*Actions:*\n`;
        for (const action of result.proposedActions) {
          msg += `- ${action.type.toUpperCase()}: ${action.description}\n`;
        }
      }
      await ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        reply_markup: autoModeKeyboard(agent.isRunning()),
      });
    } catch (err) {
      await ctx.editMessageText(`Cycle error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // ── Session control ──
  if (data === 'session:pause') {
    if (agent?.isRunning()) {
      agent.stop();
      ctx.session.autoMode = false;
    }
    await ctx.editMessageText('Session *paused*.', { parse_mode: 'Markdown' });
    await ctx.answerCallbackQuery({ text: 'Paused' });
    return;
  }

  if (data === 'session:stop') {
    if (agent?.isRunning()) {
      agent.stop();
      agent.setMode('advisory');
    }
    ctx.session.autoMode = false;
    ctx.session.activeSession = null;
    await ctx.editMessageText('Session *stopped*.', { parse_mode: 'Markdown' });
    await ctx.answerCallbackQuery({ text: 'Stopped' });
    return;
  }

  await ctx.answerCallbackQuery();
});

// ============================================================================
// Helpers
// ============================================================================

function splitMessage(text: string, maxLen: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx <= 0) splitIdx = maxLen;
    chunks.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx);
  }
  return chunks;
}

// ============================================================================
// Persistent Keyboard Button Handlers (must come BEFORE message:text)
// ============================================================================

bot.hears(/^\u{1F4CA} Status$/u, async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized. Please wait...');
    return;
  }

  if (llmConfig) {
    try {
      const result = await callLLMWithTools(
        llmConfig,
        'Show me my portfolio status with balances and positions.',
        ctx.session,
        connection,
        wallet,
      );
      if (result) {
        pushChatHistory(ctx.session, 'user', 'Status');
        pushChatHistory(ctx.session, 'assistant', result.content);
        await ctx.reply(result.content, { parse_mode: 'Markdown' }).catch(() => ctx.reply(result.content));
        return;
      }
    } catch { /* fallback */ }
  }

  try {
    const reader = new PortfolioReader(connection, cluster);
    const portfolio = await reader.getPortfolio(wallet.publicKey);

    let msg = `*Portfolio Status*\n\n`;
    msg += `Total Value: *$${portfolio.totalValueUsd.toFixed(2)}*\n\n`;
    msg += `*Balances:*\n`;
    for (const balance of portfolio.balances) {
      const pct = portfolio.totalValueUsd > 0
        ? (balance.usdValue / portfolio.totalValueUsd * 100).toFixed(1)
        : '0';
      msg += `  ${balance.token.symbol}: ${balance.uiBalance.toFixed(4)} ($${balance.usdValue.toFixed(2)}) [${pct}%]\n`;
    }

    const positions = getSimulatedPositions();
    if (positions.length > 0) {
      msg += `\n*Open Positions:* ${positions.length}\n`;
      for (const p of positions) {
        const pnlSign = (p.unrealizedPnlPct ?? 0) >= 0 ? '+' : '';
        msg += `  ${p.side.toUpperCase()} ${p.market} ${p.leverage}x: ${pnlSign}${(p.unrealizedPnlPct ?? 0).toFixed(2)}%\n`;
      }
    }

    msg += `\n_Updated: ${new Date().toLocaleTimeString()}_`;
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.hears(/^\u{1F4C8} Scan$/u, async (ctx) => {
  if (ctx.from) registerUserChat(ctx.from.id, ctx.chat.id);
  await ctx.reply('Running market scan...');
  try {
    const message = await runSingleScan({ bot, connection, wallet, llmConfig });
    if (message.length <= 4000) {
      await ctx.reply(message, { parse_mode: 'Markdown' }).catch(() => ctx.reply(message));
    } else {
      const chunks = splitMessage(message, 4000);
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(() => ctx.reply(chunk));
      }
    }
  } catch (err) {
    await ctx.reply(`Scan error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.hears(/^\u{1F9E0} Sentiment$/u, async (ctx) => {
  if (ctx.from) registerUserChat(ctx.from.id, ctx.chat.id);
  try {
    const report = await analyzeSentiment();
    const scoreSign = report.overallScore >= 0 ? '+' : '';
    const fg = report.signals.fearGreed;

    let msg = `*Market Sentiment*\n\n`;
    msg += `Score: *${scoreSign}${report.overallScore}* (${report.direction.toUpperCase().replace('_', ' ')})\n`;
    msg += `Confidence: ${report.confidence}%\n\n`;
    msg += `*Signals:*\n`;
    msg += `  Fear & Greed: ${fg.value} (${fg.classification})\n`;

    for (const [token, rsi] of Object.entries(report.signals.rsi)) {
      msg += `  ${token} RSI: ${rsi.value.toFixed(0)} (${rsi.signal})\n`;
    }

    msg += `  Polymarket: ${report.signals.polymarket.bias} (${report.signals.polymarket.conviction}%)\n`;

    if (report.signals.tvl.value > 0) {
      const tvlSign = report.signals.tvl.change24hPct >= 0 ? '+' : '';
      msg += `  Solana TVL: ${tvlSign}${report.signals.tvl.change24hPct.toFixed(1)}% (24h)\n`;
    }

    if (report.signals.dexVolume.value > 0) {
      const volSign = report.signals.dexVolume.change24hPct >= 0 ? '+' : '';
      msg += `  DEX Volume: ${volSign}${report.signals.dexVolume.change24hPct.toFixed(1)}% (24h)\n`;
    }

    if (report.signals.news.articleCount > 0) {
      msg += `  News: ${report.signals.news.bias} (${report.signals.news.score > 0 ? '+' : ''}${report.signals.news.score}, ${report.signals.news.articleCount} articles)\n`;
    }

    msg += `\n_Updated: ${new Date().toLocaleTimeString()}_`;
    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`Sentiment error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.hears(/^\u{1F4BC} Positions$/u, async (ctx) => {
  const positions = getSimulatedPositions();
  if (positions.length === 0) {
    await ctx.reply('No open perp positions.');
    return;
  }

  let msg = `*Open Positions (${positions.length})*\n\n`;
  for (const p of positions) {
    const pnlSign = (p.unrealizedPnlPct ?? 0) >= 0 ? '+' : '';
    const hoursOpen = ((Date.now() - p.openedAt) / (1000 * 60 * 60)).toFixed(1);
    msg += `*${p.side.toUpperCase()} ${p.market}* ${p.leverage}x\n`;
    msg += `  Collateral: $${p.collateralUsd.toFixed(2)}\n`;
    msg += `  Entry: $${p.entryPrice.toFixed(2)} | Current: $${(p.currentPrice ?? 0).toFixed(2)}\n`;
    msg += `  P&L: ${pnlSign}${(p.unrealizedPnlPct ?? 0).toFixed(2)}% ($${pnlSign}${(p.unrealizedPnl ?? 0).toFixed(2)})\n`;
    msg += `  Open: ${hoursOpen}h\n\n`;
  }
  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.hears(/^\u{1F916} Auto$/u, async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized.');
    return;
  }
  const running = agent.isRunning();
  await ctx.reply(
    `*OODA Loop*\n\nStatus: ${running ? 'Running' : 'Stopped'}\nMode: ${agent.getMode()}`,
    { parse_mode: 'Markdown', reply_markup: autoModeKeyboard(running) }
  );
});

bot.hears(/^\u{2699}\uFE0F Settings$/u, async (ctx) => {
  const userId = ctx.from?.id;
  const alertsOn = userId ? isUserAlertsEnabled(userId) : false;
  const llmStatus = llmConfig ? `${llmConfig.provider} (${llmConfig.model || 'default'})` : 'disabled';

  await ctx.reply(
    `*Settings*\n\n` +
    `LLM: *${llmStatus}*\n` +
    `Mode: *${ctx.session.tradingMode}*\n` +
    `Alerts: *${alertsOn ? 'ON' : 'OFF'}*`,
    { parse_mode: 'Markdown', reply_markup: settingsInlineKeyboard(alertsOn) }
  );
});

bot.hears(/^\u{1F3AF} Strategy$/u, async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized.');
    return;
  }

  if (llmConfig) {
    try {
      const result = await callLLMWithTools(
        llmConfig,
        'Evaluate the current market and suggest a trading strategy.',
        ctx.session,
        connection,
        wallet,
      );
      if (result) {
        pushChatHistory(ctx.session, 'user', 'Strategy');
        pushChatHistory(ctx.session, 'assistant', result.content);
        await ctx.reply(result.content, {
          parse_mode: 'Markdown',
          reply_markup: strategySelectKeyboard(),
        });
        return;
      }
    } catch { /* fallback */ }
  }

  await ctx.reply('Select strategy:', { reply_markup: strategySelectKeyboard() });
});

bot.hears(/^\u{1F4F0} News$/u, async (ctx) => {
  if (ctx.from) registerUserChat(ctx.from.id, ctx.chat.id);

  try {
    const feed = await fetchCryptoNews();
    if (feed.articles.length === 0) {
      await ctx.reply('No crypto news available right now. Try again later.');
      return;
    }

    const msg = formatNewsForDisplay(feed);
    if (msg.length <= 4000) {
      await ctx.reply(msg, { parse_mode: 'Markdown' }).catch(() => ctx.reply(msg));
    } else {
      const chunks = splitMessage(msg, 4000);
      for (const chunk of chunks) {
        await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch(() => ctx.reply(chunk));
      }
    }
  } catch (err) {
    await ctx.reply(`News error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.hears(/^\u{2764}\uFE0F Health$/u, async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized.');
    return;
  }

  try {
    const phase = agent.getPhase();
    const mode = agent.getMode();
    const running = agent.isRunning();
    const lamports = await connection.getBalance(wallet.publicKey);
    const solBalance = lamports / LAMPORTS_PER_SOL;
    const positions = getSimulatedPositions();

    let msg = `*Agent Health*\n\n`;
    msg += `Mode: ${mode}\n`;
    msg += `OODA Phase: ${phase}\n`;
    msg += `Loop Running: ${running ? 'Yes' : 'No'}\n`;
    msg += `SOL Balance: ${solBalance.toFixed(4)}\n`;
    msg += `Open Positions: ${positions.length}\n`;
    msg += `LLM: ${llmConfig ? `${llmConfig.provider}` : 'disabled'}\n`;
    msg += `Network: ${cluster}\n`;
    msg += `Wallet: \`${wallet.publicKey.toBase58().slice(0, 8)}...${wallet.publicKey.toBase58().slice(-4)}\``;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`Health check error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// ============================================================================
// Natural Language Handler (LLM-powered)
// ============================================================================

bot.on('message:text', async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized. Please wait...', { reply_markup: mainMenuKeyboard() });
    return;
  }

  const text = ctx.message.text;

  // Skip if it's a command
  if (text.startsWith('/')) return;

  // ── Auto-detect API key paste ──
  const trimmed = text.trim();

  // If user has a pending provider choice, any pasted key completes the setup
  if (ctx.session.pendingLLMProvider && trimmed.startsWith('sk-')) {
    const provider = ctx.session.pendingLLMProvider;
    llmConfig = { provider, apiKey: trimmed };
    ctx.session.pendingLLMProvider = undefined;
    await ctx.reply(
      `LLM *enabled*: ${provider}\nModel: default\n\n_Try: "What's my portfolio?"_`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
    );
    return;
  }

  // Auto-detect key without prior button press (raw paste)
  if (/^sk-ant-api\d{2}-/i.test(trimmed)) {
    llmConfig = { provider: 'anthropic', apiKey: trimmed };
    ctx.session.pendingLLMProvider = undefined;
    await ctx.reply(
      `LLM *enabled*: anthropic (auto-detected)\nModel: default\n\n_Try: "What's my portfolio?"_`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
    );
    return;
  }

  if (/^sk-(?:proj-|org-|[a-zA-Z0-9]{20,})/i.test(trimmed) && !trimmed.includes(' ')) {
    llmConfig = { provider: 'openai', apiKey: trimmed };
    ctx.session.pendingLLMProvider = undefined;
    await ctx.reply(
      `LLM *enabled*: openai (auto-detected)\nModel: default\n\n_Try: "What's my portfolio?"_`,
      { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
    );
    return;
  }

  // Register user for alerts
  if (ctx.from) {
    registerUserChat(ctx.from.id, ctx.chat.id);
  }

  // If LLM is configured, use intelligent mode
  if (llmConfig) {
    try {
      const result = await callLLMWithTools(
        llmConfig,
        text,
        ctx.session,
        connection,
        wallet,
      );

      if (result) {
        pushChatHistory(ctx.session, 'user', text);
        pushChatHistory(ctx.session, 'assistant', result.content);

        // Send response (split if too long for Telegram's 4096 char limit)
        const content = result.content;
        const kb = mainMenuKeyboard();
        if (content.length <= 4000) {
          await ctx.reply(content, { parse_mode: 'Markdown', reply_markup: kb }).catch(() =>
            ctx.reply(content, { reply_markup: kb })
          );
        } else {
          const chunks = splitMessage(content, 4000);
          for (const chunk of chunks) {
            await ctx.reply(chunk, { parse_mode: 'Markdown', reply_markup: kb }).catch(() =>
              ctx.reply(chunk, { reply_markup: kb })
            );
          }
        }
        return;
      }
    } catch (err) {
      console.error('[LLM] Error:', err);
      // Fallback to basic mode
    }
  }

  // ── Direct command parsing (works without LLM) ──
  const lower = text.toLowerCase().trim();
  const toolCtx = await getToolCtx();

  // Shield: "shield 1 sol", "shield 50%", "shield all"
  const shieldMatch = lower.match(/^shield\s+(?:(\d+(?:\.\d+)?)\s*(?:sol)?|(\d+)%|all)$/);
  if (shieldMatch) {
    const input: Record<string, unknown> = {};
    if (shieldMatch[1]) input.amount_sol = parseFloat(shieldMatch[1]);
    else if (shieldMatch[2]) input.percent_of_wallet = parseInt(shieldMatch[2]);
    // else: no args = shield all (default behavior)
    const result = await executeTool('shield_sol', input, toolCtx);
    await ctx.reply(result, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() });
    return;
  }

  // Unshield: "unshield 1 sol", "unshield 50%", "unshield all"
  const unshieldMatch = lower.match(/^unshield\s+(?:(\d+(?:\.\d+)?)\s*(?:sol)?|(\d+)%|all)$/);
  if (unshieldMatch) {
    const input: Record<string, unknown> = {};
    if (unshieldMatch[1]) input.amount_sol = parseFloat(unshieldMatch[1]);
    else if (unshieldMatch[2]) input.percent_of_vault = parseInt(unshieldMatch[2]);
    const result = await executeTool('unshield_sol', input, toolCtx);
    await ctx.reply(result, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() });
    return;
  }

  // News: "news", "headlines", "latest news"
  if (/^(?:latest\s+)?(?:news|headlines)$/i.test(lower)) {
    try {
      const feed = await fetchCryptoNews();
      if (feed.articles.length === 0) {
        await ctx.reply('No crypto news available right now.');
        return;
      }
      const msg = formatNewsForDisplay(feed);
      await safeReply(ctx, msg, { reply_markup: mainMenuKeyboard() });
    } catch (err) {
      await ctx.reply(`News error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return;
  }

  // Vault: "vault", "my vault"
  if (/^(?:my\s+)?vault$/i.test(lower)) {
    const result = await executeTool('get_vault', {}, toolCtx);
    await ctx.reply(result, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() });
    return;
  }

  // Portfolio: "portfolio", "my portfolio", "balance"
  if (/^(?:my\s+)?(?:portfolio|balance|wallet)$/i.test(lower)) {
    const result = await executeTool('get_portfolio', {}, toolCtx);
    await ctx.reply(result, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() });
    return;
  }

  // Positions: "positions", "my positions"
  if (/^(?:my\s+)?positions?$/i.test(lower)) {
    const result = await executeTool('get_positions', {}, toolCtx);
    await ctx.reply(result, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() });
    return;
  }

  // Open position: "long sol 5x", "short btc 10x", "open long sol"
  const posMatch = lower.match(/^(?:open\s+)?(long|short)\s+(sol|eth|btc)(?:\s+(\d+)x)?(?:\s+(\d+)%)?$/);
  if (posMatch) {
    const side = posMatch[1];
    const asset = posMatch[2].toUpperCase();
    const leverage = posMatch[3] ? parseInt(posMatch[3]) : 5;
    const pct = posMatch[4] ? parseInt(posMatch[4]) : 25;
    const result = await executeTool('open_position', {
      market: `${asset}-PERP`,
      side,
      leverage,
      percent_of_vault: pct,
    }, toolCtx);
    await ctx.reply(result, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() });
    return;
  }

  // Close position: "close sol", "close btc"
  const closeMatch = lower.match(/^close\s+(sol|eth|btc|all)$/);
  if (closeMatch) {
    if (closeMatch[1] === 'all') {
      const result = await executeTool('close_all_positions', {}, toolCtx);
      await ctx.reply(result, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() });
    } else {
      const result = await executeTool('close_position', { market: `${closeMatch[1].toUpperCase()}-PERP` }, toolCtx);
      await ctx.reply(result, { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() });
    }
    return;
  }

  // Fallback: basic agent command parsing
  try {
    const intent = agent.parseCommand(text);

    if (intent.type === 'unknown') {
      await ctx.reply(
        `I didn't understand that.\n\n` +
        `Try:\n` +
        `- "shield 1 sol" / "unshield 0.5 sol"\n` +
        `- "vault" / "portfolio" / "positions"\n` +
        `- "long sol 5x" / "short btc 10x"\n` +
        `- "close sol" / "close all"\n\n` +
        `${llmConfig ? '' : 'Tip: Set LLM API key in Settings for intelligent conversations.'}`,
        { reply_markup: mainMenuKeyboard() }
      );
      return;
    }

    const response = await agent.executeCommand(text);
    await ctx.reply(`Agent: ${response}`, { reply_markup: mainMenuKeyboard() });
  } catch (err) {
    await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`, { reply_markup: mainMenuKeyboard() });
  }
});

// ============================================================================
// Launch
// ============================================================================

async function main() {
  console.log('[Makora Telegram] Starting...');

  try {
    await initializeAgent();
    console.log('[Makora Telegram] Agent ready');

    // Register alert handlers if agent exists
    if (agent) {
      registerAlertHandlers(bot, agent);
    }

    // Start autonomous sentiment scan (every 4 hours)
    const scanConfig = { bot, connection, wallet, llmConfig };
    startAutonomousScan(scanConfig);

    // Start continuous news monitor (every 15 minutes)
    startNewsMonitor(scanConfig);

    // Graceful shutdown
    const shutdown = () => {
      console.log('[Makora Telegram] Shutting down...');
      stopNewsMonitor();
      stopAutonomousScan();
      bot.stop();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    await bot.start({
      onStart: (botInfo) => {
        console.log(`[Makora Telegram] Bot started as @${botInfo.username}`);
        console.log(`[Makora Telegram] Wallet: ${wallet.publicKey.toBase58()}`);
        console.log(`[Makora Telegram] Network: ${cluster}`);
        console.log(`[Makora Telegram] LLM: ${llmConfig ? `${llmConfig.provider}` : 'disabled'}`);
        console.log(`[Makora Telegram] Autonomous scan: enabled (4h interval)`);
        console.log(`[Makora Telegram] News monitor: enabled (15min interval)`);
      },
    });
  } catch (err) {
    console.error('[Makora Telegram] Fatal error:', err);
    process.exit(1);
  }
}

main();

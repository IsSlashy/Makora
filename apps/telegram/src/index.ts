import { Bot, Context, session, type SessionFlavor } from 'grammy';
import { config as loadDotenv } from 'dotenv';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MakoraConfig, SolanaCluster, AgentMode, RiskLimits } from '@makora/types';
import { createConnection, PortfolioReader, JupiterPriceFeed, findTokenBySymbol, type ConnectionConfig } from '@makora/data-feed';
import { MakoraAgent, type AgentConfig } from '@makora/agent-core';
import { StrategyEngine } from '@makora/strategy-engine';
import { AdapterRegistry } from '@makora/protocol-router';
import { JupiterAdapter } from '@makora/adapters-jupiter';
import { MarinadeAdapter } from '@makora/adapters-marinade';
import { PrivacyAdapter } from '@makora/adapters-privacy';

// Load env
loadDotenv();

// ============================================================================
// Session
// ============================================================================

interface SessionData {
  autoMode: boolean;
  lastCycleTime: number;
}

type MakoraContext = Context & SessionFlavor<SessionData>;

// ============================================================================
// Globals
// ============================================================================

let agent: MakoraAgent | null = null;
let connection: Connection;
let wallet: Keypair;
let cluster: SolanaCluster;

// ============================================================================
// Initialize
// ============================================================================

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
  console.log('[Makora] Agent initialized with Jupiter + Marinade + Privacy');
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

bot.use(session({
  initial: (): SessionData => ({
    autoMode: false,
    lastCycleTime: 0,
  }),
}));

// ============================================================================
// Commands
// ============================================================================

bot.command('start', async (ctx) => {
  await ctx.reply(
    `*Makora - The Adaptive DeFi Agent*\n\n` +
    `Welcome! I'm Makora, a privacy-preserving DeFi agent for Solana.\n\n` +
    `*Commands:*\n` +
    `/status - Portfolio overview\n` +
    `/swap <amount> <from> <to> - Swap tokens via Jupiter\n` +
    `/stake <amount> - Stake SOL via Marinade\n` +
    `/strategy - Current strategy evaluation\n` +
    `/auto <on|off|cycle> - Toggle autonomous mode\n` +
    `/shield <amount> - Shield SOL into privacy pool\n` +
    `/health - Protocol health check\n\n` +
    `Or just type in natural language: "swap 10 SOL to USDC"\n\n` +
    `_Wallet: ${wallet.publicKey.toBase58().slice(0, 8)}...${wallet.publicKey.toBase58().slice(-4)}_\n` +
    `_Network: ${cluster}_`,
    { parse_mode: 'Markdown' }
  );
});

bot.command('status', async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized. Please wait...');
    return;
  }

  await ctx.reply('Fetching portfolio...');

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

    msg += `\n_Updated: ${new Date(portfolio.lastUpdated).toLocaleTimeString()}_`;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

bot.command('swap', async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized.');
    return;
  }

  const args = ctx.match?.trim().split(/\s+/);
  if (!args || args.length < 3) {
    await ctx.reply('Usage: /swap <amount> <from> <to>\nExample: /swap 10 SOL USDC');
    return;
  }

  const [amountStr, from, to] = args;
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
    msg += `Route: ${quote.routeDescription}\n\n`;
    msg += `_Use the CLI to execute: makora swap ${amount} ${from} ${to}_`;

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
    msg += `Protocol: Marinade Finance (audited)\n\n`;
    msg += `_Use the CLI to execute: makora stake ${amount}_`;

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
    msg += `Type: ${rec.type}\n`;
    msg += `Confidence: ${rec.confidence}/100\n`;
    msg += `Risk: ${rec.riskScore}/100\n\n`;
    msg += `*Market:*\n`;
    msg += `${evaluation.marketCondition.summary}\n`;
    msg += `Volatility: ${evaluation.marketCondition.volatilityRegime}\n`;
    msg += `Trend: ${evaluation.marketCondition.trendDirection}\n\n`;

    if (rec.actions.length > 0) {
      msg += `*Proposed Actions:*\n`;
      for (const action of rec.actions) {
        msg += `- ${action.type.toUpperCase()}: ${action.description}\n`;
      }
    } else {
      msg += `No actions needed. Portfolio is well-positioned.`;
    }

    await ctx.reply(msg, { parse_mode: 'Markdown' });
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
    await ctx.reply('Autonomous mode *ON*. The OODA loop is now running every 30s.', { parse_mode: 'Markdown' });
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
    `Usage: /auto <on|off|cycle>\n` +
    `  on - Enable continuous OODA loop\n` +
    `  off - Switch to advisory mode\n` +
    `  cycle - Run a single OODA cycle`
  );
});

bot.command('shield', async (ctx) => {
  const amountStr = ctx.match?.trim();
  if (!amountStr) {
    await ctx.reply('Usage: /shield <amount>\nExample: /shield 1.0');
    return;
  }

  const amount = parseFloat(amountStr);
  if (isNaN(amount) || amount <= 0) {
    await ctx.reply('Invalid amount.');
    return;
  }

  let msg = `*Shield Operation*\n\n`;
  msg += `Shield ${amount} SOL into privacy pool\n\n`;
  msg += `*Flow:*\n`;
  msg += `1. Generate commitment hash\n`;
  msg += `2. Create zero-knowledge proof\n`;
  msg += `3. Transfer SOL to on-chain privacy pool\n`;
  msg += `4. Store commitment in Merkle tree\n\n`;
  msg += `*Privacy features:*\n`;
  msg += `- ZK Proofs: Groth16 (snarkjs)\n`;
  msg += `- On-chain: makora_privacy (Anchor)\n`;
  msg += `- Model: Commitment-nullifier scheme\n\n`;
  msg += `_Execute via CLI: makora shield ${amount}_`;

  await ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('health', async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized.');
    return;
  }

  await ctx.reply('Checking protocol health...');

  try {
    const phase = agent.getPhase();
    const mode = agent.getMode();
    const running = agent.isRunning();

    const lamports = await connection.getBalance(wallet.publicKey);
    const solBalance = lamports / LAMPORTS_PER_SOL;

    let msg = `*Agent Health*\n\n`;
    msg += `Mode: ${mode}\n`;
    msg += `OODA Phase: ${phase}\n`;
    msg += `Loop Running: ${running ? 'Yes' : 'No'}\n`;
    msg += `SOL Balance: ${solBalance.toFixed(4)}\n`;
    msg += `Network: ${cluster}\n`;
    msg += `Wallet: \`${wallet.publicKey.toBase58().slice(0, 8)}...${wallet.publicKey.toBase58().slice(-4)}\``;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`Health check error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

// ============================================================================
// Natural Language Fallback
// ============================================================================

bot.on('message:text', async (ctx) => {
  if (!agent) {
    await ctx.reply('Agent not initialized. Please wait...');
    return;
  }

  const text = ctx.message.text;

  // Skip if it's a command
  if (text.startsWith('/')) return;

  await ctx.reply('Processing your request...');

  try {
    const intent = agent.parseCommand(text);

    if (intent.type === 'unknown') {
      await ctx.reply(
        `I didn't understand "${text}".\n\n` +
        `Try commands like:\n` +
        `- "swap 10 SOL to USDC"\n` +
        `- "stake 5 SOL"\n` +
        `- "check my portfolio"\n` +
        `- "what strategy should I use?"\n` +
        `- "shield 1 SOL"\n\n` +
        `Or use /help for all commands.`
      );
      return;
    }

    const response = await agent.executeCommand(text);

    let msg = `*Agent Response*\n\n`;
    msg += response;

    await ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err) {
    await ctx.reply(`Error: ${err instanceof Error ? err.message : String(err)}`);
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

    await bot.start({
      onStart: (botInfo) => {
        console.log(`[Makora Telegram] Bot started as @${botInfo.username}`);
        console.log(`[Makora Telegram] Wallet: ${wallet.publicKey.toBase58()}`);
        console.log(`[Makora Telegram] Network: ${cluster}`);
      },
    });
  } catch (err) {
    console.error('[Makora Telegram] Fatal error:', err);
    process.exit(1);
  }
}

main();

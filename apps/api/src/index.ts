import express from 'express';
import cors from 'cors';
import { config as loadDotenv } from 'dotenv';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SolanaCluster, AgentMode, RiskLimits } from '@makora/types';
import {
  createConnection,
  PortfolioReader,
  JupiterPriceFeed,
  findTokenBySymbol,
  type ConnectionConfig,
} from '@makora/data-feed';
import { MakoraAgent, type AgentConfig } from '@makora/agent-core';
import { StrategyEngine } from '@makora/strategy-engine';
import { RiskManager } from '@makora/risk-manager';
import { AdapterRegistry } from '@makora/protocol-router';
import { JupiterAdapter } from '@makora/adapters-jupiter';
import { MarinadeAdapter } from '@makora/adapters-marinade';
import { PrivacyAdapter } from '@makora/adapters-privacy';
import { generateStealthMetaAddress } from '@makora/privacy';

// Load env
loadDotenv();

// ============================================================================
// Globals
// ============================================================================

let agent: MakoraAgent;
let connection: Connection;
let wallet: Keypair;
let cluster: SolanaCluster;
let jupiterAdapter: JupiterAdapter;
let marinadeAdapter: MarinadeAdapter;
let privacyAdapter: PrivacyAdapter;
let portfolioReader: PortfolioReader;
let strategyEngine: StrategyEngine;

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

  const walletPath = process.env.WALLET_PATH || resolve(
    process.env.HOME || process.env.USERPROFILE || '~',
    '.config', 'solana', 'id.json'
  );

  const raw = readFileSync(walletPath, 'utf-8');
  wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));

  const rpcUrl = process.env.SOLANA_RPC_URL || `https://api.${cluster}.solana.com`;

  // Initialize adapters
  jupiterAdapter = new JupiterAdapter();
  marinadeAdapter = new MarinadeAdapter();
  privacyAdapter = new PrivacyAdapter();

  const adapterConfig = { rpcUrl, walletPublicKey: wallet.publicKey };
  await jupiterAdapter.initialize(adapterConfig);
  await marinadeAdapter.initialize(adapterConfig);
  await privacyAdapter.initialize(adapterConfig);

  // Initialize data services
  portfolioReader = new PortfolioReader(connection, cluster);
  strategyEngine = new StrategyEngine();

  // Initialize agent
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
  console.log('[Makora API] Agent initialized');
}

// ============================================================================
// Express App
// ============================================================================

const app = express();
app.use(cors());
app.use(express.json());

// ---- Health ----

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'makora-api',
    version: '0.1.0',
    network: cluster,
    wallet: wallet?.publicKey.toBase58(),
    timestamp: Date.now(),
  });
});

// ---- Portfolio ----

app.get('/api/portfolio/:wallet', async (req, res) => {
  try {
    const ownerPubkey = new PublicKey(req.params.wallet);
    const portfolio = await portfolioReader.getPortfolio(ownerPubkey);

    res.json({
      owner: portfolio.owner.toBase58(),
      totalValueUsd: portfolio.totalValueUsd,
      solBalance: portfolio.solBalance,
      balances: portfolio.balances.map(b => ({
        symbol: b.token.symbol,
        name: b.token.name,
        mint: b.token.mint.toBase58(),
        decimals: b.token.decimals,
        rawBalance: b.rawBalance.toString(),
        uiBalance: b.uiBalance,
        usdValue: b.usdValue,
        priceUsd: b.priceUsd,
      })),
      lastUpdated: portfolio.lastUpdated,
    });
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- Swap Quote ----

app.get('/api/quote/swap', async (req, res) => {
  try {
    const { from, to, amount } = req.query;
    if (!from || !to || !amount) {
      res.status(400).json({ error: 'Missing params: from, to, amount' });
      return;
    }

    const fromToken = findTokenBySymbol(String(from).toUpperCase(), cluster);
    const toToken = findTokenBySymbol(String(to).toUpperCase(), cluster);

    if (!fromToken || !toToken) {
      res.status(400).json({ error: `Unknown token. Supported: SOL, USDC, mSOL` });
      return;
    }

    const rawAmount = BigInt(Math.floor(parseFloat(String(amount)) * 10 ** fromToken.decimals));

    const quote = await jupiterAdapter.getQuote({
      inputToken: fromToken.mint,
      outputToken: toToken.mint,
      amount: rawAmount,
      maxSlippageBps: 50,
    });

    res.json({
      protocol: 'jupiter',
      inputToken: fromToken.symbol,
      outputToken: toToken.symbol,
      inputAmount: String(amount),
      inputAmountRaw: rawAmount.toString(),
      expectedOutput: (Number(quote.expectedOutputAmount) / 10 ** toToken.decimals).toFixed(6),
      expectedOutputRaw: quote.expectedOutputAmount.toString(),
      minimumOutput: (Number(quote.minimumOutputAmount) / 10 ** toToken.decimals).toFixed(6),
      minimumOutputRaw: quote.minimumOutputAmount.toString(),
      priceImpactPct: quote.priceImpactPct,
      route: quote.routeDescription,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- Stake Quote ----

app.get('/api/quote/stake', async (req, res) => {
  try {
    const { amount } = req.query;
    if (!amount) {
      res.status(400).json({ error: 'Missing param: amount (in SOL)' });
      return;
    }

    const rawAmount = BigInt(Math.floor(parseFloat(String(amount)) * LAMPORTS_PER_SOL));

    const quote = await marinadeAdapter.getQuote({
      inputToken: new PublicKey('So11111111111111111111111111111111111111112'),
      outputToken: new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'),
      amount: rawAmount,
      maxSlippageBps: 10,
    });

    const expectedMsol = Number(quote.expectedOutputAmount) / LAMPORTS_PER_SOL;

    res.json({
      protocol: 'marinade',
      inputToken: 'SOL',
      outputToken: 'mSOL',
      inputAmount: String(amount),
      expectedOutput: expectedMsol.toFixed(6),
      expectedOutputRaw: quote.expectedOutputAmount.toString(),
      exchangeRate: quote.raw?.exchangeRate,
      route: quote.routeDescription,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- Strategy Evaluation ----

app.get('/api/strategy/evaluate/:wallet', async (req, res) => {
  try {
    const ownerPubkey = new PublicKey(req.params.wallet);
    const portfolio = await portfolioReader.getPortfolio(ownerPubkey);

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

    res.json({
      recommended: {
        strategyName: evaluation.recommended.strategyName,
        type: evaluation.recommended.type,
        confidence: evaluation.recommended.confidence,
        riskScore: evaluation.recommended.riskScore,
        expectedApy: evaluation.recommended.expectedApy,
        explanation: evaluation.recommended.explanation,
        actions: evaluation.recommended.actions,
      },
      marketCondition: evaluation.marketCondition,
      yieldOpportunities: evaluation.yieldOpportunities,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- Risk Check ----

app.get('/api/risk/check', async (req, res) => {
  try {
    const riskSnapshot = agent.getRiskSnapshot();
    res.json(riskSnapshot);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- Privacy: Stealth Address ----

app.post('/api/privacy/stealth-address', async (req, res) => {
  try {
    const spendKp = Keypair.generate();
    const viewKp = Keypair.generate();
    const meta = generateStealthMetaAddress(spendKp, viewKp);

    res.json({
      stealthMetaAddress: meta.encoded,
      spendPubKey: Buffer.from(meta.spendingPubKey).toString('hex'),
      viewPubKey: Buffer.from(meta.viewingPubKey).toString('hex'),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- Agent Status ----

app.get('/api/agent/status', async (req, res) => {
  try {
    const phase = agent.getPhase();
    const mode = agent.getMode();
    const running = agent.isRunning();
    const lastEval = agent.getLastEvaluation();
    const lastPortfolio = agent.getLastPortfolio();

    const lamports = await connection.getBalance(wallet.publicKey);
    const solBalance = lamports / LAMPORTS_PER_SOL;

    res.json({
      mode,
      oodaPhase: phase,
      isRunning: running,
      wallet: wallet.publicKey.toBase58(),
      network: cluster,
      solBalance,
      lastStrategy: lastEval ? {
        name: lastEval.recommended.strategyName,
        confidence: lastEval.recommended.confidence,
        market: lastEval.marketCondition.summary,
      } : null,
      portfolioValueUsd: lastPortfolio?.totalValueUsd ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- OODA Cycle ----

app.post('/api/agent/cycle', async (req, res) => {
  try {
    const result = await agent.runSingleCycle();

    res.json({
      cycleTimeMs: result.cycleTimeMs,
      proposedActions: result.proposedActions.length,
      approvedActions: result.approvedActions.length,
      rejectedActions: result.rejectedActions.length,
      actions: result.proposedActions.map(a => ({
        type: a.type,
        protocol: a.protocol,
        description: a.description,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ---- Natural Language ----

app.post('/api/agent/command', async (req, res) => {
  try {
    const { command } = req.body;
    if (!command) {
      res.status(400).json({ error: 'Missing "command" in request body' });
      return;
    }

    const intent = agent.parseCommand(command);
    const response = await agent.executeCommand(command);

    res.json({
      intent: intent.type,
      response,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ============================================================================
// Launch
// ============================================================================

const PORT = parseInt(process.env.PORT || '8080', 10);

async function main() {
  console.log('[Makora API] Starting...');

  try {
    await initializeAgent();
    console.log('[Makora API] Agent ready');

    app.listen(PORT, () => {
      console.log(`[Makora API] Listening on port ${PORT}`);
      console.log(`[Makora API] Wallet: ${wallet.publicKey.toBase58()}`);
      console.log(`[Makora API] Network: ${cluster}`);
      console.log('');
      console.log('Endpoints:');
      console.log(`  GET  /api/health`);
      console.log(`  GET  /api/portfolio/:wallet`);
      console.log(`  GET  /api/quote/swap?from=SOL&to=USDC&amount=10`);
      console.log(`  GET  /api/quote/stake?amount=5`);
      console.log(`  GET  /api/strategy/evaluate/:wallet`);
      console.log(`  GET  /api/risk/check`);
      console.log(`  POST /api/privacy/stealth-address`);
      console.log(`  GET  /api/agent/status`);
      console.log(`  POST /api/agent/cycle`);
      console.log(`  POST /api/agent/command`);
    });
  } catch (err) {
    console.error('[Makora API] Fatal error:', err);
    process.exit(1);
  }
}

main();

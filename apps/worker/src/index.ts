/**
 * Makora Worker — Headless agent that runs the OODA loop 24/7.
 *
 * Configuration via environment variables:
 *   LLM_PROVIDER    - anthropic | openai | qwen
 *   LLM_API_KEY     - API key for the LLM provider
 *   LLM_MODEL       - Model to use (e.g. claude-sonnet-4-20250514)
 *   SOLANA_RPC_URL   - Solana RPC endpoint (default: devnet)
 *   WALLET_PATH      - Path to keypair JSON file
 *   CYCLE_INTERVAL_MS - OODA loop interval (default: 60000)
 *   AGENT_MODE       - advisory | auto (default: advisory)
 *   PORT             - Health check port (default: 8081)
 */

import { Connection, Keypair } from '@solana/web3.js';
import * as http from 'http';
import * as fs from 'fs';

const log = (msg: string) => {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, msg });
  console.log(line);
};

async function main() {
  log('Makora Worker starting...');

  // Load environment
  const llmProvider = process.env.LLM_PROVIDER ?? '';
  const llmApiKey = process.env.LLM_API_KEY ?? '';
  const llmModel = process.env.LLM_MODEL ?? '';
  const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const walletPath = process.env.WALLET_PATH ?? '';
  const cycleIntervalMs = parseInt(process.env.CYCLE_INTERVAL_MS ?? '60000', 10);
  const agentMode = (process.env.AGENT_MODE ?? 'advisory') as 'advisory' | 'auto';
  const port = parseInt(process.env.PORT ?? '8081', 10);

  // Load wallet
  let signer: Keypair;
  if (walletPath && fs.existsSync(walletPath)) {
    const raw = JSON.parse(fs.readFileSync(walletPath, 'utf-8'));
    signer = Keypair.fromSecretKey(new Uint8Array(raw));
    log(`Wallet loaded: ${signer.publicKey.toBase58()}`);
  } else {
    signer = Keypair.generate();
    log(`No wallet found — generated ephemeral: ${signer.publicKey.toBase58()}`);
  }

  // Connect to Solana
  const connection = new Connection(rpcUrl, 'confirmed');
  log(`Connected to ${rpcUrl}`);

  // Build agent config
  const config: Record<string, unknown> = {
    connection,
    signer,
    walletPublicKey: signer.publicKey,
    cluster: rpcUrl.includes('devnet') ? 'devnet' : rpcUrl.includes('mainnet') ? 'mainnet-beta' : 'devnet',
    mode: agentMode,
    riskLimits: {
      maxPositionSizePct: 25,
      maxSlippageBps: 100,
      maxDailyLossPct: 5,
      minSolReserve: 0.05,
      maxProtocolExposurePct: 50,
    },
    cycleIntervalMs,
    autoStart: false,
    rpcUrl,
  };

  // Add LLM config if provided
  if (llmProvider && llmApiKey && llmModel) {
    config.llmConfig = {
      providerId: llmProvider,
      apiKey: llmApiKey,
      model: llmModel,
    };
    log(`LLM configured: ${llmProvider}/${llmModel}`);
  } else {
    log('No LLM provider configured — using strategy engine fallback');
  }

  config.enablePolymarket = true;

  // Initialize agent
  let agent: any;
  let cycleCount = 0;
  let lastCycleAt = 0;
  let lastError: string | null = null;

  try {
    const { MakoraAgent } = await import('@makora/agent-core');
    const { AdapterRegistry } = await import('@makora/protocol-router');

    agent = new MakoraAgent(config as any);
    const registry = new AdapterRegistry();
    await agent.initialize(registry);

    log('Agent initialized successfully');

    // Register event handler
    agent.onEvent((event: { type: string; [key: string]: unknown }) => {
      log(`Event: ${event.type}`);
    });

    // Start continuous OODA loop
    log(`Starting OODA loop (interval: ${cycleIntervalMs}ms, mode: ${agentMode})`);

    const runLoop = async () => {
      while (true) {
        try {
          const result = await agent.runSingleCycle();
          cycleCount++;
          lastCycleAt = Date.now();
          lastError = null;

          log(`Cycle ${cycleCount}: proposed=${result.proposedActions.length} approved=${result.approvedActions.length} time=${result.cycleTimeMs}ms`);
        } catch (err: any) {
          lastError = err.message ?? String(err);
          log(`Cycle error: ${lastError}`);
        }

        await new Promise((r) => setTimeout(r, cycleIntervalMs));
      }
    };

    runLoop().catch((err) => {
      log(`Fatal loop error: ${err}`);
      process.exit(1);
    });
  } catch (err: any) {
    log(`Agent init failed: ${err.message ?? err}`);
    lastError = err.message ?? String(err);
  }

  // Health check server
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    } else if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: agent ? 'running' : 'error',
        cycleCount,
        lastCycleAt,
        lastError,
        mode: agentMode,
        llmProvider: llmProvider || null,
        llmModel: llmModel || null,
        wallet: signer.publicKey.toBase58(),
        uptime: process.uptime(),
      }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(port, () => {
    log(`Health server on :${port}`);
  });
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

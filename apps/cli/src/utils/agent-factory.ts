import { Connection, Keypair } from '@solana/web3.js';
import type { AgentMode, RiskLimits, SolanaCluster } from '@makora/types';
import { createConnection, type ConnectionConfig } from '@makora/data-feed';
import { MakoraAgent, type AgentConfig } from '@makora/agent-core';
import { AdapterRegistry } from '@makora/protocol-router';
import { JupiterAdapter } from '@makora/adapters-jupiter';
import { MarinadeAdapter } from '@makora/adapters-marinade';
import { PrivacyAdapter } from '@makora/adapters-privacy';
import type { MakoraConfig } from '@makora/types';

/**
 * Create a Solana connection from CLI config.
 */
export function createConnectionFromConfig(config: MakoraConfig): {
  connection: Connection;
  connectionConfig: ConnectionConfig;
} {
  const connectionConfig: ConnectionConfig = {
    cluster: config.cluster,
    heliusApiKey: process.env.HELIUS_API_KEY,
    customRpcUrl: config.rpcUrl,
  };
  const connection = createConnection(connectionConfig);
  return { connection, connectionConfig };
}

/**
 * Create and initialize the full MakoraAgent with all adapters wired up.
 *
 * This is the central factory used by all CLI commands that need the agent stack.
 */
export async function createMakoraAgent(
  connection: Connection,
  wallet: Keypair,
  config: MakoraConfig,
): Promise<MakoraAgent> {
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
    cluster: config.cluster as SolanaCluster,
    mode: config.mode as AgentMode,
    riskLimits,
    cycleIntervalMs: 30_000,
    autoStart: false,
    rpcUrl: config.rpcUrl,
  };

  const agent = new MakoraAgent(agentConfig);

  // Create adapter registry with real adapters
  const registry = new AdapterRegistry();
  registry.register(new JupiterAdapter());
  registry.register(new MarinadeAdapter());
  registry.register(new PrivacyAdapter());

  await agent.initialize(registry);

  return agent;
}

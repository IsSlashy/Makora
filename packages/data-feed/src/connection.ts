import { Connection, type Commitment } from '@solana/web3.js';
import type { SolanaCluster } from '@makora/types';

/** RPC endpoints by cluster */
const RPC_ENDPOINTS: Record<SolanaCluster, { primary: string; fallback: string }> = {
  devnet: {
    primary: '', // Set via HELIUS_API_KEY env var
    fallback: 'https://api.devnet.solana.com',
  },
  'mainnet-beta': {
    primary: '',
    fallback: 'https://api.mainnet-beta.solana.com',
  },
  localnet: {
    primary: 'http://127.0.0.1:8899',
    fallback: 'http://127.0.0.1:8899',
  },
};

export interface ConnectionConfig {
  cluster: SolanaCluster;
  heliusApiKey?: string;
  customRpcUrl?: string;
  commitment?: Commitment;
}

/**
 * Creates a Solana connection with Helius as primary and public RPC as fallback.
 *
 * Priority order:
 * 1. Custom RPC URL (if provided)
 * 2. Helius (if API key is provided)
 * 3. Public RPC (always available)
 */
export function createConnection(config: ConnectionConfig): Connection {
  const { cluster, heliusApiKey, customRpcUrl, commitment = 'confirmed' } = config;

  let rpcUrl: string;

  if (customRpcUrl) {
    rpcUrl = customRpcUrl;
  } else if (heliusApiKey && cluster !== 'localnet') {
    const subdomain = cluster === 'devnet' ? 'devnet' : 'mainnet';
    rpcUrl = `https://${subdomain}.helius-rpc.com/?api-key=${heliusApiKey}`;
  } else {
    rpcUrl = RPC_ENDPOINTS[cluster].fallback;
  }

  return new Connection(rpcUrl, {
    commitment,
    confirmTransactionInitialTimeout: 60_000,
  });
}

/**
 * Get the RPC URL that would be used for a given config.
 * Useful for display/logging without exposing the full API key.
 */
export function getRpcDisplayUrl(config: ConnectionConfig): string {
  if (config.customRpcUrl) {
    return config.customRpcUrl;
  }
  if (config.heliusApiKey && config.cluster !== 'localnet') {
    const subdomain = config.cluster === 'devnet' ? 'devnet' : 'mainnet';
    return `https://${subdomain}.helius-rpc.com/?api-key=***`;
  }
  return RPC_ENDPOINTS[config.cluster].fallback;
}

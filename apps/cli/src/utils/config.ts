import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { MakoraConfig, SolanaCluster } from '@makora/types';

/**
 * Load Makora configuration from environment variables and .env file.
 */
export function loadConfig(): MakoraConfig {
  // Try to load .env file
  try {
    loadDotenv({ path: resolve(process.cwd(), '.env') });
  } catch {
    // dotenv not critical
  }

  const cluster = (process.env.SOLANA_NETWORK || 'devnet') as SolanaCluster;
  const heliusApiKey = process.env.HELIUS_API_KEY;

  let rpcUrl: string;
  if (process.env.SOLANA_RPC_URL) {
    rpcUrl = process.env.SOLANA_RPC_URL;
  } else if (heliusApiKey) {
    const subdomain = cluster === 'devnet' ? 'devnet' : 'mainnet';
    rpcUrl = `https://${subdomain}.helius-rpc.com/?api-key=${heliusApiKey}`;
  } else {
    rpcUrl = cluster === 'localnet'
      ? 'http://127.0.0.1:8899'
      : `https://api.${cluster}.solana.com`;
  }

  return {
    cluster,
    rpcUrl,
    rpcFallback: process.env.SOLANA_RPC_FALLBACK || `https://api.${cluster}.solana.com`,
    walletPath: process.env.WALLET_PATH || resolve(
      process.env.HOME || process.env.USERPROFILE || '~',
      '.config', 'solana', 'id.json'
    ),
    mode: (process.env.MAKORA_MODE as 'advisory' | 'auto') || 'advisory',
    logLevel: (process.env.MAKORA_LOG_LEVEL as MakoraConfig['logLevel']) || 'info',
  };
}

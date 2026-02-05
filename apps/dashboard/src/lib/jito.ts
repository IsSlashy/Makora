/**
 * Jito Bundle Integration for Low-Latency Transaction Execution
 *
 * Jito provides ~100ms faster block inclusion through their block engine.
 * This is critical for time-sensitive trades like perps.
 *
 * Docs: https://docs.jito.wtf/lowlatencytxnsend/
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

// ─── Jito Block Engine Endpoints ─────────────────────────────────────────────

// Mainnet block engines (load balanced)
const JITO_MAINNET_ENDPOINTS = [
  'https://mainnet.block-engine.jito.wtf',
  'https://amsterdam.mainnet.block-engine.jito.wtf',
  'https://frankfurt.mainnet.block-engine.jito.wtf',
  'https://ny.mainnet.block-engine.jito.wtf',
  'https://tokyo.mainnet.block-engine.jito.wtf',
];

// Jito tip accounts - send tip to any of these
const JITO_TIP_ACCOUNTS = [
  '96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5',
  'HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe',
  'Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY',
  'ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49',
  'DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh',
  'ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt',
  'DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL',
  '3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT',
];

// ─── Types ───────────────────────────────────────────────────────────────────

export interface JitoConfig {
  enabled: boolean;
  tipLamports: number; // Tip amount in lamports (recommended: 1000-10000 for normal, 50000+ for urgent)
  endpoint?: string; // Override default endpoint
}

export interface JitoBundleResult {
  success: boolean;
  bundleId?: string;
  signatures?: string[];
  error?: string;
  landedSlot?: number;
}

export interface JitoSingleTxResult {
  success: boolean;
  signature?: string;
  error?: string;
}

// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Get a random Jito tip account
 */
export function getRandomTipAccount(): PublicKey {
  const idx = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
  return new PublicKey(JITO_TIP_ACCOUNTS[idx]);
}

/**
 * Get a random Jito block engine endpoint
 */
export function getJitoEndpoint(): string {
  const idx = Math.floor(Math.random() * JITO_MAINNET_ENDPOINTS.length);
  return JITO_MAINNET_ENDPOINTS[idx];
}

/**
 * Create a tip transaction to include in a Jito bundle
 */
export async function createTipTransaction(
  connection: Connection,
  payer: PublicKey,
  tipLamports: number,
): Promise<Transaction> {
  const tipAccount = getRandomTipAccount();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');

  const tipTx = new Transaction({
    feePayer: payer,
    blockhash,
    lastValidBlockHeight,
  }).add(
    SystemProgram.transfer({
      fromPubkey: payer,
      toPubkey: tipAccount,
      lamports: tipLamports,
    }),
  );

  return tipTx;
}

// ─── Single Transaction (Low Latency) ────────────────────────────────────────

/**
 * Send a single transaction via Jito for low-latency inclusion.
 * This is simpler than bundles and good for individual swaps.
 */
export async function sendTransactionViaJito(
  signedTx: VersionedTransaction,
  config: JitoConfig = { enabled: true, tipLamports: 10000 },
): Promise<JitoSingleTxResult> {
  if (!config.enabled) {
    return { success: false, error: 'Jito disabled' };
  }

  const endpoint = config.endpoint || getJitoEndpoint();
  const txBase64 = Buffer.from(signedTx.serialize()).toString('base64');

  try {
    const response = await fetch(`${endpoint}/api/v1/transactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendTransaction',
        params: [txBase64, { encoding: 'base64' }],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Jito HTTP ${response.status}: ${text.slice(0, 200)}` };
    }

    const result = await response.json();

    if (result.error) {
      return { success: false, error: result.error.message || JSON.stringify(result.error) };
    }

    return {
      success: true,
      signature: result.result,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Jito request failed',
    };
  }
}

// ─── Bundle Submission ───────────────────────────────────────────────────────

/**
 * Send a bundle of transactions via Jito.
 * All transactions in the bundle execute atomically (all or nothing).
 *
 * @param signedTxs - Array of signed transactions (tip tx should be last)
 * @param config - Jito configuration
 */
export async function sendBundleViaJito(
  signedTxs: VersionedTransaction[],
  config: JitoConfig = { enabled: true, tipLamports: 10000 },
): Promise<JitoBundleResult> {
  if (!config.enabled) {
    return { success: false, error: 'Jito disabled' };
  }

  if (signedTxs.length === 0) {
    return { success: false, error: 'Empty bundle' };
  }

  if (signedTxs.length > 5) {
    return { success: false, error: 'Bundle too large (max 5 transactions)' };
  }

  const endpoint = config.endpoint || getJitoEndpoint();
  const encodedTxs = signedTxs.map(tx => Buffer.from(tx.serialize()).toString('base64'));

  try {
    const response = await fetch(`${endpoint}/api/v1/bundles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'sendBundle',
        params: [encodedTxs],
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      return { success: false, error: `Jito HTTP ${response.status}: ${text.slice(0, 200)}` };
    }

    const result = await response.json();

    if (result.error) {
      return { success: false, error: result.error.message || JSON.stringify(result.error) };
    }

    return {
      success: true,
      bundleId: result.result,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Jito bundle request failed',
    };
  }
}

/**
 * Check the status of a submitted bundle
 */
export async function getBundleStatus(
  bundleId: string,
  endpoint?: string,
): Promise<{ status: string; landedSlot?: number; error?: string }> {
  const jitoEndpoint = endpoint || getJitoEndpoint();

  try {
    const response = await fetch(`${jitoEndpoint}/api/v1/bundles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getBundleStatuses',
        params: [[bundleId]],
      }),
    });

    if (!response.ok) {
      return { status: 'unknown', error: `HTTP ${response.status}` };
    }

    const result = await response.json();

    if (result.error) {
      return { status: 'unknown', error: result.error.message };
    }

    const bundleStatus = result.result?.value?.[0];
    if (!bundleStatus) {
      return { status: 'pending' };
    }

    return {
      status: bundleStatus.confirmation_status || 'pending',
      landedSlot: bundleStatus.slot,
    };
  } catch (err) {
    return {
      status: 'unknown',
      error: err instanceof Error ? err.message : 'Status check failed',
    };
  }
}

// ─── Utility: Check if network supports Jito ─────────────────────────────────

export function isJitoSupported(network: string): boolean {
  // Jito only works on mainnet
  return network === 'mainnet-beta' || network === 'mainnet';
}

// ─── Default Config ──────────────────────────────────────────────────────────

export const DEFAULT_JITO_CONFIG: JitoConfig = {
  enabled: true,
  tipLamports: 10000, // 0.00001 SOL tip (~$0.002 at $200/SOL)
};

export const URGENT_JITO_CONFIG: JitoConfig = {
  enabled: true,
  tipLamports: 100000, // 0.0001 SOL tip (~$0.02 at $200/SOL) for time-sensitive trades
};

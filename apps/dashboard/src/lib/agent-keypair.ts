import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import * as fs from 'fs';

/**
 * Securely load an agent keypair from environment configuration.
 *
 * Supports:
 * 1. AGENT_KEYPAIR_PATH — path to a Solana CLI keyfile (preferred)
 * 2. AGENT_KEYPAIR — JSON byte array [1,2,...,64] or base58 private key (Phantom export)
 *
 * Returns null if no keypair is configured (wallet-mode signing).
 * Throws on invalid/corrupt key data.
 */
export function loadAgentKeypair(): Keypair | null {
  // Block browser-context loading
  if (typeof window !== 'undefined') {
    console.warn('loadAgentKeypair: blocked in browser context');
    return null;
  }

  // Preferred: file-based keypair
  const keyPath = process.env.AGENT_KEYPAIR_PATH;
  if (keyPath) {
    return loadFromFile(keyPath);
  }

  // Inline: JSON array or base58 string
  const keyData = process.env.AGENT_KEYPAIR;
  if (keyData) {
    return parseAndValidate(keyData.trim(), 'AGENT_KEYPAIR env');
  }

  return null;
}

function loadFromFile(path: string): Keypair {
  if (!fs.existsSync(path)) {
    throw new Error(`Agent keypair file not found: ${path}`);
  }

  const raw = fs.readFileSync(path, 'utf-8').trim();
  return parseAndValidate(raw, path);
}

function parseAndValidate(input: string, source: string): Keypair {
  // Try JSON array first (Solana CLI format: [1,2,...,64])
  if (input.startsWith('[')) {
    let bytes: number[];
    try {
      bytes = JSON.parse(input);
    } catch {
      throw new Error(`Invalid JSON in agent keypair (${source})`);
    }

    if (!Array.isArray(bytes) || bytes.length !== 64) {
      throw new Error(
        `Agent keypair must be a 64-byte array, got ${Array.isArray(bytes) ? bytes.length : typeof bytes} (${source})`,
      );
    }

    for (let i = 0; i < bytes.length; i++) {
      if (typeof bytes[i] !== 'number' || bytes[i] < 0 || bytes[i] > 255 || !Number.isInteger(bytes[i])) {
        throw new Error(`Invalid byte at index ${i} in agent keypair (${source})`);
      }
    }

    const keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
    keypair.publicKey.toBase58();
    return keypair;
  }

  // Try base58 (Phantom export format)
  try {
    const decoded = bs58.decode(input);
    if (decoded.length !== 64) {
      throw new Error(`Base58 key decoded to ${decoded.length} bytes, expected 64 (${source})`);
    }
    const keypair = Keypair.fromSecretKey(decoded);
    keypair.publicKey.toBase58();
    return keypair;
  } catch (e) {
    if (e instanceof Error && e.message.includes('expected 64')) throw e;
    throw new Error(`Could not parse agent keypair as JSON array or base58 (${source})`);
  }
}

import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';

/**
 * Load a Solana keypair from a JSON file path.
 * Compatible with `solana-keygen` output format (JSON array of bytes).
 */
export function loadWalletFromFile(path: string): Keypair {
  try {
    const raw = readFileSync(path, 'utf-8');
    const secretKey = Uint8Array.from(JSON.parse(raw));
    return Keypair.fromSecretKey(secretKey);
  } catch (err) {
    throw new Error(
      `Failed to load wallet from ${path}. ` +
      `Ensure you have a Solana keypair at this path. ` +
      `Run 'solana-keygen new' to create one.\n` +
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

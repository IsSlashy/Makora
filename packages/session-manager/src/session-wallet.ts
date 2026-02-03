import { Keypair, Connection, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';

/**
 * Ephemeral wallet for a single stealth trading session.
 * Generated from crypto.randomBytes (not HD-derived) to avoid derivation path leakage.
 * Automatically expires after a configured duration.
 */
export class SessionWallet {
  readonly keypair: Keypair;
  readonly createdAt: number;
  readonly expiresAt: number;
  fundedAmount: number;
  private destroyed = false;

  constructor(durationMs: number, fundedAmount: number = 0) {
    this.keypair = Keypair.generate(); // Uses crypto.randomBytes internally
    this.createdAt = Date.now();
    this.expiresAt = this.createdAt + durationMs;
    this.fundedAmount = fundedAmount;
  }

  /** Whether this session wallet has expired */
  isExpired(): boolean {
    return Date.now() >= this.expiresAt;
  }

  /** Milliseconds until expiry */
  timeRemainingMs(): number {
    return Math.max(0, this.expiresAt - Date.now());
  }

  /** Get on-chain SOL balance */
  async getBalance(connection: Connection): Promise<number> {
    if (this.destroyed) return 0;
    const lamports = await connection.getBalance(this.keypair.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  }

  /** Sign a transaction with this ephemeral keypair */
  signTransaction(tx: Transaction): Transaction {
    if (this.destroyed) throw new Error('Session wallet has been destroyed');
    tx.partialSign(this.keypair);
    return tx;
  }

  /**
   * Securely destroy the keypair by zeroing out the secret key bytes.
   * After this, the wallet cannot sign any transactions.
   */
  destroy(): void {
    if (this.destroyed) return;
    // Zero out the secret key bytes in memory
    const secretKey = this.keypair.secretKey;
    for (let i = 0; i < secretKey.length; i++) {
      secretKey[i] = 0;
    }
    this.destroyed = true;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

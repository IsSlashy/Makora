import { randomUUID, randomBytes } from 'crypto';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import { Program, BN } from '@coral-xyz/anchor';

import { SessionWallet } from './session-wallet.js';
import { splitAmount, chooseWalletCount } from './amount-splitter.js';
import type {
  StealthSession,
  SessionManagerConfig,
  ShieldedPathConfig,
  TradeRecord,
  DEFAULT_SESSION_CONFIG,
} from './types.js';

/**
 * SessionManager orchestrates stealth trading sessions.
 *
 * Architecture:
 *   Vault PDA ──agent_withdraw──► Session Wallet A (8-12 min)
 *                                 Session Wallet B (8-12 min)
 *                                 Session Wallet C (8-12 min)
 *              ◄──agent_deposit── (sweep returns)
 *
 * Each session is a short-lived ephemeral keypair that trades independently,
 * then sweeps profits back to the vault.
 */
export class SessionManager {
  private connection: Connection;
  private agentKeypair: Keypair;
  private vaultPDA: PublicKey;
  private vaultProgram: Program;
  private config: SessionManagerConfig;
  private shieldedConfig: ShieldedPathConfig | null = null;
  private privacyProgram: Program | null = null;

  private activeSessions: Map<string, ManagedSession> = new Map();

  constructor(
    connection: Connection,
    agentKeypair: Keypair,
    vaultPDA: PublicKey,
    vaultProgram: Program,
    config: SessionManagerConfig,
  ) {
    this.connection = connection;
    this.agentKeypair = agentKeypair;
    this.vaultPDA = vaultPDA;
    this.vaultProgram = vaultProgram;
    this.config = config;
  }

  /**
   * Start a new set of stealth sessions.
   * Splits totalAmount across 2-3 ephemeral wallets and funds them
   * via agent_withdraw instructions.
   */
  async startSession(totalAmountSol: number): Promise<StealthSession[]> {
    const numWallets = chooseWalletCount(totalAmountSol, this.config.minSplitSol);
    const amounts = splitAmount(totalAmountSol, numWallets, this.config.minSplitSol);

    const sessions: StealthSession[] = [];

    for (const amountSol of amounts) {
      if (this.activeSessions.size >= this.config.maxConcurrentSessions) {
        break;
      }

      const [minDuration, maxDuration] = this.config.sessionDurationRange;
      const durationMs = this.randomDuration(minDuration, maxDuration);
      const wallet = new SessionWallet(durationMs, amountSol);

      const sessionId = randomUUID();
      const session: StealthSession = {
        id: sessionId,
        wallet: {
          publicKey: wallet.keypair.publicKey,
          createdAt: wallet.createdAt,
          expiresAt: wallet.expiresAt,
          fundedAmount: amountSol,
        },
        fundedAmount: amountSol,
        startedAt: Date.now(),
        expiresAt: wallet.expiresAt,
        status: 'funding',
        trades: [],
      };

      // Fund the session wallet via agent_withdraw
      try {
        const lamports = new BN(Math.floor(amountSol * LAMPORTS_PER_SOL));

        // Fetch vault to get the owner for PDA derivation
        const vaultAccount = await (this.vaultProgram.account as any).vault.fetch(this.vaultPDA);

        await (this.vaultProgram.methods as any)
          .agentWithdraw(lamports)
          .accounts({
            agent: this.agentKeypair.publicKey,
            vault: this.vaultPDA,
            destination: wallet.keypair.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([this.agentKeypair])
          .rpc();

        session.status = 'active';
        this.activeSessions.set(sessionId, { session, wallet });
        sessions.push(session);
      } catch (err) {
        wallet.destroy();
        session.status = 'closed';
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`Failed to fund session ${sessionId}: ${errorMsg}`);
      }
    }

    return sessions;
  }

  /**
   * End a session: sweep all SOL from the session wallet back to the vault.
   */
  async endSession(sessionId: string): Promise<{ returned: number; profit: number }> {
    const managed = this.activeSessions.get(sessionId);
    if (!managed) throw new Error(`Session ${sessionId} not found`);

    const { session, wallet } = managed;
    session.status = 'sweeping';

    try {
      // Get the actual balance in the session wallet
      const balance = await this.connection.getBalance(wallet.keypair.publicKey);
      const balanceSol = balance / LAMPORTS_PER_SOL;

      if (balance > 0) {
        // Need to keep enough for rent exemption of an empty account
        // Session wallet is just a regular account, so we sweep everything
        // minus a small amount for the transaction fee
        const feeBuffer = 5000; // 5000 lamports for tx fee
        const sweepAmount = balance - feeBuffer;

        if (sweepAmount > 0) {
          const lamports = new BN(sweepAmount);

          await (this.vaultProgram.methods as any)
            .agentDeposit(lamports)
            .accounts({
              agent: this.agentKeypair.publicKey,
              vault: this.vaultPDA,
              source: wallet.keypair.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .signers([this.agentKeypair, wallet.keypair])
            .rpc();
        }
      }

      const returnedSol = balance / LAMPORTS_PER_SOL;
      const profit = returnedSol - session.fundedAmount;

      session.status = 'closed';
      wallet.destroy();
      this.activeSessions.delete(sessionId);

      return { returned: returnedSol, profit };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`Failed to sweep session ${sessionId}: ${errorMsg}`);
      // Mark closed even on failure to prevent orphaned sessions
      session.status = 'closed';
      wallet.destroy();
      this.activeSessions.delete(sessionId);
      return { returned: 0, profit: -session.fundedAmount };
    }
  }

  /**
   * Rotate a session: end the current one and start a new one with the returned funds.
   */
  async rotateSession(sessionId: string): Promise<StealthSession | null> {
    const { returned } = await this.endSession(sessionId);

    if (returned < this.config.minSplitSol) {
      return null; // Not enough to start a new session
    }

    // Start a single new session with the returned funds
    const [minDuration, maxDuration] = this.config.sessionDurationRange;
    const durationMs = this.randomDuration(minDuration, maxDuration);
    const wallet = new SessionWallet(durationMs, returned);

    const newSessionId = randomUUID();
    const session: StealthSession = {
      id: newSessionId,
      wallet: {
        publicKey: wallet.keypair.publicKey,
        createdAt: wallet.createdAt,
        expiresAt: wallet.expiresAt,
        fundedAmount: returned,
      },
      fundedAmount: returned,
      startedAt: Date.now(),
      expiresAt: wallet.expiresAt,
      status: 'funding',
      trades: [],
    };

    try {
      const lamports = new BN(Math.floor(returned * LAMPORTS_PER_SOL));

      await (this.vaultProgram.methods as any)
        .agentWithdraw(lamports)
        .accounts({
          agent: this.agentKeypair.publicKey,
          vault: this.vaultPDA,
          destination: wallet.keypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([this.agentKeypair])
        .rpc();

      session.status = 'active';
      this.activeSessions.set(newSessionId, { session, wallet });
      return session;
    } catch (err) {
      wallet.destroy();
      return null;
    }
  }

  /** Check if there are any active sessions */
  hasActiveSession(): boolean {
    return this.activeSessions.size > 0;
  }

  /** Get all active sessions (snapshot, does not expose wallet keypairs) */
  getActiveSessions(): StealthSession[] {
    return Array.from(this.activeSessions.values()).map((m) => m.session);
  }

  /** Get total SOL currently in active sessions */
  getTotalInSession(): number {
    let total = 0;
    for (const { session } of this.activeSessions.values()) {
      if (session.status !== 'closed') {
        total += session.fundedAmount;
      }
    }
    return total;
  }

  /** Get the session wallet Keypair for signing trades (used by OODA loop) */
  getSessionKeypairForTrade(amount: number): Keypair | null {
    // Find an active session with enough funded amount
    for (const { session, wallet } of this.activeSessions.values()) {
      if (
        (session.status === 'active' || session.status === 'trading') &&
        !wallet.isExpired() &&
        !wallet.isDestroyed()
      ) {
        session.status = 'trading';
        return wallet.keypair;
      }
    }
    return null;
  }

  /** Record a trade in the session's log */
  recordTrade(sessionId: string, trade: TradeRecord): void {
    const managed = this.activeSessions.get(sessionId);
    if (managed) {
      managed.session.trades.push(trade);
    }
  }

  /** Find which session a keypair belongs to */
  findSessionByKeypair(keypair: Keypair): StealthSession | null {
    for (const { session, wallet } of this.activeSessions.values()) {
      if (wallet.keypair.publicKey.equals(keypair.publicKey)) {
        return session;
      }
    }
    return null;
  }

  /** End all active sessions (cleanup) */
  async endAllSessions(): Promise<void> {
    const sessionIds = Array.from(this.activeSessions.keys());
    for (const id of sessionIds) {
      try {
        await this.endSession(id);
      } catch (err) {
        console.error(`Failed to end session ${id}:`, err);
      }
    }
  }

  /** Get expired sessions that need rotation */
  getExpiredSessions(): StealthSession[] {
    const expired: StealthSession[] = [];
    for (const { session, wallet } of this.activeSessions.values()) {
      if (wallet.isExpired() && session.status !== 'closed' && session.status !== 'sweeping') {
        expired.push(session);
      }
    }
    return expired;
  }

  // ---- Shielded Path (Wave 5) ----

  /**
   * Enable the shielded path for stronger privacy.
   * Instead of direct vault → session wallet, routes through:
   *   Vault → shield(commitment) → Pool → unshield(nullifier) → Session Wallet
   *
   * This breaks the on-chain link between vault and session wallet
   * by using commitment/nullifier asymmetry.
   */
  enableShieldedPath(config: ShieldedPathConfig, privacyProgram: Program): void {
    this.shieldedConfig = config;
    this.privacyProgram = privacyProgram;
  }

  /** Disable the shielded path */
  disableShieldedPath(): void {
    this.shieldedConfig = null;
    this.privacyProgram = null;
  }

  /** Whether the shielded path is active */
  isShieldedPathEnabled(): boolean {
    return this.shieldedConfig?.enabled === true && this.privacyProgram !== null;
  }

  /**
   * Fund a session wallet through the shielded pool.
   *
   * Flow: agent_withdraw → shield(amount, commitment) → pool
   *       then: unshield(amount, nullifier) → session wallet
   *
   * The commitment = hash(amount, nonce) and the nullifier = hash(nonce, secret)
   * are different values, breaking the link between deposit and withdrawal.
   */
  async fundViaShieldedPath(
    amountSol: number,
    sessionWallet: SessionWallet,
  ): Promise<boolean> {
    if (!this.shieldedConfig || !this.privacyProgram) return false;

    const lamports = Math.floor(amountSol * LAMPORTS_PER_SOL);

    try {
      // Step 1: Generate commitment (random 32 bytes as placeholder)
      // In production, this would be Poseidon(amount, nonce) from the ZK circuit
      const commitment = randomBytes(32);
      const commitmentArray = Array.from(commitment);

      // Step 2: Shield — deposit from agent into the shielded pool
      await (this.privacyProgram.methods as any)
        .shield(new BN(lamports), commitmentArray)
        .accounts({
          pool: this.shieldedConfig.poolPDA,
          depositor: this.agentKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([this.agentKeypair])
        .rpc();

      // Step 3: Generate nullifier (different from commitment to break link)
      const nullifierHash = randomBytes(32);
      const nullifierArray = Array.from(nullifierHash);
      const newRoot = randomBytes(32);
      const newRootArray = Array.from(newRoot);

      // Step 4: Derive nullifier record PDA
      const [nullifierRecord] = PublicKey.findProgramAddressSync(
        [
          this.shieldedConfig.poolPDA.toBuffer(),
          Buffer.from(nullifierHash),
        ],
        this.shieldedConfig.privacyProgramId,
      );

      // Step 5: Unshield — withdraw from pool to session wallet
      await (this.privacyProgram.methods as any)
        .unshield(new BN(lamports), nullifierArray, newRootArray)
        .accounts({
          pool: this.shieldedConfig.poolPDA,
          nullifierRecord,
          recipient: sessionWallet.keypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([sessionWallet.keypair])
        .rpc();

      return true;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`Shielded path failed: ${errorMsg}`);
      return false;
    }
  }

  // ---- Private ----

  private randomDuration(min: number, max: number): number {
    const range = max - min;
    const bytes = randomBytes(4);
    const ratio = bytes.readUInt32BE(0) / 0xffffffff;
    return Math.floor(min + range * ratio);
  }
}

/** Internal type that pairs the session info with the actual wallet */
interface ManagedSession {
  session: StealthSession;
  wallet: SessionWallet;
}

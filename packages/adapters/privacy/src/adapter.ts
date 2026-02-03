import {
  Connection,
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import type {
  ProtocolAdapter,
  ProtocolHealth,
  ProtocolCapability,
  ActionType,
  Quote,
  QuoteParams,
  SwapParams,
  Position,
  AdapterConfig,
  TokenInfo,
} from '@makora/types';
import { PRIVACY_PROGRAM_ID, SEEDS, DEFAULT_PRIVACY_FEE_BPS, MAX_SHIELD_AMOUNT } from './constants.js';

/**
 * Privacy Protocol Adapter
 *
 * Wraps the makora_privacy Anchor program behind the uniform ProtocolAdapter interface.
 * Supports shield (deposit into privacy pool) and unshield (withdraw from pool)
 * operations, plus stealth address payments.
 *
 * This adapter enables the agent to seamlessly route privacy operations
 * through the same execution engine as DeFi operations.
 */
export class PrivacyAdapter implements ProtocolAdapter {
  readonly protocolId = 'privacy' as const;
  readonly name = 'Makora Privacy';
  readonly version = '0.1';

  private connection!: Connection;
  private walletPublicKey!: PublicKey;
  private initialized = false;

  async initialize(config: AdapterConfig): Promise<void> {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.walletPublicKey = config.walletPublicKey;
    this.initialized = true;
  }

  async healthCheck(): Promise<ProtocolHealth> {
    const start = Date.now();
    try {
      // Check if the privacy program is deployed
      const accountInfo = await this.connection.getAccountInfo(PRIVACY_PROGRAM_ID);
      const isDeployed = accountInfo !== null && accountInfo.executable;

      return {
        protocolId: this.protocolId,
        isHealthy: isDeployed,
        latencyMs: Date.now() - start,
        lastChecked: Date.now(),
        error: isDeployed ? undefined : 'Privacy program not deployed',
      };
    } catch (err) {
      return {
        protocolId: this.protocolId,
        isHealthy: false,
        latencyMs: Date.now() - start,
        lastChecked: Date.now(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  getCapabilities(): ProtocolCapability[] {
    return ['shield', 'unshield'];
  }

  supportsAction(actionType: ActionType): boolean {
    return actionType === 'shield' || actionType === 'unshield';
  }

  async getPositions(owner: PublicKey): Promise<Position[]> {
    this.ensureInitialized();

    // Derive the pool PDA to check shielded balance
    const [poolPda] = PublicKey.findProgramAddressSync(
      [SEEDS.POOL, owner.toBuffer()],
      PRIVACY_PROGRAM_ID
    );

    try {
      const accountInfo = await this.connection.getAccountInfo(poolPda);
      if (!accountInfo) return [];

      // Parse pool account data (simplified - read total_shielded at known offset)
      // ShieldedPool layout: discriminator(8) + authority(32) + merkle_root(32) + next_leaf_index(8) + total_shielded(8)
      const data = accountInfo.data;
      const totalShielded = data.readBigUInt64LE(80); // offset 8 + 32 + 32 + 8

      if (totalShielded === 0n) return [];

      return [{
        protocolId: this.protocolId,
        type: 'shielded',
        token: {
          symbol: 'SOL',
          name: 'Solana',
          mint: PublicKey.default,
          decimals: 9,
        } as TokenInfo,
        amount: totalShielded,
        usdValue: 0, // Will be filled by the strategy engine
        metadata: {
          poolAddress: poolPda.toBase58(),
        },
      }];
    } catch {
      return [];
    }
  }

  async getQuote(params: QuoteParams): Promise<Quote> {
    this.ensureInitialized();

    // Privacy operations don't have variable pricing
    // The "quote" is the amount minus the privacy fee
    const feeAmount = (params.amount * BigInt(DEFAULT_PRIVACY_FEE_BPS)) / 10000n;
    const outputAmount = params.amount - feeAmount;

    return {
      protocolId: this.protocolId,
      inputToken: { symbol: 'SOL', name: 'Solana', mint: params.inputToken, decimals: 9 } as TokenInfo,
      outputToken: { symbol: 'SOL', name: 'Solana (Shielded)', mint: params.outputToken, decimals: 9 } as TokenInfo,
      inputAmount: params.amount,
      expectedOutputAmount: outputAmount,
      minimumOutputAmount: outputAmount,
      priceImpactPct: 0,
      feesUsd: 0, // Minimal
      routeDescription: 'Direct shield/unshield via Makora Privacy',
      raw: { feeAmount, feeBps: DEFAULT_PRIVACY_FEE_BPS },
    };
  }

  /**
   * Build shield instructions (deposit SOL into privacy pool).
   * Uses the ProtocolAdapter.buildSwapIx interface for uniformity.
   */
  async buildSwapIx(params: SwapParams): Promise<TransactionInstruction[]> {
    this.ensureInitialized();
    return this.buildShieldIx(params.userPublicKey, params.amount);
  }

  async buildDepositIx(params: { token: PublicKey; amount: bigint; destination: PublicKey; userPublicKey: PublicKey }): Promise<TransactionInstruction[]> {
    return this.buildShieldIx(params.userPublicKey, params.amount);
  }

  async buildWithdrawIx(params: { token: PublicKey; amount: bigint; source: PublicKey; userPublicKey: PublicKey }): Promise<TransactionInstruction[]> {
    return this.buildUnshieldIx(params.userPublicKey, params.amount);
  }

  // ---- Privacy-specific methods ----

  /**
   * Build shield instruction - deposits SOL into the privacy pool.
   */
  private async buildShieldIx(
    userPublicKey: PublicKey,
    amount: bigint,
  ): Promise<TransactionInstruction[]> {
    if (amount > MAX_SHIELD_AMOUNT) {
      throw new Error(`Shield amount exceeds maximum: ${amount} > ${MAX_SHIELD_AMOUNT}`);
    }

    const [poolPda] = PublicKey.findProgramAddressSync(
      [SEEDS.POOL, userPublicKey.toBuffer()],
      PRIVACY_PROGRAM_ID
    );

    // Generate a random commitment (simplified - real implementation uses Poseidon hash)
    const commitment = new Uint8Array(32);
    if (typeof globalThis.crypto !== 'undefined') {
      globalThis.crypto.getRandomValues(commitment);
    } else {
      // Node.js fallback
      const { randomBytes } = await import('crypto');
      randomBytes(32).copy(Buffer.from(commitment));
    }

    // Build the shield instruction data
    // Instruction discriminator (8 bytes) + amount (8 bytes) + commitment (32 bytes)
    const data = Buffer.alloc(48);
    // Shield instruction discriminator (hash of "global:shield" first 8 bytes)
    // We'll use a simplified discriminator for now
    data.writeBigUInt64LE(BigInt('0x' + Buffer.from('shield').toString('hex').padEnd(16, '0')), 0);
    data.writeBigUInt64LE(BigInt(amount), 8);
    Buffer.from(commitment).copy(data, 16);

    return [
      new TransactionInstruction({
        programId: PRIVACY_PROGRAM_ID,
        keys: [
          { pubkey: userPublicKey, isSigner: true, isWritable: true },
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      }),
    ];
  }

  /**
   * Build unshield instruction - withdraws SOL from the privacy pool.
   */
  private async buildUnshieldIx(
    userPublicKey: PublicKey,
    amount: bigint,
  ): Promise<TransactionInstruction[]> {
    const [poolPda] = PublicKey.findProgramAddressSync(
      [SEEDS.POOL, userPublicKey.toBuffer()],
      PRIVACY_PROGRAM_ID
    );

    // Generate nullifier hash and new root (simplified)
    const nullifierHash = new Uint8Array(32);
    const newRoot = new Uint8Array(32);
    if (typeof globalThis.crypto !== 'undefined') {
      globalThis.crypto.getRandomValues(nullifierHash);
      globalThis.crypto.getRandomValues(newRoot);
    } else {
      const { randomBytes } = await import('crypto');
      randomBytes(32).copy(Buffer.from(nullifierHash));
      randomBytes(32).copy(Buffer.from(newRoot));
    }

    const [nullifierPda] = PublicKey.findProgramAddressSync(
      [SEEDS.NULLIFIER, poolPda.toBuffer(), nullifierHash],
      PRIVACY_PROGRAM_ID
    );

    // Build the unshield instruction data
    const data = Buffer.alloc(72);
    data.writeBigUInt64LE(BigInt('0x' + Buffer.from('unshield').toString('hex').padEnd(16, '0')), 0);
    data.writeBigUInt64LE(BigInt(amount), 8);
    Buffer.from(nullifierHash).copy(data, 16);
    Buffer.from(newRoot).copy(data, 48);

    return [
      new TransactionInstruction({
        programId: PRIVACY_PROGRAM_ID,
        keys: [
          { pubkey: userPublicKey, isSigner: true, isWritable: true },
          { pubkey: poolPda, isSigner: false, isWritable: true },
          { pubkey: nullifierPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      }),
    ];
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('PrivacyAdapter not initialized. Call initialize() first.');
    }
  }
}

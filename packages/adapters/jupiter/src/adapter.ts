import { createJupiterApiClient, type QuoteResponse } from '@jup-ag/api';
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
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
import { DEFAULT_SLIPPAGE_BPS } from './constants.js';

/**
 * Jupiter DEX Aggregator Adapter
 *
 * Wraps @jup-ag/api behind the uniform ProtocolAdapter interface.
 * Jupiter aggregates Raydium, Orca, Lifinity, Meteora, Phoenix, and OpenBook
 * for optimal swap routing.
 *
 * API docs: https://station.jup.ag/docs/apis/swap-api
 */
export class JupiterAdapter implements ProtocolAdapter {
  readonly protocolId = 'jupiter' as const;
  readonly name = 'Jupiter Aggregator';
  readonly version = '6.0';

  private jupiterApi!: ReturnType<typeof createJupiterApiClient>;
  private connection!: Connection;
  private walletPublicKey!: PublicKey;
  private initialized = false;

  async initialize(config: AdapterConfig): Promise<void> {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.walletPublicKey = config.walletPublicKey;
    this.jupiterApi = createJupiterApiClient();
    this.initialized = true;
  }

  async healthCheck(): Promise<ProtocolHealth> {
    const start = Date.now();
    try {
      // Simple health check: fetch a quote for a small SOL->USDC swap
      await this.jupiterApi.quoteGet({
        inputMint: 'So11111111111111111111111111111111111111112',
        outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        amount: 1_000_000, // 0.001 SOL
      });

      return {
        protocolId: this.protocolId,
        isHealthy: true,
        latencyMs: Date.now() - start,
        lastChecked: Date.now(),
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
    return ['swap'];
  }

  supportsAction(actionType: ActionType): boolean {
    return actionType === 'swap';
  }

  async getPositions(_owner: PublicKey): Promise<Position[]> {
    // Jupiter is a swap aggregator -- it doesn't hold positions
    return [];
  }

  /**
   * Get a swap quote from Jupiter.
   *
   * Returns the optimal route across all Jupiter-connected DEXes.
   */
  async getQuote(params: QuoteParams): Promise<Quote> {
    this.ensureInitialized();

    const quoteResponse = await this.jupiterApi.quoteGet({
      inputMint: params.inputToken.toBase58(),
      outputMint: params.outputToken.toBase58(),
      amount: Number(params.amount),
      slippageBps: params.maxSlippageBps || DEFAULT_SLIPPAGE_BPS,
    });

    if (!quoteResponse) {
      throw new Error('Jupiter returned empty quote response');
    }

    // Build route description from the swap info
    const routeDesc = quoteResponse.routePlan
      ?.map((step) => step.swapInfo?.label ?? 'unknown')
      .join(' -> ') ?? 'direct';

    return {
      protocolId: this.protocolId,
      inputToken: { symbol: '', name: '', mint: params.inputToken, decimals: 0 } as TokenInfo,
      outputToken: { symbol: '', name: '', mint: params.outputToken, decimals: 0 } as TokenInfo,
      inputAmount: params.amount,
      expectedOutputAmount: BigInt(quoteResponse.outAmount),
      minimumOutputAmount: BigInt(quoteResponse.otherAmountThreshold),
      priceImpactPct: parseFloat(quoteResponse.priceImpactPct ?? '0'),
      feesUsd: 0, // Jupiter doesn't charge fees (DEX fees are in the route)
      routeDescription: routeDesc,
      raw: quoteResponse,
    };
  }

  /**
   * Build swap instructions from Jupiter.
   *
   * Returns deserialized instructions that can be composed into a transaction.
   */
  async buildSwapIx(params: SwapParams): Promise<TransactionInstruction[]> {
    this.ensureInitialized();

    // First get a quote
    const quote = await this.getQuote({
      inputToken: params.inputToken,
      outputToken: params.outputToken,
      amount: params.amount,
      maxSlippageBps: params.maxSlippageBps,
    });

    // Then get the swap transaction from Jupiter
    const swapResult = await this.jupiterApi.swapPost({
      swapRequest: {
        quoteResponse: quote.raw as QuoteResponse,
        userPublicKey: params.userPublicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            priorityLevel: 'medium',
            maxLamports: 5_000_000,
          },
        },
      },
    });

    if (!swapResult?.swapTransaction) {
      throw new Error('Jupiter swap returned empty transaction');
    }

    // Deserialize the versioned transaction to extract instructions
    const transactionBuf = Buffer.from(swapResult.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuf);

    // Return the raw serialized transaction for the execution engine to handle
    // Since Jupiter returns a complete VersionedTransaction, we store it in a wrapper instruction
    // The execution engine will detect this and use the versioned transaction directly
    return this.extractInstructions(transaction);
  }

  /**
   * Execute a complete swap and return the serialized VersionedTransaction.
   *
   * This is a convenience method that returns the full transaction ready for signing.
   * The caller (execution engine) should sign and send it.
   */
  async getSwapTransaction(params: SwapParams): Promise<{
    transaction: VersionedTransaction;
    quote: Quote;
  }> {
    this.ensureInitialized();

    const quote = await this.getQuote({
      inputToken: params.inputToken,
      outputToken: params.outputToken,
      amount: params.amount,
      maxSlippageBps: params.maxSlippageBps,
    });

    const swapResult = await this.jupiterApi.swapPost({
      swapRequest: {
        quoteResponse: quote.raw as QuoteResponse,
        userPublicKey: params.userPublicKey.toBase58(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            priorityLevel: 'medium',
            maxLamports: 5_000_000,
          },
        },
      },
    });

    if (!swapResult?.swapTransaction) {
      throw new Error('Jupiter swap returned empty transaction');
    }

    const transactionBuf = Buffer.from(swapResult.swapTransaction, 'base64');
    const transaction = VersionedTransaction.deserialize(transactionBuf);

    return { transaction, quote };
  }

  // ---- Private helpers ----

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('JupiterAdapter not initialized. Call initialize() first.');
    }
  }

  /**
   * Extract instructions from a VersionedTransaction.
   * This is best-effort -- Jupiter transactions use address lookup tables
   * which make instruction extraction complex. For most use cases,
   * use getSwapTransaction() instead to get the full versioned transaction.
   */
  private extractInstructions(tx: VersionedTransaction): TransactionInstruction[] {
    const message = tx.message;
    const staticKeys = message.staticAccountKeys;

    return message.compiledInstructions.map((ix) => {
      const programId = staticKeys[ix.programIdIndex];
      const keys = ix.accountKeyIndexes.map((idx) => ({
        pubkey: staticKeys[idx] ?? PublicKey.default,
        isSigner: message.isAccountSigner(idx),
        isWritable: message.isAccountWritable(idx),
      }));

      return new TransactionInstruction({
        programId,
        keys,
        data: Buffer.from(ix.data),
      });
    });
  }
}

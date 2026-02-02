import {
  Connection,
  PublicKey,
  TransactionInstruction,
} from '@solana/web3.js';
import type {
  ProtocolAdapter,
  ProtocolHealth,
  ProtocolCapability,
  ActionType,
  Quote,
  QuoteParams,
  SwapParams,
  DepositParams,
  WithdrawParams,
  Position,
  AdapterConfig,
  PoolData,
} from '@makora/types';
import {
  RAYDIUM_API_BASE_URL,
  DEFAULT_LP_SLIPPAGE_BPS,
  MIN_LIQUIDITY_AMOUNT_LAMPORTS,
} from './constants.js';

/**
 * Raydium AMM Liquidity Provision Adapter
 *
 * Implements the uniform ProtocolAdapter interface for Raydium LP operations.
 * This adapter handles LP operations ONLY:
 * - Provide liquidity to AMM/CLMM pools
 * - Remove liquidity from pools
 * - Read LP positions
 *
 * Swaps through Raydium are handled by the Jupiter adapter (which aggregates Raydium).
 *
 * NOTE: This adapter uses the Raydium REST API for data and builds instructions
 * directly. The @raydium-io/raydium-sdk-v2 alpha dependency has been deferred
 * due to known version conflicts. Core LP operations go through the API layer
 * and on-chain instruction building will be integrated once the SDK stabilizes.
 *
 * SDK docs: https://github.com/raydium-io/raydium-sdk-V2
 * Raydium API: https://api-v3.raydium.io
 */
export class RaydiumAdapter implements ProtocolAdapter {
  readonly protocolId = 'raydium' as const;
  readonly name = 'Raydium AMM';
  readonly version = '2.0';

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
      // Check Raydium API is reachable
      const response = await fetch(`${RAYDIUM_API_BASE_URL}/main/info`);
      if (!response.ok) {
        throw new Error(`Raydium API returned ${response.status}`);
      }

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
    return ['provide_liquidity', 'remove_liquidity'];
  }

  supportsAction(actionType: ActionType): boolean {
    return actionType === 'provide_liquidity' || actionType === 'remove_liquidity';
  }

  /**
   * Get LP positions for a wallet.
   *
   * Reads the user's LP token balances across Raydium AMM pools via the Raydium API.
   */
  async getPositions(owner: PublicKey): Promise<Position[]> {
    this.ensureInitialized();
    const positions: Position[] = [];

    try {
      // Fetch user's LP positions from Raydium API
      const response = await fetch(
        `${RAYDIUM_API_BASE_URL}/main/portfolio?owner=${owner.toBase58()}`
      );

      if (!response.ok) {
        return positions;
      }

      const data = (await response.json()) as {
        data?: Array<{
          poolId: string;
          tokenA: { symbol: string; mint: string; decimals: number; amount: string };
          tokenB: { symbol: string; mint: string; decimals: number; amount: string };
          lpAmount: string;
          usdValue: number;
          apy: number;
        }>;
      };

      for (const pool of data.data ?? []) {
        positions.push({
          protocolId: this.protocolId,
          type: 'lp',
          token: {
            symbol: pool.tokenA.symbol,
            name: `${pool.tokenA.symbol} (Raydium LP)`,
            mint: new PublicKey(pool.tokenA.mint),
            decimals: pool.tokenA.decimals,
          },
          tokenB: {
            symbol: pool.tokenB.symbol,
            name: `${pool.tokenB.symbol} (Raydium LP)`,
            mint: new PublicKey(pool.tokenB.mint),
            decimals: pool.tokenB.decimals,
          },
          amount: BigInt(pool.lpAmount),
          usdValue: pool.usdValue,
          apy: pool.apy,
          metadata: {
            poolId: pool.poolId,
            tokenAAmount: pool.tokenA.amount,
            tokenBAmount: pool.tokenB.amount,
          },
        });
      }
    } catch {
      // API failure -- return empty positions rather than crashing
    }

    return positions;
  }

  /**
   * Get a quote for providing liquidity.
   *
   * For LP operations, the "quote" shows how much liquidity you will receive
   * for a given deposit amount.
   */
  async getQuote(params: QuoteParams): Promise<Quote> {
    this.ensureInitialized();

    // Fetch pool info to calculate expected LP tokens
    const poolInfo = await this.fetchPoolInfo(params.inputToken, params.outputToken);

    if (!poolInfo) {
      throw new Error(
        `No Raydium pool found for ${params.inputToken.toBase58()} / ${params.outputToken.toBase58()}`
      );
    }

    // LP token amount is proportional to deposit relative to pool reserves
    // This is a simplified estimate -- actual amount depends on both token deposits
    const estimatedLpTokens = params.amount; // Simplified for quote

    return {
      protocolId: this.protocolId,
      inputToken: {
        symbol: 'Token A',
        name: 'Pool Token A',
        mint: params.inputToken,
        decimals: 0,
      },
      outputToken: {
        symbol: 'LP',
        name: 'Raydium LP Token',
        mint: params.outputToken,
        decimals: 0,
      },
      inputAmount: params.amount,
      expectedOutputAmount: estimatedLpTokens,
      minimumOutputAmount: estimatedLpTokens,
      priceImpactPct: 0,
      feesUsd: 0,
      routeDescription: `Provide liquidity to Raydium pool`,
      raw: poolInfo,
    };
  }

  /**
   * buildSwapIx is not directly supported -- use Jupiter for Raydium swaps.
   * This method throws to force callers through the proper channel.
   */
  async buildSwapIx(_params: SwapParams): Promise<TransactionInstruction[]> {
    throw new Error(
      'RaydiumAdapter does not support direct swaps. ' +
      'Use JupiterAdapter for swaps (Jupiter routes through Raydium automatically). ' +
      'This adapter handles LP operations only: provide_liquidity, remove_liquidity.'
    );
  }

  /**
   * Build deposit (provide liquidity) instructions.
   *
   * NOTE: Full on-chain instruction building requires @raydium-io/raydium-sdk-v2
   * which is currently deferred due to alpha SDK version conflicts.
   * This method logs the deferral and returns an empty instruction set.
   * The interface is in place for integration once the SDK stabilizes.
   *
   * @param params.destination - Pool address (AMM ID)
   * @param params.amount - Amount of token A to deposit (in lamports)
   */
  async buildDepositIx(params: DepositParams): Promise<TransactionInstruction[]> {
    this.ensureInitialized();

    if (params.amount < MIN_LIQUIDITY_AMOUNT_LAMPORTS) {
      throw new Error(
        `Liquidity amount too small. Minimum: ${MIN_LIQUIDITY_AMOUNT_LAMPORTS} lamports. ` +
        `Got: ${params.amount} lamports.`
      );
    }

    // TODO: Integrate @raydium-io/raydium-sdk-v2 once alpha stabilizes
    // For now, throw a descriptive error so callers know the status
    throw new Error(
      'RaydiumAdapter.buildDepositIx: Not yet integrated -- Raydium SDK v2 alpha has dependency conflicts. ' +
      'Pool data and quotes are available via the REST API. ' +
      'On-chain instruction building will be enabled once SDK version is pinned.'
    );
  }

  /**
   * Build withdraw (remove liquidity) instructions.
   *
   * NOTE: Same SDK deferral as buildDepositIx -- see note above.
   *
   * @param params.source - Pool address (AMM ID)
   * @param params.amount - Amount of LP tokens to burn
   */
  async buildWithdrawIx(params: WithdrawParams): Promise<TransactionInstruction[]> {
    this.ensureInitialized();

    // TODO: Integrate @raydium-io/raydium-sdk-v2 once alpha stabilizes
    throw new Error(
      'RaydiumAdapter.buildWithdrawIx: Not yet integrated -- Raydium SDK v2 alpha has dependency conflicts. ' +
      'Pool data and quotes are available via the REST API. ' +
      'On-chain instruction building will be enabled once SDK version is pinned.'
    );
  }

  // ---- Public helper methods (used by protocol router / strategy engine) ----

  /**
   * Fetch available pools with TVL and APY data.
   * Useful for the strategy engine to find yield opportunities.
   */
  async getTopPools(limit: number = 10): Promise<PoolData[]> {
    try {
      const response = await fetch(
        `${RAYDIUM_API_BASE_URL}/pools/info/list?poolSortField=liquidity&sortType=desc&pageSize=${limit}&page=1`
      );

      if (!response.ok) return [];

      const data = (await response.json()) as {
        data?: {
          data?: Array<{
            id: string;
            mintA: { address: string; symbol: string; decimals: number };
            mintB: { address: string; symbol: string; decimals: number };
            tvl: number;
            volume: { volume24h: number };
            apr: { apr24h: number };
            feeRate: number;
          }>;
        };
      };

      return (data.data?.data ?? []).map((pool) => ({
        protocolId: this.protocolId,
        poolAddress: new PublicKey(pool.id),
        tokenA: {
          symbol: pool.mintA.symbol,
          name: pool.mintA.symbol,
          mint: new PublicKey(pool.mintA.address),
          decimals: pool.mintA.decimals,
        },
        tokenB: {
          symbol: pool.mintB.symbol,
          name: pool.mintB.symbol,
          mint: new PublicKey(pool.mintB.address),
          decimals: pool.mintB.decimals,
        },
        tvlUsd: pool.tvl,
        volume24hUsd: pool.volume.volume24h,
        apy: pool.apr.apr24h,
        feeRate: pool.feeRate,
      }));
    } catch {
      return [];
    }
  }

  // ---- Private helpers ----

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('RaydiumAdapter not initialized. Call initialize() first.');
    }
  }

  /**
   * Fetch pool info for a given token pair from the Raydium API.
   */
  private async fetchPoolInfo(
    tokenA: PublicKey,
    tokenB: PublicKey
  ): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(
        `${RAYDIUM_API_BASE_URL}/pools/info/mint?mint1=${tokenA.toBase58()}&mint2=${tokenB.toBase58()}&poolSortField=liquidity&sortType=desc&pageSize=1`
      );

      if (!response.ok) return null;

      const data = (await response.json()) as {
        data?: { data?: Array<Record<string, unknown>> };
      };

      return data.data?.data?.[0] ?? null;
    } catch {
      return null;
    }
  }
}

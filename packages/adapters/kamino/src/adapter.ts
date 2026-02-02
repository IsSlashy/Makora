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
} from '@makora/types';
import {
  KAMINO_LEND_PROGRAM_ID,
  KAMINO_MAIN_MARKET,
  KAMINO_API_BASE_URL,
  MIN_DEPOSIT_AMOUNT_LAMPORTS,
} from './constants.js';

/**
 * Kamino Finance Vault Adapter
 *
 * Implements the uniform ProtocolAdapter interface for Kamino lending operations.
 * Supports:
 * - Deposit tokens into Kamino lending reserves (earn yield)
 * - Withdraw tokens from Kamino reserves
 * - Read vault positions (deposits + earned interest)
 *
 * Kamino's kLend is a lending protocol where depositors earn yield from borrowers.
 * Each "vault" is a reserve within the Kamino market.
 *
 * NOTE: On-chain instruction building requires @kamino-finance/klend-sdk which
 * has been deferred due to @solana/kit transitive dependency conflicts with
 * @solana/web3.js v1. The adapter interface is fully implemented and vault
 * data/positions are available via the Hubble Protocol API. On-chain operations
 * will be integrated once the SDK dependency conflict is resolved.
 *
 * Docs: https://docs.kamino.finance/
 * SDK: https://github.com/hubbleprotocol/kamino-lending-sdk
 */
export class KaminoAdapter implements ProtocolAdapter {
  readonly protocolId = 'kamino' as const;
  readonly name = 'Kamino Finance';
  readonly version = '7.0';

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
      // Check Kamino/Hubble API is reachable
      const response = await fetch(
        `${KAMINO_API_BASE_URL}/markets/${KAMINO_MAIN_MARKET.toBase58()}`
      );
      if (!response.ok) {
        throw new Error(`Kamino API returned ${response.status}`);
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
    return ['vault_deposit', 'vault_withdraw', 'lend'];
  }

  supportsAction(actionType: ActionType): boolean {
    return actionType === 'deposit' || actionType === 'withdraw';
  }

  /**
   * Get lending positions for a wallet.
   *
   * Uses the Hubble Protocol API to fetch user deposit data.
   * Returns deposits in Kamino reserves with current APY.
   */
  async getPositions(owner: PublicKey): Promise<Position[]> {
    this.ensureInitialized();
    const positions: Position[] = [];

    try {
      // Fetch user obligations from Kamino API
      const response = await fetch(
        `${KAMINO_API_BASE_URL}/markets/${KAMINO_MAIN_MARKET.toBase58()}/users/${owner.toBase58()}/obligations`
      );

      if (!response.ok) {
        return positions;
      }

      const data = (await response.json()) as {
        data?: Array<{
          obligationAddress: string;
          deposits: Array<{
            reserveAddress: string;
            tokenMint: string;
            symbol: string;
            decimals: number;
            amount: string;
            usdValue: number;
            supplyApy: number;
          }>;
        }>;
      };

      for (const obligation of data.data ?? []) {
        for (const deposit of obligation.deposits ?? []) {
          positions.push({
            protocolId: this.protocolId,
            type: 'vault',
            token: {
              symbol: deposit.symbol,
              name: `${deposit.symbol} (Kamino Deposit)`,
              mint: new PublicKey(deposit.tokenMint),
              decimals: deposit.decimals,
            },
            amount: BigInt(deposit.amount),
            usdValue: deposit.usdValue,
            apy: deposit.supplyApy,
            metadata: {
              reserveAddress: deposit.reserveAddress,
              obligationAddress: obligation.obligationAddress,
            },
          });
        }
      }
    } catch {
      // No obligations or API error -- return empty positions
    }

    return positions;
  }

  /**
   * Get a quote for depositing into a Kamino reserve.
   *
   * Uses the Kamino API to fetch reserve data and current APY.
   */
  async getQuote(params: QuoteParams): Promise<Quote> {
    this.ensureInitialized();

    // Fetch reserve info for the input token from API
    const reserveInfo = await this.fetchReserveByMint(params.inputToken);

    if (!reserveInfo) {
      throw new Error(`No Kamino reserve found for token: ${params.inputToken.toBase58()}`);
    }

    return {
      protocolId: this.protocolId,
      inputToken: {
        symbol: reserveInfo.symbol,
        name: reserveInfo.symbol,
        mint: params.inputToken,
        decimals: reserveInfo.decimals,
      },
      outputToken: {
        symbol: `c${reserveInfo.symbol}`,
        name: `Kamino Collateral ${reserveInfo.symbol}`,
        mint: params.outputToken,
        decimals: reserveInfo.decimals,
      },
      inputAmount: params.amount,
      expectedOutputAmount: params.amount, // 1:1 at deposit time (cToken appreciates over time)
      minimumOutputAmount: params.amount,
      priceImpactPct: 0,
      feesUsd: 0, // No deposit fees on Kamino
      routeDescription: `Deposit ${reserveInfo.symbol} into Kamino reserve (${reserveInfo.supplyApy.toFixed(2)}% APY)`,
      raw: {
        reserveAddress: reserveInfo.reserveAddress,
        supplyApy: reserveInfo.supplyApy,
        totalDeposits: reserveInfo.totalDeposits,
      },
    };
  }

  /**
   * buildSwapIx is not supported -- Kamino is a lending protocol, not a DEX.
   */
  async buildSwapIx(_params: SwapParams): Promise<TransactionInstruction[]> {
    throw new Error(
      'KaminoAdapter does not support swaps. ' +
      'Use JupiterAdapter for swaps. ' +
      'This adapter handles vault operations only: deposit, withdraw.'
    );
  }

  /**
   * Build deposit instructions for a Kamino lending reserve.
   *
   * NOTE: Full on-chain instruction building requires @kamino-finance/klend-sdk
   * which is deferred due to @solana/kit transitive dependency conflicts.
   * This method throws a descriptive error until the SDK is integrated.
   *
   * @param params.token - Token mint to deposit
   * @param params.amount - Amount in smallest units (lamports)
   * @param params.destination - Reserve address (or use token mint to auto-find)
   */
  async buildDepositIx(params: DepositParams): Promise<TransactionInstruction[]> {
    this.ensureInitialized();

    if (params.amount < MIN_DEPOSIT_AMOUNT_LAMPORTS) {
      throw new Error(
        `Deposit amount too small. Minimum: ${MIN_DEPOSIT_AMOUNT_LAMPORTS} lamports. ` +
        `Got: ${params.amount} lamports.`
      );
    }

    // TODO: Integrate @kamino-finance/klend-sdk once @solana/kit conflict is resolved
    throw new Error(
      'KaminoAdapter.buildDepositIx: Not yet integrated -- klend-sdk has @solana/kit dependency conflict. ' +
      'Vault data, quotes, and position reads work via the Hubble Protocol API. ' +
      'On-chain instruction building will be enabled once the SDK conflict is resolved.'
    );
  }

  /**
   * Build withdraw instructions from a Kamino lending reserve.
   *
   * NOTE: Same SDK deferral as buildDepositIx -- see note above.
   *
   * @param params.token - Token mint to withdraw
   * @param params.amount - Amount in smallest units (lamports)
   * @param params.source - Reserve address (or use token mint to auto-find)
   */
  async buildWithdrawIx(params: WithdrawParams): Promise<TransactionInstruction[]> {
    this.ensureInitialized();

    // TODO: Integrate @kamino-finance/klend-sdk once @solana/kit conflict is resolved
    throw new Error(
      'KaminoAdapter.buildWithdrawIx: Not yet integrated -- klend-sdk has @solana/kit dependency conflict. ' +
      'Vault data, quotes, and position reads work via the Hubble Protocol API. ' +
      'On-chain instruction building will be enabled once the SDK conflict is resolved.'
    );
  }

  // ---- Public helper methods (used by strategy engine) ----

  /**
   * Get all available reserves with their supply APYs.
   * Useful for the strategy engine to find yield opportunities.
   */
  async getAvailableReserves(): Promise<
    Array<{
      reserveAddress: string;
      tokenMint: string;
      symbol: string;
      supplyApy: number;
      totalDeposits: number;
      utilizationRate: number;
    }>
  > {
    this.ensureInitialized();

    try {
      const response = await fetch(
        `${KAMINO_API_BASE_URL}/markets/${KAMINO_MAIN_MARKET.toBase58()}/reserves`
      );

      if (!response.ok) return [];

      const data = (await response.json()) as {
        data?: Array<{
          address: string;
          liquidityMint: string;
          symbol: string;
          supplyApy: number;
          totalDeposits: number;
          utilizationRate: number;
        }>;
      };

      return (data.data ?? []).map((reserve) => ({
        reserveAddress: reserve.address,
        tokenMint: reserve.liquidityMint,
        symbol: reserve.symbol,
        supplyApy: reserve.supplyApy,
        totalDeposits: reserve.totalDeposits,
        utilizationRate: reserve.utilizationRate,
      })).sort((a, b) => b.supplyApy - a.supplyApy);
    } catch {
      return [];
    }
  }

  // ---- Private helpers ----

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('KaminoAdapter not initialized. Call initialize() first.');
    }
  }

  /**
   * Fetch reserve info by token mint address from the Kamino API.
   */
  private async fetchReserveByMint(
    mint: PublicKey
  ): Promise<{
    reserveAddress: string;
    symbol: string;
    decimals: number;
    supplyApy: number;
    totalDeposits: number;
  } | null> {
    try {
      const response = await fetch(
        `${KAMINO_API_BASE_URL}/markets/${KAMINO_MAIN_MARKET.toBase58()}/reserves`
      );

      if (!response.ok) return null;

      const data = (await response.json()) as {
        data?: Array<{
          address: string;
          liquidityMint: string;
          symbol: string;
          decimals: number;
          supplyApy: number;
          totalDeposits: number;
        }>;
      };

      const mintStr = mint.toBase58();
      const reserve = (data.data ?? []).find((r) => r.liquidityMint === mintStr);

      if (!reserve) return null;

      return {
        reserveAddress: reserve.address,
        symbol: reserve.symbol,
        decimals: reserve.decimals,
        supplyApy: reserve.supplyApy,
        totalDeposits: reserve.totalDeposits,
      };
    } catch {
      return null;
    }
  }
}

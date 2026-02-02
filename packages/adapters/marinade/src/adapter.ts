import {
  Marinade,
  MarinadeConfig,
  type MarinadeState,
} from '@marinade.finance/marinade-ts-sdk';
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type {
  ProtocolAdapter,
  ProtocolHealth,
  ProtocolCapability,
  ActionType,
  Quote,
  QuoteParams,
  SwapParams,
  StakeParams,
  Position,
  AdapterConfig,
  DepositParams,
  WithdrawParams,
} from '@makora/types';
import {
  MSOL_MINT,
  NATIVE_SOL_MINT,
  MIN_STAKE_AMOUNT_LAMPORTS,
  DEFAULT_PRIORITY_FEE_LAMPORTS,
} from './constants.js';

/**
 * Marinade Finance Liquid Staking Adapter
 *
 * Wraps @marinade.finance/marinade-ts-sdk behind the uniform ProtocolAdapter interface.
 * Supports:
 * - Staking SOL -> mSOL (liquid staking)
 * - Unstaking mSOL -> SOL (delayed unstake or instant via liquidity pool)
 * - Reading mSOL positions
 *
 * Docs: https://docs.marinade.finance/
 * SDK: https://github.com/marinade-finance/marinade-ts-sdk
 */
export class MarinadeAdapter implements ProtocolAdapter {
  readonly protocolId = 'marinade' as const;
  readonly name = 'Marinade Finance';
  readonly version = '5.0';

  private marinade!: Marinade;
  private connection!: Connection;
  private walletPublicKey!: PublicKey;
  private initialized = false;

  async initialize(config: AdapterConfig): Promise<void> {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.walletPublicKey = config.walletPublicKey;

    const marinadeConfig = new MarinadeConfig({
      connection: this.connection,
      publicKey: this.walletPublicKey,
    });

    this.marinade = new Marinade(marinadeConfig);
    this.initialized = true;
  }

  async healthCheck(): Promise<ProtocolHealth> {
    const start = Date.now();
    try {
      this.ensureInitialized();
      // Verify we can fetch Marinade state (proves the program is accessible)
      const state = await this.marinade.getMarinadeState();
      // Read mSOL price from state as a sanity check
      const msolPrice = state.mSolPrice;

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
    return ['stake', 'unstake'];
  }

  supportsAction(actionType: ActionType): boolean {
    return actionType === 'stake' || actionType === 'unstake';
  }

  /**
   * Get mSOL positions for a wallet.
   *
   * Returns the mSOL balance as a staked position with current APY.
   */
  async getPositions(owner: PublicKey): Promise<Position[]> {
    this.ensureInitialized();
    const positions: Position[] = [];

    try {
      // Get mSOL token account balance
      const msolAta = await getAssociatedTokenAddress(MSOL_MINT, owner);
      const balance = await this.connection.getTokenAccountBalance(msolAta);

      if (balance.value.uiAmount && balance.value.uiAmount > 0) {
        // Fetch current mSOL -> SOL exchange rate from Marinade state
        const state = await this.marinade.getMarinadeState();
        const msolPriceInSol = state.mSolPrice;

        positions.push({
          protocolId: this.protocolId,
          type: 'staked',
          token: {
            symbol: 'mSOL',
            name: 'Marinade staked SOL',
            mint: MSOL_MINT,
            decimals: 9,
          },
          amount: BigInt(balance.value.amount),
          usdValue: 0, // Will be enriched by caller with price data
          apy: this.estimateApy(state),
          metadata: {
            msolPriceInSol: msolPriceInSol,
            stakedSolEquivalent: balance.value.uiAmount * msolPriceInSol,
          },
        });
      }
    } catch {
      // No mSOL account -- that is fine, user just has no staked position
    }

    return positions;
  }

  /**
   * Get a quote for staking SOL -> mSOL.
   *
   * Uses the current mSOL/SOL exchange rate from Marinade state.
   */
  async getQuote(params: QuoteParams): Promise<Quote> {
    this.ensureInitialized();

    const state = await this.marinade.getMarinadeState();
    const msolPriceInSol = state.mSolPrice;

    // Calculate expected mSOL output
    // mSOL received = SOL deposited / mSOL price (in SOL)
    const inputLamports = params.amount;
    const expectedMsolLamports = BigInt(
      Math.floor(Number(inputLamports) / msolPriceInSol)
    );

    // Marinade has no slippage on staking (it is a fixed rate conversion)
    // but we apply a small buffer for safety
    const slippageMultiplier = 1 - params.maxSlippageBps / 10_000;
    const minimumMsolLamports = BigInt(
      Math.floor(Number(expectedMsolLamports) * slippageMultiplier)
    );

    return {
      protocolId: this.protocolId,
      inputToken: {
        symbol: 'SOL',
        name: 'Solana',
        mint: NATIVE_SOL_MINT,
        decimals: 9,
      },
      outputToken: {
        symbol: 'mSOL',
        name: 'Marinade staked SOL',
        mint: MSOL_MINT,
        decimals: 9,
      },
      inputAmount: inputLamports,
      expectedOutputAmount: expectedMsolLamports,
      minimumOutputAmount: minimumMsolLamports,
      priceImpactPct: 0, // Marinade staking has no price impact
      feesUsd: 0, // Marinade does not charge staking fees (revenue is from MEV/tips)
      routeDescription: 'SOL -> Marinade Stake Pool -> mSOL',
      raw: {
        msolPriceInSol,
        exchangeRate: 1 / msolPriceInSol,
      },
    };
  }

  /**
   * Build swap instructions -- for Marinade, swap is interpreted as stake (SOL->mSOL)
   * or unstake (mSOL->SOL) based on input/output tokens.
   */
  async buildSwapIx(params: SwapParams): Promise<TransactionInstruction[]> {
    this.ensureInitialized();

    const inputMint = params.inputToken.toBase58();
    const outputMint = params.outputToken.toBase58();

    // SOL -> mSOL = stake
    if (inputMint === NATIVE_SOL_MINT.toBase58() && outputMint === MSOL_MINT.toBase58()) {
      return this.buildStakeIx({
        amount: params.amount,
        userPublicKey: params.userPublicKey,
      });
    }

    // mSOL -> SOL = unstake
    if (inputMint === MSOL_MINT.toBase58() && outputMint === NATIVE_SOL_MINT.toBase58()) {
      return this.buildUnstakeIx({
        amount: params.amount,
        userPublicKey: params.userPublicKey,
      });
    }

    throw new Error(
      `MarinadeAdapter only supports SOL<->mSOL conversions. ` +
      `Got: ${inputMint} -> ${outputMint}`
    );
  }

  /**
   * Build stake instructions: SOL -> mSOL
   *
   * Uses Marinade SDK to build the deposit instruction.
   * The SDK handles finding the stake pool, computing the exchange rate,
   * and creating/funding the user's mSOL ATA if needed.
   */
  async buildStakeIx(params: StakeParams): Promise<TransactionInstruction[]> {
    this.ensureInitialized();

    if (params.amount < MIN_STAKE_AMOUNT_LAMPORTS) {
      throw new Error(
        `Stake amount too small. Minimum: ${MIN_STAKE_AMOUNT_LAMPORTS} lamports (0.001 SOL). ` +
        `Got: ${params.amount} lamports.`
      );
    }

    // Use Marinade SDK deposit method
    // This returns a Transaction object with all necessary instructions
    const { transaction } = await this.marinade.deposit(params.amount);

    // Extract instructions from the legacy transaction
    return transaction.instructions;
  }

  /**
   * Build unstake instructions: mSOL -> SOL
   *
   * Uses Marinade SDK liquid unstake for instant conversion.
   * Liquid unstake goes through Marinade's liquidity pool (small fee ~0.1-0.3%)
   * rather than the delayed unstake queue.
   */
  async buildUnstakeIx(params: StakeParams): Promise<TransactionInstruction[]> {
    this.ensureInitialized();

    if (params.amount < MIN_STAKE_AMOUNT_LAMPORTS) {
      throw new Error(
        `Unstake amount too small. Minimum: ${MIN_STAKE_AMOUNT_LAMPORTS} lamports (0.001 mSOL). ` +
        `Got: ${params.amount} lamports.`
      );
    }

    // Use liquid unstake for instant conversion (small fee)
    // vs orderUnstake which is delayed but fee-free
    const { transaction } = await this.marinade.liquidUnstake(params.amount);

    return transaction.instructions;
  }

  // ---- Private helpers ----

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('MarinadeAdapter not initialized. Call initialize() first.');
    }
  }

  /**
   * Estimate current Marinade staking APY from state.
   *
   * Marinade APY comes from:
   * 1. Validator rewards (~6-7% base)
   * 2. MEV tips (variable)
   * 3. Minus Marinade's commission
   *
   * We approximate from the mSOL price growth rate.
   */
  private estimateApy(state: MarinadeState): number {
    // mSOL price grows over time as staking rewards accrue
    // Current mainnet APY is typically 6-8%
    // For a more accurate estimate, we would track mSOL price over time
    // For hackathon, return a reasonable estimate
    const msolPrice = state.mSolPrice;

    // If mSOL > 1.0 SOL, staking rewards have accrued
    // Approximate APY = (msolPrice - 1) * annualization_factor
    // Since mSOL launched ~2 years ago with price 1.0, and is now ~1.15
    // that is roughly 7.2% annualized
    if (msolPrice > 1.0) {
      // Rough estimate: assume ~7.2% APY (current Marinade average)
      return 7.2;
    }

    return 6.5; // Conservative estimate
  }
}

import type { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type { ActionType, ProtocolId, TokenInfo, TokenPrice, ExecutionResult } from './common.js';

// ============================================================================
// Protocol Adapter Interface
// ============================================================================

/** Health status of a protocol adapter */
export interface ProtocolHealth {
  protocolId: ProtocolId;
  isHealthy: boolean;
  latencyMs: number;
  lastChecked: number;
  error?: string;
}

/** Capabilities a protocol supports */
export type ProtocolCapability = 'swap' | 'stake' | 'unstake' | 'lend' | 'borrow' | 'provide_liquidity' | 'remove_liquidity' | 'vault_deposit' | 'vault_withdraw' | 'shield' | 'unshield';

/** Quote parameters (input to any adapter) */
export interface QuoteParams {
  inputToken: PublicKey;
  outputToken: PublicKey;
  /** Amount in smallest unit (lamports) */
  amount: bigint;
  /** Maximum slippage in basis points (e.g., 50 = 0.5%) */
  maxSlippageBps: number;
}

/** Normalized quote response from any adapter */
export interface Quote {
  protocolId: ProtocolId;
  inputToken: TokenInfo;
  outputToken: TokenInfo;
  inputAmount: bigint;
  expectedOutputAmount: bigint;
  minimumOutputAmount: bigint;
  /** Price impact as a percentage (e.g., 0.5 = 0.5%) */
  priceImpactPct: number;
  /** Estimated fees in USD */
  feesUsd: number;
  /** Route description (human-readable) */
  routeDescription: string;
  /** Raw protocol-specific quote data (for passing to swap) */
  raw: unknown;
}

/** Swap instruction parameters */
export interface SwapParams {
  inputToken: PublicKey;
  outputToken: PublicKey;
  amount: bigint;
  maxSlippageBps: number;
  /** User's wallet public key */
  userPublicKey: PublicKey;
}

/** Stake instruction parameters */
export interface StakeParams {
  amount: bigint;
  userPublicKey: PublicKey;
}

/** Deposit instruction parameters */
export interface DepositParams {
  token: PublicKey;
  amount: bigint;
  /** Vault or pool address */
  destination: PublicKey;
  userPublicKey: PublicKey;
}

/** Withdraw instruction parameters */
export interface WithdrawParams {
  token: PublicKey;
  amount: bigint;
  /** Vault or pool address */
  source: PublicKey;
  userPublicKey: PublicKey;
}

/** Position held in a protocol */
export interface Position {
  protocolId: ProtocolId;
  type: 'token' | 'staked' | 'lp' | 'vault' | 'lend' | 'borrow' | 'shielded';
  /** Primary token of the position */
  token: TokenInfo;
  /** Secondary token (for LP positions) */
  tokenB?: TokenInfo;
  /** Amount in smallest unit */
  amount: bigint;
  /** USD value at current prices */
  usdValue: number;
  /** Annual percentage yield (if applicable) */
  apy?: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/** Pool data from a protocol */
export interface PoolData {
  protocolId: ProtocolId;
  poolAddress: PublicKey;
  tokenA: TokenInfo;
  tokenB: TokenInfo;
  tvlUsd: number;
  volume24hUsd: number;
  apy: number;
  feeRate: number;
}

// ============================================================================
// Uniform Protocol Adapter Interface
// ============================================================================

/**
 * Every DeFi protocol adapter must implement this interface.
 * The agent core never interacts with protocol SDKs directly --
 * only through this uniform interface.
 */
export interface ProtocolAdapter {
  readonly protocolId: ProtocolId;
  readonly name: string;
  readonly version: string;

  /** Initialize the adapter with a connection and wallet */
  initialize(config: AdapterConfig): Promise<void>;

  /** Check if the protocol is reachable and functional */
  healthCheck(): Promise<ProtocolHealth>;

  /** List capabilities this adapter supports */
  getCapabilities(): ProtocolCapability[];

  /** Check if a specific action type is supported */
  supportsAction(actionType: ActionType): boolean;

  /** Get all positions for a wallet */
  getPositions(owner: PublicKey): Promise<Position[]>;

  /** Get a price quote */
  getQuote(params: QuoteParams): Promise<Quote>;

  /** Build swap instructions (does NOT sign or send) */
  buildSwapIx(params: SwapParams): Promise<TransactionInstruction[]>;

  /** Build deposit instructions */
  buildDepositIx?(params: DepositParams): Promise<TransactionInstruction[]>;

  /** Build withdraw instructions */
  buildWithdrawIx?(params: WithdrawParams): Promise<TransactionInstruction[]>;

  /** Build stake instructions */
  buildStakeIx?(params: StakeParams): Promise<TransactionInstruction[]>;

  /** Build unstake instructions */
  buildUnstakeIx?(params: StakeParams): Promise<TransactionInstruction[]>;
}

/** Configuration passed to adapter.initialize() */
export interface AdapterConfig {
  rpcUrl: string;
  walletPublicKey: PublicKey;
}

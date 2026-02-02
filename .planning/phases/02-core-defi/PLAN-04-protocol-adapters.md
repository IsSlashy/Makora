---
phase: 02-core-defi
plan: 04
type: execute
wave: 1
depends_on: [01, 02, 03]
files_modified:
  - packages/adapters/marinade/package.json
  - packages/adapters/marinade/tsconfig.json
  - packages/adapters/marinade/src/index.ts
  - packages/adapters/marinade/src/adapter.ts
  - packages/adapters/marinade/src/constants.ts
  - packages/adapters/raydium/package.json
  - packages/adapters/raydium/tsconfig.json
  - packages/adapters/raydium/src/index.ts
  - packages/adapters/raydium/src/adapter.ts
  - packages/adapters/raydium/src/constants.ts
  - packages/adapters/kamino/package.json
  - packages/adapters/kamino/tsconfig.json
  - packages/adapters/kamino/src/index.ts
  - packages/adapters/kamino/src/adapter.ts
  - packages/adapters/kamino/src/constants.ts
  - packages/data-feed/src/tokens.ts
autonomous: true
must_haves:
  truths:
    - "`pnpm build` compiles all three new adapter packages without errors"
    - "MarinadeAdapter.buildStakeIx() returns valid TransactionInstruction[] for staking SOL to mSOL on devnet"
    - "MarinadeAdapter.buildUnstakeIx() returns valid TransactionInstruction[] for unstaking mSOL to SOL"
    - "MarinadeAdapter.getPositions() returns staked mSOL balance for a given wallet"
    - "RaydiumAdapter.buildDepositIx() returns valid TransactionInstruction[] for providing liquidity"
    - "KaminoAdapter.buildDepositIx() returns valid TransactionInstruction[] for vault deposits"
    - "All three adapters implement the full ProtocolAdapter interface from @makora/types"
    - "All three adapters pass healthCheck() against mainnet endpoints"
  artifacts:
    - packages/adapters/marinade/dist/index.js
    - packages/adapters/raydium/dist/index.js
    - packages/adapters/kamino/dist/index.js
---

# Plan 04: Protocol Adapters -- Marinade, Raydium, Kamino (DEFI-02, DEFI-03, DEFI-04)

## Objective

Build three new protocol adapters following the exact same `ProtocolAdapter` interface pattern established by the Jupiter adapter in Phase 1. After this plan completes:
- Marinade adapter stakes SOL -> mSOL and unstakes mSOL -> SOL on devnet
- Raydium adapter provides and removes liquidity from AMM pools
- Kamino adapter deposits and withdraws from automated vaults

All three adapters are independent packages and can be built in parallel.

## Context

- **Adapter pattern**: Every adapter implements `ProtocolAdapter` from `@makora/types` (see `P:\solana-agent-hackathon\packages\types\src\protocols.ts`)
- **Reference implementation**: `JupiterAdapter` at `P:\solana-agent-hackathon\packages\adapters\jupiter\src\adapter.ts`
- **SDKs** (from research SUMMARY.md):
  - Marinade: `@marinade.finance/marinade-ts-sdk` ^5.0.15 (stable, audited)
  - Raydium: `@raydium-io/raydium-sdk-v2` ^0.2.32-alpha (pin exact -- alpha)
  - Kamino: `@kamino-finance/klend-sdk` ^7.1.6 (watch for @solana/kit transitive dep conflict)
- **Scope cut rule** (Day 3): If SDK conflicts with Raydium/Kamino arise after 4 hours, drop DEFI-03 and DEFI-04. Jupiter + Marinade is sufficient. Jupiter already aggregates Raydium for swaps.
- **Key constraint**: All adapters MUST isolate their SDK dependencies in their own workspace package to prevent borsh/PublicKey version conflicts (Pitfall D2 from research).
- **Token mints needed**: mSOL mainnet `mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So`, already in token registry.

## Tasks

### Task 1: Marinade Adapter Package Setup

**File: `P:\solana-agent-hackathon\packages\adapters\marinade\package.json`**

```json
{
  "name": "@makora/adapters-marinade",
  "version": "0.1.0",
  "private": true,
  "description": "Marinade liquid staking adapter for Makora",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "src"],
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts --clean",
    "dev": "tsup src/index.ts --format cjs,esm --dts --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@makora/types": "workspace:*",
    "@marinade.finance/marinade-ts-sdk": "^5.0.15",
    "@solana/web3.js": "^1.98.4",
    "@solana/spl-token": "^0.4.14"
  },
  "devDependencies": {
    "tsup": "^8.0.1",
    "typescript": "^5.3.0",
    "rimraf": "^5.0.0"
  }
}
```

**File: `P:\solana-agent-hackathon\packages\adapters\marinade\tsconfig.json`**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

### Task 2: Marinade Constants

**File: `P:\solana-agent-hackathon\packages\adapters\marinade\src\constants.ts`**

```typescript
import { PublicKey } from '@solana/web3.js';

/** Marinade Finance program ID (mainnet) */
export const MARINADE_PROGRAM_ID = new PublicKey('MarBmsSgKXdrN1egZf5sqe1TMai9K1rChYNDJgjq7aD');

/** mSOL token mint (mainnet) */
export const MSOL_MINT = new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So');

/** Marinade state account (mainnet) */
export const MARINADE_STATE = new PublicKey('8szGkuLTAux9XMgZ2vtY39jVSowEcpBfFfD8hXSEqdGC');

/** Native SOL wrapped mint */
export const NATIVE_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

/** Default priority fee for Marinade transactions (lamports) */
export const DEFAULT_PRIORITY_FEE_LAMPORTS = 5_000;

/** Maximum stake amount in SOL per single transaction */
export const MAX_STAKE_AMOUNT_SOL = 10_000;

/** Minimum stake amount in lamports (0.001 SOL) */
export const MIN_STAKE_AMOUNT_LAMPORTS = 1_000_000n;
```

### Task 3: Marinade Adapter

The core adapter implementing `ProtocolAdapter`. Uses `@marinade.finance/marinade-ts-sdk` for stake/unstake.

**File: `P:\solana-agent-hackathon\packages\adapters\marinade\src\adapter.ts`**

```typescript
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
```

### Task 4: Marinade Adapter Index

**File: `P:\solana-agent-hackathon\packages\adapters\marinade\src\index.ts`**

```typescript
/**
 * @makora/adapters-marinade - Marinade Finance liquid staking adapter
 *
 * Supports:
 * - Staking SOL -> mSOL (liquid staking)
 * - Unstaking mSOL -> SOL (liquid unstake via pool)
 * - Reading mSOL positions and APY
 */

export { MarinadeAdapter } from './adapter.js';
export {
  MARINADE_PROGRAM_ID,
  MSOL_MINT,
  MARINADE_STATE,
  MIN_STAKE_AMOUNT_LAMPORTS,
} from './constants.js';
```

### Task 5: Raydium Adapter Package Setup

**File: `P:\solana-agent-hackathon\packages\adapters\raydium\package.json`**

```json
{
  "name": "@makora/adapters-raydium",
  "version": "0.1.0",
  "private": true,
  "description": "Raydium AMM liquidity provision adapter for Makora",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "src"],
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts --clean",
    "dev": "tsup src/index.ts --format cjs,esm --dts --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@makora/types": "workspace:*",
    "@raydium-io/raydium-sdk-v2": "0.2.32-alpha",
    "@solana/web3.js": "^1.98.4",
    "@solana/spl-token": "^0.4.14"
  },
  "devDependencies": {
    "tsup": "^8.0.1",
    "typescript": "^5.3.0",
    "rimraf": "^5.0.0"
  }
}
```

**NOTE**: Pin Raydium SDK to exact version `0.2.32-alpha` (no caret). This is an alpha release and minor updates may introduce breaking changes.

**File: `P:\solana-agent-hackathon\packages\adapters\raydium\tsconfig.json`**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

### Task 6: Raydium Constants

**File: `P:\solana-agent-hackathon\packages\adapters\raydium\src\constants.ts`**

```typescript
import { PublicKey } from '@solana/web3.js';

/** Raydium AMM program ID (mainnet) */
export const RAYDIUM_AMM_PROGRAM_ID = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

/** Raydium CLMM (Concentrated Liquidity) program ID (mainnet) */
export const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');

/** Raydium CPMM (Constant Product) program ID (mainnet) */
export const RAYDIUM_CPMM_PROGRAM_ID = new PublicKey('CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C');

/** Raydium API base URL for pool data */
export const RAYDIUM_API_BASE_URL = 'https://api-v3.raydium.io';

/** Known high-TVL pools for default suggestions */
export const KNOWN_POOLS = {
  /** SOL/USDC AMM pool */
  SOL_USDC: new PublicKey('58oQChx4yWmvKdwLLZzBi4ChoCc2fqCUWBkwMihLYQo2'),
  /** SOL/USDT AMM pool */
  SOL_USDT: new PublicKey('7XawhbbxtsRcQA8KTkHT9f9nc6d69UwqCDh6U5EEbEmX'),
} as const;

/** Default slippage for LP operations in basis points (1%) */
export const DEFAULT_LP_SLIPPAGE_BPS = 100;

/** Minimum liquidity amount in lamports */
export const MIN_LIQUIDITY_AMOUNT_LAMPORTS = 10_000_000n; // 0.01 SOL equivalent
```

### Task 7: Raydium Adapter

Implements `ProtocolAdapter` for Raydium AMM liquidity provision. Swaps are handled by Jupiter (which already routes through Raydium). This adapter is specifically for LP management.

**File: `P:\solana-agent-hackathon\packages\adapters\raydium\src\adapter.ts`**

```typescript
import { Raydium } from '@raydium-io/raydium-sdk-v2';
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';
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
 * Wraps @raydium-io/raydium-sdk-v2 behind the uniform ProtocolAdapter interface.
 * This adapter handles LP operations ONLY:
 * - Provide liquidity to AMM/CLMM pools
 * - Remove liquidity from pools
 * - Read LP positions
 *
 * Swaps through Raydium are handled by the Jupiter adapter (which aggregates Raydium).
 *
 * SDK docs: https://github.com/raydium-io/raydium-sdk-V2
 * Raydium API: https://api-v3.raydium.io
 */
export class RaydiumAdapter implements ProtocolAdapter {
  readonly protocolId = 'raydium' as const;
  readonly name = 'Raydium AMM';
  readonly version = '2.0';

  private raydium!: Raydium;
  private connection!: Connection;
  private walletPublicKey!: PublicKey;
  private initialized = false;

  async initialize(config: AdapterConfig): Promise<void> {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.walletPublicKey = config.walletPublicKey;

    // Initialize Raydium SDK
    // The SDK loads pool data, token lists, etc.
    this.raydium = await Raydium.load({
      connection: this.connection,
      owner: this.walletPublicKey,
      // Disable full data load for faster init -- we will fetch pool data on demand
      disableLoadToken: true,
    });

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
   * Reads the user's LP token balances across Raydium AMM pools.
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
   * Adds liquidity to a Raydium AMM pool. Both token A and token B must be provided
   * in the correct ratio. The SDK calculates the optimal amounts.
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

    const poolId = params.destination.toBase58();

    // Fetch pool keys for the target pool
    const poolKeys = await this.raydium.liquidity.getAmmPoolKeys(poolId);

    if (!poolKeys) {
      throw new Error(`Failed to fetch pool keys for Raydium pool: ${poolId}`);
    }

    // Build add-liquidity instruction
    // The SDK computes the optimal token B amount based on pool ratio
    const { transaction } = await this.raydium.liquidity.addLiquidity({
      poolKeys,
      amountInA: params.amount,
      amountInB: 0n, // SDK calculates based on pool ratio
      fixedSide: 'a', // Fix token A amount, calculate token B
      config: {
        associatedOnly: true,
      },
    });

    // Extract instructions from the SDK transaction
    return transaction.instructions;
  }

  /**
   * Build withdraw (remove liquidity) instructions.
   *
   * Removes liquidity from a Raydium AMM pool by burning LP tokens.
   *
   * @param params.source - Pool address (AMM ID)
   * @param params.amount - Amount of LP tokens to burn
   */
  async buildWithdrawIx(params: WithdrawParams): Promise<TransactionInstruction[]> {
    this.ensureInitialized();

    const poolId = params.source.toBase58();

    // Fetch pool keys
    const poolKeys = await this.raydium.liquidity.getAmmPoolKeys(poolId);

    if (!poolKeys) {
      throw new Error(`Failed to fetch pool keys for Raydium pool: ${poolId}`);
    }

    // Build remove-liquidity instruction
    const { transaction } = await this.raydium.liquidity.removeLiquidity({
      poolKeys,
      amountIn: params.amount,
      config: {
        associatedOnly: true,
      },
    });

    return transaction.instructions;
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
```

### Task 8: Raydium Adapter Index

**File: `P:\solana-agent-hackathon\packages\adapters\raydium\src\index.ts`**

```typescript
/**
 * @makora/adapters-raydium - Raydium AMM liquidity provision adapter
 *
 * Supports:
 * - Provide liquidity to AMM pools (earn trading fees)
 * - Remove liquidity from pools
 * - Read LP positions
 *
 * NOTE: Swaps through Raydium are handled by the Jupiter adapter.
 * This adapter is for LP management only.
 */

export { RaydiumAdapter } from './adapter.js';
export {
  RAYDIUM_AMM_PROGRAM_ID,
  RAYDIUM_CLMM_PROGRAM_ID,
  RAYDIUM_CPMM_PROGRAM_ID,
  RAYDIUM_API_BASE_URL,
  KNOWN_POOLS,
  DEFAULT_LP_SLIPPAGE_BPS,
} from './constants.js';
```

### Task 9: Kamino Adapter Package Setup

**File: `P:\solana-agent-hackathon\packages\adapters\kamino\package.json`**

```json
{
  "name": "@makora/adapters-kamino",
  "version": "0.1.0",
  "private": true,
  "description": "Kamino Finance vault adapter for Makora",
  "main": "dist/index.js",
  "module": "dist/index.mjs",
  "types": "dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist", "src"],
  "scripts": {
    "build": "tsup src/index.ts --format cjs,esm --dts --clean",
    "dev": "tsup src/index.ts --format cjs,esm --dts --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@makora/types": "workspace:*",
    "@kamino-finance/klend-sdk": "^7.1.6",
    "@solana/web3.js": "^1.98.4",
    "@solana/spl-token": "^0.4.14"
  },
  "devDependencies": {
    "tsup": "^8.0.1",
    "typescript": "^5.3.0",
    "rimraf": "^5.0.0"
  }
}
```

**IMPORTANT**: If `@kamino-finance/klend-sdk` pulls in `@solana/kit` or `@solana/web3.js@2` as a transitive dependency, add a pnpm override in the root `package.json`:

```json
{
  "pnpm": {
    "overrides": {
      "@solana/web3.js": "^1.98.4"
    }
  }
}
```

This prevents the Anchor-incompatible v2 SDK from leaking into the dependency tree.

**File: `P:\solana-agent-hackathon\packages\adapters\kamino\tsconfig.json`**

```json
{
  "extends": "../../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

### Task 10: Kamino Constants

**File: `P:\solana-agent-hackathon\packages\adapters\kamino\src\constants.ts`**

```typescript
import { PublicKey } from '@solana/web3.js';

/** Kamino Lending (kLend) program ID (mainnet) */
export const KAMINO_LEND_PROGRAM_ID = new PublicKey('KLend2g3cP87ber41GXWsSZQz5NkCeMtW3aCdBqePxG');

/** Kamino Liquidity program ID (mainnet) */
export const KAMINO_LIQUIDITY_PROGRAM_ID = new PublicKey('KLiquQBRewRPyMgSFvehorBDf3PK5ZBT3e5U3yWDmZJ');

/** Kamino main market address (mainnet) */
export const KAMINO_MAIN_MARKET = new PublicKey('7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF');

/** Kamino API base URL */
export const KAMINO_API_BASE_URL = 'https://api.hubbleprotocol.io/kamino';

/** Minimum deposit amount in lamports */
export const MIN_DEPOSIT_AMOUNT_LAMPORTS = 1_000_000n; // 0.001 SOL equivalent

/** Known Kamino vault strategies */
export const KNOWN_VAULTS = {
  /** SOL-USDC vault (most popular) */
  SOL_USDC: new PublicKey('ByxRYF4YKxasDqEr6VTtM5tLZqAR31YjGxsNEepKLUno'),
  /** SOL-mSOL vault */
  SOL_MSOL: new PublicKey('8DRToyNBUTR1PFNmEiRrHMGqbWf7Bfo2DhLHVFE1FbbD'),
} as const;
```

### Task 11: Kamino Adapter

Implements `ProtocolAdapter` for Kamino automated vault deposits and withdrawals.

**File: `P:\solana-agent-hackathon\packages\adapters\kamino\src\adapter.ts`**

```typescript
import { KaminoMarket, KaminoReserve } from '@kamino-finance/klend-sdk';
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
 * Wraps @kamino-finance/klend-sdk behind the uniform ProtocolAdapter interface.
 * Supports:
 * - Deposit tokens into Kamino lending reserves (earn yield)
 * - Withdraw tokens from Kamino reserves
 * - Read vault positions (deposits + earned interest)
 *
 * Kamino's kLend is a lending protocol where depositors earn yield from borrowers.
 * Each "vault" is a reserve within the Kamino market.
 *
 * Docs: https://docs.kamino.finance/
 * SDK: https://github.com/hubbleprotocol/kamino-lending-sdk
 */
export class KaminoAdapter implements ProtocolAdapter {
  readonly protocolId = 'kamino' as const;
  readonly name = 'Kamino Finance';
  readonly version = '7.0';

  private market!: KaminoMarket;
  private connection!: Connection;
  private walletPublicKey!: PublicKey;
  private initialized = false;

  async initialize(config: AdapterConfig): Promise<void> {
    this.connection = new Connection(config.rpcUrl, 'confirmed');
    this.walletPublicKey = config.walletPublicKey;

    // Load Kamino market (fetches all reserves and their state)
    this.market = await KaminoMarket.load(
      this.connection,
      KAMINO_MAIN_MARKET,
      KAMINO_LEND_PROGRAM_ID
    );

    if (!this.market) {
      throw new Error('Failed to load Kamino market');
    }

    this.initialized = true;
  }

  async healthCheck(): Promise<ProtocolHealth> {
    const start = Date.now();
    try {
      this.ensureInitialized();
      // Refresh market data as health check
      await this.market.loadReserves();

      const reserves = this.market.reserves;
      if (!reserves || reserves.size === 0) {
        throw new Error('No reserves loaded from Kamino market');
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
   * Returns deposits in Kamino reserves with current APY.
   */
  async getPositions(owner: PublicKey): Promise<Position[]> {
    this.ensureInitialized();
    const positions: Position[] = [];

    try {
      // Refresh reserves to get latest state
      await this.market.loadReserves();

      // Get all user obligations (deposits + borrows)
      const obligations = await this.market.getAllUserObligations(owner);

      for (const obligation of obligations) {
        // Process deposits
        for (const deposit of obligation.deposits) {
          const reserve = this.market.getReserveByAddress(deposit.reserveAddress);
          if (!reserve) continue;

          const tokenMint = reserve.getLiquidityMint();
          const symbol = reserve.getTokenSymbol() ?? 'UNKNOWN';
          const decimals = reserve.getMintDecimals() ?? 9;
          const depositAmount = deposit.amount;
          const depositUsd = deposit.marketValueRefreshed?.toNumber() ?? 0;
          const supplyApy = reserve.calculateSupplyAPY()?.toNumber() ?? 0;

          positions.push({
            protocolId: this.protocolId,
            type: 'vault',
            token: {
              symbol,
              name: `${symbol} (Kamino Deposit)`,
              mint: tokenMint,
              decimals,
            },
            amount: BigInt(Math.floor(depositAmount.toNumber() * 10 ** decimals)),
            usdValue: depositUsd,
            apy: supplyApy * 100, // Convert to percentage
            metadata: {
              reserveAddress: deposit.reserveAddress.toBase58(),
              obligationAddress: obligation.obligationAddress.toBase58(),
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
   * Shows expected yield based on current supply APY.
   */
  async getQuote(params: QuoteParams): Promise<Quote> {
    this.ensureInitialized();

    // Find the reserve for the input token
    const reserve = this.findReserveByMint(params.inputToken);
    if (!reserve) {
      throw new Error(`No Kamino reserve found for token: ${params.inputToken.toBase58()}`);
    }

    const supplyApy = reserve.calculateSupplyAPY()?.toNumber() ?? 0;
    const symbol = reserve.getTokenSymbol() ?? 'UNKNOWN';

    // For lending deposits, output is a cToken (collateral token) representing the deposit
    const cTokenMint = reserve.getCTokenMint();

    return {
      protocolId: this.protocolId,
      inputToken: {
        symbol,
        name: `${symbol}`,
        mint: params.inputToken,
        decimals: reserve.getMintDecimals() ?? 9,
      },
      outputToken: {
        symbol: `c${symbol}`,
        name: `Kamino Collateral ${symbol}`,
        mint: cTokenMint,
        decimals: reserve.getMintDecimals() ?? 9,
      },
      inputAmount: params.amount,
      expectedOutputAmount: params.amount, // 1:1 at deposit time (cToken appreciates over time)
      minimumOutputAmount: params.amount,
      priceImpactPct: 0,
      feesUsd: 0, // No deposit fees on Kamino
      routeDescription: `Deposit ${symbol} into Kamino reserve (${(supplyApy * 100).toFixed(2)}% APY)`,
      raw: {
        reserveAddress: reserve.address.toBase58(),
        supplyApy: supplyApy * 100,
        totalDeposits: reserve.getTotalSupply()?.toNumber() ?? 0,
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
   * Deposits tokens into the Kamino reserve to earn yield from borrowers.
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

    // Find reserve by token mint
    const reserve = this.findReserveByMint(params.token);
    if (!reserve) {
      throw new Error(`No Kamino reserve found for token: ${params.token.toBase58()}`);
    }

    // Build deposit instruction using SDK
    // The SDK creates all necessary account lookups, ATA creation, etc.
    const instructions: TransactionInstruction[] = [];

    // First, check if user has an obligation account (needed for deposits)
    const obligations = await this.market.getAllUserObligations(params.userPublicKey);

    let obligationAddress: PublicKey;

    if (obligations.length === 0) {
      // Create obligation account first
      const createObligationIx = await this.market.createObligation(
        params.userPublicKey
      );
      instructions.push(...createObligationIx);
      // Derive the obligation address (PDA)
      obligationAddress = await this.market.getObligationAddress(params.userPublicKey);
    } else {
      obligationAddress = obligations[0].obligationAddress;
    }

    // Build deposit instruction
    const depositIx = await this.market.depositReserve(
      reserve.address,
      params.amount,
      params.userPublicKey,
      obligationAddress
    );

    instructions.push(...depositIx);

    return instructions;
  }

  /**
   * Build withdraw instructions from a Kamino lending reserve.
   *
   * Withdraws deposited tokens (plus earned interest) from the reserve.
   *
   * @param params.token - Token mint to withdraw
   * @param params.amount - Amount in smallest units (lamports). Use BigInt max for "withdraw all".
   * @param params.source - Reserve address (or use token mint to auto-find)
   */
  async buildWithdrawIx(params: WithdrawParams): Promise<TransactionInstruction[]> {
    this.ensureInitialized();

    // Find reserve by token mint
    const reserve = this.findReserveByMint(params.token);
    if (!reserve) {
      throw new Error(`No Kamino reserve found for token: ${params.token.toBase58()}`);
    }

    // Get user's obligation
    const obligations = await this.market.getAllUserObligations(params.userPublicKey);
    if (obligations.length === 0) {
      throw new Error('No Kamino positions found for this wallet. Nothing to withdraw.');
    }

    const obligationAddress = obligations[0].obligationAddress;

    // Build withdraw instruction
    const withdrawIx = await this.market.withdrawReserve(
      reserve.address,
      params.amount,
      params.userPublicKey,
      obligationAddress
    );

    return withdrawIx;
  }

  // ---- Public helper methods (used by strategy engine) ----

  /**
   * Get all available reserves with their supply APYs.
   * Useful for the strategy engine to find yield opportunities.
   */
  async getAvailableReserves(): Promise<
    Array<{
      reserveAddress: PublicKey;
      tokenMint: PublicKey;
      symbol: string;
      supplyApy: number;
      totalDeposits: number;
      utilizationRate: number;
    }>
  > {
    this.ensureInitialized();
    await this.market.loadReserves();

    const reserves: Array<{
      reserveAddress: PublicKey;
      tokenMint: PublicKey;
      symbol: string;
      supplyApy: number;
      totalDeposits: number;
      utilizationRate: number;
    }> = [];

    for (const [, reserve] of this.market.reserves) {
      const symbol = reserve.getTokenSymbol() ?? 'UNKNOWN';
      const supplyApy = reserve.calculateSupplyAPY()?.toNumber() ?? 0;
      const totalDeposits = reserve.getTotalSupply()?.toNumber() ?? 0;
      const utilization = reserve.calculateUtilizationRatio()?.toNumber() ?? 0;

      reserves.push({
        reserveAddress: reserve.address,
        tokenMint: reserve.getLiquidityMint(),
        symbol,
        supplyApy: supplyApy * 100,
        totalDeposits,
        utilizationRate: utilization * 100,
      });
    }

    // Sort by APY descending
    reserves.sort((a, b) => b.supplyApy - a.supplyApy);

    return reserves;
  }

  // ---- Private helpers ----

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('KaminoAdapter not initialized. Call initialize() first.');
    }
  }

  /**
   * Find a Kamino reserve by token mint address.
   */
  private findReserveByMint(mint: PublicKey): KaminoReserve | undefined {
    for (const [, reserve] of this.market.reserves) {
      if (reserve.getLiquidityMint().equals(mint)) {
        return reserve;
      }
    }
    return undefined;
  }
}
```

### Task 12: Kamino Adapter Index

**File: `P:\solana-agent-hackathon\packages\adapters\kamino\src\index.ts`**

```typescript
/**
 * @makora/adapters-kamino - Kamino Finance vault/lending adapter
 *
 * Supports:
 * - Deposit tokens into Kamino lending reserves (earn yield)
 * - Withdraw tokens from reserves
 * - Read deposit positions and APYs
 *
 * Kamino's kLend is a lending protocol where depositors earn yield
 * from borrowers. Each reserve accepts a specific token.
 */

export { KaminoAdapter } from './adapter.js';
export {
  KAMINO_LEND_PROGRAM_ID,
  KAMINO_LIQUIDITY_PROGRAM_ID,
  KAMINO_MAIN_MARKET,
  KAMINO_API_BASE_URL,
  KNOWN_VAULTS,
} from './constants.js';
```

### Task 13: Update Token Registry

Add mSOL to devnet token registry (needed for Marinade devnet testing). Also add Raydium LP token placeholder.

**File: `P:\solana-agent-hackathon\packages\data-feed\src\tokens.ts`** (MODIFY existing file)

Add to the `devnet` array in `TOKEN_REGISTRY`:

```typescript
    {
      symbol: 'mSOL',
      name: 'Marinade staked SOL',
      mint: new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'),
      decimals: 9,
      coingeckoId: 'msol',
    },
```

The final devnet array should be:

```typescript
  devnet: [
    {
      symbol: 'SOL',
      name: 'Solana',
      mint: NATIVE_SOL_MINT,
      decimals: 9,
      coingeckoId: 'solana',
    },
    {
      symbol: 'USDC',
      name: 'USD Coin',
      mint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU'),
      decimals: 6,
      coingeckoId: 'usd-coin',
    },
    {
      symbol: 'mSOL',
      name: 'Marinade staked SOL',
      mint: new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'),
      decimals: 9,
      coingeckoId: 'msol',
    },
  ],
```

### Task 14: Update pnpm-workspace.yaml

The existing `pnpm-workspace.yaml` already includes `packages/adapters/*`, so no change is needed. Verify the file at `P:\solana-agent-hackathon\pnpm-workspace.yaml` contains:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'packages/adapters/*'
```

### Task 15: Install Dependencies and Build

```bash
cd P:\solana-agent-hackathon

# Install new dependencies
pnpm install

# Build all packages (dependency order handled by turborepo)
pnpm build
```

If the Kamino SDK pulls in `@solana/kit` or `@solana/web3.js@2`, add to root `package.json`:

```json
{
  "pnpm": {
    "overrides": {
      "@solana/web3.js": "^1.98.4"
    }
  }
}
```

Then re-run `pnpm install && pnpm build`.

**SCOPE CUT TRIGGER**: If any SDK fails to resolve or causes TypeScript compilation errors after 4 hours of debugging:
- DROP `@makora/adapters-raydium` and `@makora/adapters-kamino`
- KEEP `@makora/adapters-marinade` (stable SDK, audited, low risk)
- Jupiter already aggregates Raydium for swaps -- the agent still works with 2 protocols

## Verification

1. **All three adapter packages compile** -- `packages/adapters/marinade/dist/`, `packages/adapters/raydium/dist/`, and `packages/adapters/kamino/dist/` all contain compiled JavaScript and type declarations.
2. **Marinade adapter initializes** -- `new MarinadeAdapter()` followed by `initialize({ rpcUrl, walletPublicKey })` completes without error.
3. **Marinade staking works** -- `buildStakeIx({ amount: 100_000_000n, userPublicKey })` (0.1 SOL) returns a non-empty `TransactionInstruction[]` array.
4. **Marinade unstaking works** -- `buildUnstakeIx({ amount: 100_000_000n, userPublicKey })` returns a non-empty `TransactionInstruction[]` array.
5. **Marinade positions read** -- `getPositions(owner)` returns an array (may be empty if no mSOL held, but does not throw).
6. **Raydium adapter compiles and initializes** -- no import errors from `@raydium-io/raydium-sdk-v2`.
7. **Kamino adapter compiles and initializes** -- no import errors from `@kamino-finance/klend-sdk`.
8. **No TypeScript errors** -- `pnpm typecheck` passes for all three adapter packages.
9. **Token registry updated** -- `findTokenBySymbol('mSOL', 'devnet')` returns a valid `TokenInfo` object.

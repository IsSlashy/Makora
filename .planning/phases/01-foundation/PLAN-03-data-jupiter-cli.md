---
phase: 01-foundation
plan: 03
type: execute
wave: 2
depends_on: [01, 02]
files_modified:
  - packages/data-feed/package.json
  - packages/data-feed/tsconfig.json
  - packages/data-feed/src/index.ts
  - packages/data-feed/src/connection.ts
  - packages/data-feed/src/price-feed.ts
  - packages/data-feed/src/portfolio.ts
  - packages/data-feed/src/tokens.ts
  - packages/adapters/jupiter/package.json
  - packages/adapters/jupiter/tsconfig.json
  - packages/adapters/jupiter/src/index.ts
  - packages/adapters/jupiter/src/adapter.ts
  - packages/adapters/jupiter/src/constants.ts
  - apps/cli/package.json
  - apps/cli/tsconfig.json
  - apps/cli/src/index.ts
  - apps/cli/src/commands/status.ts
  - apps/cli/src/utils/config.ts
  - apps/cli/src/utils/display.ts
  - apps/cli/src/utils/wallet.ts
autonomous: true
must_haves:
  truths:
    - "`pnpm build` compiles all packages including data-feed, jupiter adapter, and CLI"
    - "`makora status` connects to devnet via Helius RPC and prints wallet balances with USD values"
    - "Jupiter adapter can fetch a SOL->USDC quote on devnet"
    - "Jupiter adapter can execute a SOL->USDC swap on devnet (returns confirmed tx signature)"
    - "CLI output is formatted with colors, tables, and USD values"
    - "Data feed falls back to public RPC if Helius key is not set"
  artifacts:
    - packages/data-feed/dist/index.js
    - packages/adapters/jupiter/dist/index.js
    - apps/cli/dist/index.js
---

# Plan 03: Data Feed + Jupiter Adapter + CLI Status (INFRA-04, DEFI-01, CLI-01)

## Objective

Build the Helius-powered data feed for wallet balances and token prices, the Jupiter swap adapter implementing the `ProtocolAdapter` interface, and the `makora status` CLI command. After this plan completes, running `makora status` connects to Solana devnet and displays wallet balances with USD values, and the Jupiter adapter can execute a SOL->USDC swap on devnet.

## Context

- **Depends on Plan 01**: Needs `@makora/types` compiled and the monorepo infrastructure in place.
- **RPC strategy**: Helius as primary (INFRA-04), public devnet as fallback. Helius free tier gives 1M credits/month, 10 RPS.
- **Jupiter SDK**: `@jup-ag/api` v6.0.48 (REST client). NOT `@jup-ag/core` (deprecated). NOT `lite-api.jup.ag` (deprecated 2026-01-31).
- **CLI framework**: Commander.js v14.x with chalk for colors, cli-table3 for tables, ora for spinners.
- **Token prices**: Jupiter Price API v2 (`https://api.jup.ag/price/v2`) for simplicity. No Pyth WebSocket at this stage (that is Phase 2+ optimization).
- **Package build**: tsup for dual CJS/ESM output, same as `@makora/types`.
- **Important token mints on devnet**:
  - SOL (native): `So11111111111111111111111111111111111111112`
  - USDC (devnet): `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU` (may vary; use Jupiter's token list)

## Tasks

### Task 1: @makora/data-feed Package Setup

**File: `P:\solana-agent-hackathon\packages\data-feed\package.json`**

```json
{
  "name": "@makora/data-feed",
  "version": "0.1.0",
  "private": true,
  "description": "Solana data feed for Makora - wallet balances, token prices, portfolio state",
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

**File: `P:\solana-agent-hackathon\packages\data-feed\tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

### Task 2: Solana Connection Manager

Manages the RPC connection with Helius primary and public fallback.

**File: `P:\solana-agent-hackathon\packages\data-feed\src\connection.ts`**

```typescript
import { Connection, type Commitment } from '@solana/web3.js';
import type { SolanaCluster } from '@makora/types';

/** RPC endpoints by cluster */
const RPC_ENDPOINTS: Record<SolanaCluster, { primary: string; fallback: string }> = {
  devnet: {
    primary: '', // Set via HELIUS_API_KEY env var
    fallback: 'https://api.devnet.solana.com',
  },
  'mainnet-beta': {
    primary: '',
    fallback: 'https://api.mainnet-beta.solana.com',
  },
  localnet: {
    primary: 'http://127.0.0.1:8899',
    fallback: 'http://127.0.0.1:8899',
  },
};

export interface ConnectionConfig {
  cluster: SolanaCluster;
  heliusApiKey?: string;
  customRpcUrl?: string;
  commitment?: Commitment;
}

/**
 * Creates a Solana connection with Helius as primary and public RPC as fallback.
 *
 * Priority order:
 * 1. Custom RPC URL (if provided)
 * 2. Helius (if API key is provided)
 * 3. Public RPC (always available)
 */
export function createConnection(config: ConnectionConfig): Connection {
  const { cluster, heliusApiKey, customRpcUrl, commitment = 'confirmed' } = config;

  let rpcUrl: string;

  if (customRpcUrl) {
    rpcUrl = customRpcUrl;
  } else if (heliusApiKey && cluster !== 'localnet') {
    const subdomain = cluster === 'devnet' ? 'devnet' : 'mainnet';
    rpcUrl = `https://${subdomain}.helius-rpc.com/?api-key=${heliusApiKey}`;
  } else {
    rpcUrl = RPC_ENDPOINTS[cluster].fallback;
  }

  return new Connection(rpcUrl, {
    commitment,
    confirmTransactionInitialTimeout: 60_000,
  });
}

/**
 * Get the RPC URL that would be used for a given config.
 * Useful for display/logging without exposing the full API key.
 */
export function getRpcDisplayUrl(config: ConnectionConfig): string {
  if (config.customRpcUrl) {
    return config.customRpcUrl;
  }
  if (config.heliusApiKey && config.cluster !== 'localnet') {
    const subdomain = config.cluster === 'devnet' ? 'devnet' : 'mainnet';
    return `https://${subdomain}.helius-rpc.com/?api-key=***`;
  }
  return RPC_ENDPOINTS[config.cluster].fallback;
}
```

### Task 3: Known Token Registry

Defines known tokens with their mint addresses for devnet and mainnet.

**File: `P:\solana-agent-hackathon\packages\data-feed\src\tokens.ts`**

```typescript
import { PublicKey } from '@solana/web3.js';
import type { TokenInfo, SolanaCluster } from '@makora/types';

/** Well-known SPL token mints */
export const NATIVE_SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

/** Known tokens per cluster */
const TOKEN_REGISTRY: Record<SolanaCluster, TokenInfo[]> = {
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
  ],
  'mainnet-beta': [
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
      mint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'),
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
    {
      symbol: 'USDT',
      name: 'Tether USD',
      mint: new PublicKey('Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB'),
      decimals: 6,
      coingeckoId: 'tether',
    },
  ],
  localnet: [
    {
      symbol: 'SOL',
      name: 'Solana',
      mint: NATIVE_SOL_MINT,
      decimals: 9,
      coingeckoId: 'solana',
    },
  ],
};

/**
 * Get known tokens for a given cluster.
 */
export function getKnownTokens(cluster: SolanaCluster): TokenInfo[] {
  return TOKEN_REGISTRY[cluster] ?? TOKEN_REGISTRY.devnet;
}

/**
 * Find a token by symbol in the registry.
 */
export function findTokenBySymbol(symbol: string, cluster: SolanaCluster): TokenInfo | undefined {
  return getKnownTokens(cluster).find(
    (t) => t.symbol.toUpperCase() === symbol.toUpperCase()
  );
}

/**
 * Find a token by mint address in the registry.
 */
export function findTokenByMint(mint: PublicKey, cluster: SolanaCluster): TokenInfo | undefined {
  return getKnownTokens(cluster).find(
    (t) => t.mint.equals(mint)
  );
}
```

### Task 4: Price Feed (Jupiter Price API)

Fetches token prices from Jupiter's Price API v2. Simple HTTP polling -- no WebSocket at this stage.

**File: `P:\solana-agent-hackathon\packages\data-feed\src\price-feed.ts`**

```typescript
import { PublicKey } from '@solana/web3.js';
import type { TokenPrice } from '@makora/types';

const JUPITER_PRICE_API = 'https://api.jup.ag/price/v2';

/** Cache entry with TTL */
interface CacheEntry {
  price: TokenPrice;
  expiresAt: number;
}

/**
 * Fetches token prices from Jupiter Price API v2.
 *
 * This is the simplest price data source -- HTTP request, no WebSocket.
 * Suitable for CLI commands and infrequent reads.
 * For real-time prices (Phase 2+), use Pyth WebSocket subscriptions.
 */
export class JupiterPriceFeed {
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTtlMs: number;

  constructor(cacheTtlMs: number = 10_000) {
    this.cacheTtlMs = cacheTtlMs;
  }

  /**
   * Get price for a single token.
   */
  async getPrice(mint: PublicKey): Promise<TokenPrice | null> {
    const prices = await this.getPrices([mint]);
    return prices.get(mint.toBase58()) ?? null;
  }

  /**
   * Get prices for multiple tokens in a single request.
   * Uses Jupiter Price API v2 batch endpoint.
   */
  async getPrices(mints: PublicKey[]): Promise<Map<string, TokenPrice>> {
    const result = new Map<string, TokenPrice>();
    const uncachedMints: PublicKey[] = [];
    const now = Date.now();

    // Check cache first
    for (const mint of mints) {
      const key = mint.toBase58();
      const cached = this.cache.get(key);
      if (cached && cached.expiresAt > now) {
        result.set(key, cached.price);
      } else {
        uncachedMints.push(mint);
      }
    }

    if (uncachedMints.length === 0) {
      return result;
    }

    // Fetch uncached prices from Jupiter
    try {
      const ids = uncachedMints.map((m) => m.toBase58()).join(',');
      const response = await fetch(`${JUPITER_PRICE_API}?ids=${ids}`);

      if (!response.ok) {
        console.warn(`Jupiter Price API returned ${response.status}`);
        return result;
      }

      const data = (await response.json()) as {
        data: Record<string, { id: string; price: string; type: string }>;
      };

      for (const [mintStr, priceData] of Object.entries(data.data ?? {})) {
        const price: TokenPrice = {
          mint: new PublicKey(mintStr),
          symbol: '', // Will be enriched by caller
          priceUsd: parseFloat(priceData.price),
          timestamp: Math.floor(now / 1000),
          source: 'jupiter',
        };

        result.set(mintStr, price);
        this.cache.set(mintStr, {
          price,
          expiresAt: now + this.cacheTtlMs,
        });
      }
    } catch (err) {
      console.warn('Failed to fetch prices from Jupiter:', err);
    }

    return result;
  }

  /**
   * Clear the price cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}
```

### Task 5: Portfolio Reader

Reads wallet balances and enriches them with USD values.

**File: `P:\solana-agent-hackathon\packages\data-feed\src\portfolio.ts`**

```typescript
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { TokenBalance, PortfolioState, TokenInfo, SolanaCluster } from '@makora/types';
import { JupiterPriceFeed } from './price-feed.js';
import { getKnownTokens, findTokenByMint, NATIVE_SOL_MINT } from './tokens.js';

/**
 * Reads the full portfolio state for a wallet.
 *
 * Fetches:
 * 1. Native SOL balance
 * 2. All SPL token accounts
 * 3. USD prices for each token
 */
export class PortfolioReader {
  private connection: Connection;
  private priceFeed: JupiterPriceFeed;
  private cluster: SolanaCluster;

  constructor(connection: Connection, cluster: SolanaCluster) {
    this.connection = connection;
    this.priceFeed = new JupiterPriceFeed();
    this.cluster = cluster;
  }

  /**
   * Get the full portfolio state for a wallet.
   */
  async getPortfolio(owner: PublicKey): Promise<PortfolioState> {
    const balances: TokenBalance[] = [];
    const knownTokens = getKnownTokens(this.cluster);

    // 1. Fetch native SOL balance
    const solLamports = await this.connection.getBalance(owner);
    const solToken = knownTokens.find((t) => t.symbol === 'SOL');

    if (solToken) {
      balances.push({
        token: solToken,
        rawBalance: BigInt(solLamports),
        uiBalance: solLamports / LAMPORTS_PER_SOL,
        usdValue: 0, // Will be set after price fetch
        priceUsd: 0,
      });
    }

    // 2. Fetch SPL token accounts
    try {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(owner, {
        programId: TOKEN_PROGRAM_ID,
      });

      for (const account of tokenAccounts.value) {
        const parsed = account.account.data.parsed;
        if (parsed.type !== 'account') continue;

        const info = parsed.info;
        const mint = new PublicKey(info.mint);
        const amount = info.tokenAmount;

        // Skip zero balances
        if (amount.uiAmount === 0) continue;

        // Try to find token info in our registry
        let tokenInfo = findTokenByMint(mint, this.cluster);
        if (!tokenInfo) {
          // Unknown token -- create minimal info
          tokenInfo = {
            symbol: mint.toBase58().slice(0, 4) + '...',
            name: 'Unknown Token',
            mint,
            decimals: amount.decimals,
          };
        }

        balances.push({
          token: tokenInfo,
          rawBalance: BigInt(amount.amount),
          uiBalance: amount.uiAmount,
          usdValue: 0,
          priceUsd: 0,
        });
      }
    } catch (err) {
      console.warn('Failed to fetch SPL token accounts:', err);
    }

    // 3. Fetch USD prices for all tokens
    const mints = balances.map((b) => b.token.mint);
    const prices = await this.priceFeed.getPrices(mints);

    let totalValueUsd = 0;

    for (const balance of balances) {
      const mintStr = balance.token.mint.toBase58();
      const price = prices.get(mintStr);

      if (price) {
        balance.priceUsd = price.priceUsd;
        balance.usdValue = balance.uiBalance * price.priceUsd;
      }

      totalValueUsd += balance.usdValue;
    }

    // Sort by USD value (highest first)
    balances.sort((a, b) => b.usdValue - a.usdValue);

    return {
      owner,
      balances,
      totalValueUsd,
      solBalance: balances.find((b) => b.token.symbol === 'SOL')?.uiBalance ?? 0,
      lastUpdated: Date.now(),
    };
  }
}
```

### Task 6: Data Feed Package Index

**File: `P:\solana-agent-hackathon\packages\data-feed\src\index.ts`**

```typescript
/**
 * @makora/data-feed - Solana data feed for wallet balances, token prices, and portfolio state.
 *
 * Primary RPC: Helius (INFRA-04)
 * Price source: Jupiter Price API v2
 * Fallback: Public Solana devnet/mainnet RPC
 */

export { createConnection, getRpcDisplayUrl, type ConnectionConfig } from './connection.js';
export { JupiterPriceFeed } from './price-feed.js';
export { PortfolioReader } from './portfolio.js';
export {
  getKnownTokens,
  findTokenBySymbol,
  findTokenByMint,
  NATIVE_SOL_MINT,
} from './tokens.js';
```

### Task 7: @makora/adapters-jupiter Package Setup

**File: `P:\solana-agent-hackathon\packages\adapters\jupiter\package.json`**

```json
{
  "name": "@makora/adapters-jupiter",
  "version": "0.1.0",
  "private": true,
  "description": "Jupiter DEX aggregator adapter for Makora",
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
    "@jup-ag/api": "^6.0.48",
    "@solana/web3.js": "^1.98.4"
  },
  "devDependencies": {
    "tsup": "^8.0.1",
    "typescript": "^5.3.0",
    "rimraf": "^5.0.0"
  }
}
```

**File: `P:\solana-agent-hackathon\packages\adapters\jupiter\tsconfig.json`**

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

### Task 8: Jupiter Constants

**File: `P:\solana-agent-hackathon\packages\adapters\jupiter\src\constants.ts`**

```typescript
/** Jupiter API base URL (standard endpoint, NOT lite-api which was deprecated 2026-01-31) */
export const JUPITER_API_BASE_URL = 'https://quote-api.jup.ag/v6';

/** Default slippage in basis points (0.5%) */
export const DEFAULT_SLIPPAGE_BPS = 50;

/** Maximum auto slippage in basis points (3%) */
export const MAX_AUTO_SLIPPAGE_BPS = 300;
```

### Task 9: Jupiter Adapter

Implements the `ProtocolAdapter` interface from `@makora/types` using `@jup-ag/api`.

**File: `P:\solana-agent-hackathon\packages\adapters\jupiter\src\adapter.ts`**

```typescript
import { createJupiterApiClient, type QuoteResponse } from '@jup-ag/api';
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  VersionedTransaction,
  TransactionMessage,
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
        prioritizationFeeLamports: 'auto',
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
        prioritizationFeeLamports: 'auto',
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
```

### Task 10: Jupiter Adapter Index

**File: `P:\solana-agent-hackathon\packages\adapters\jupiter\src\index.ts`**

```typescript
/**
 * @makora/adapters-jupiter - Jupiter DEX aggregator adapter
 *
 * Provides swap routing across all Jupiter-connected DEXes:
 * Raydium, Orca, Lifinity, Meteora, Phoenix, OpenBook.
 */

export { JupiterAdapter } from './adapter.js';
export { JUPITER_API_BASE_URL, DEFAULT_SLIPPAGE_BPS, MAX_AUTO_SLIPPAGE_BPS } from './constants.js';
```

### Task 11: CLI Application Package

**File: `P:\solana-agent-hackathon\apps\cli\package.json`**

```json
{
  "name": "@makora/cli",
  "version": "0.1.0",
  "private": true,
  "description": "Makora CLI - Command-line interface for the adaptive DeFi agent",
  "type": "module",
  "bin": {
    "makora": "dist/index.js"
  },
  "main": "dist/index.js",
  "scripts": {
    "build": "tsup src/index.ts --format esm --clean --banner.js \"#!/usr/bin/env node\"",
    "dev": "tsup src/index.ts --format esm --watch",
    "start": "node dist/index.js",
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@makora/types": "workspace:*",
    "@makora/data-feed": "workspace:*",
    "@makora/adapters-jupiter": "workspace:*",
    "@solana/web3.js": "^1.98.4",
    "chalk": "^5.3.0",
    "cli-table3": "^0.6.5",
    "commander": "^14.0.0",
    "dotenv": "^16.4.0",
    "ora": "^8.0.0"
  },
  "devDependencies": {
    "@types/cli-table3": "^0.6.0",
    "tsup": "^8.0.1",
    "typescript": "^5.3.0",
    "rimraf": "^5.0.0"
  }
}
```

**File: `P:\solana-agent-hackathon\apps\cli\tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

### Task 12: CLI Config Utilities

**File: `P:\solana-agent-hackathon\apps\cli\src\utils\config.ts`**

```typescript
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MakoraConfig, SolanaCluster } from '@makora/types';

/**
 * Load Makora configuration from environment variables and .env file.
 */
export function loadConfig(): MakoraConfig {
  // Try to load .env file
  try {
    const dotenv = await import('dotenv');
    dotenv.config({ path: resolve(process.cwd(), '.env') });
  } catch {
    // dotenv not critical
  }

  const cluster = (process.env.SOLANA_NETWORK || 'devnet') as SolanaCluster;
  const heliusApiKey = process.env.HELIUS_API_KEY;

  let rpcUrl: string;
  if (process.env.SOLANA_RPC_URL) {
    rpcUrl = process.env.SOLANA_RPC_URL;
  } else if (heliusApiKey) {
    const subdomain = cluster === 'devnet' ? 'devnet' : 'mainnet';
    rpcUrl = `https://${subdomain}.helius-rpc.com/?api-key=${heliusApiKey}`;
  } else {
    rpcUrl = cluster === 'localnet'
      ? 'http://127.0.0.1:8899'
      : `https://api.${cluster}.solana.com`;
  }

  return {
    cluster,
    rpcUrl,
    rpcFallback: process.env.SOLANA_RPC_FALLBACK || `https://api.${cluster}.solana.com`,
    walletPath: process.env.WALLET_PATH || resolve(
      process.env.HOME || process.env.USERPROFILE || '~',
      '.config', 'solana', 'id.json'
    ),
    mode: (process.env.MAKORA_MODE as 'advisory' | 'auto') || 'advisory',
    logLevel: (process.env.MAKORA_LOG_LEVEL as MakoraConfig['logLevel']) || 'info',
  };
}
```

### Task 13: CLI Wallet Utilities

**File: `P:\solana-agent-hackathon\apps\cli\src\utils\wallet.ts`**

```typescript
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
```

### Task 14: CLI Display Utilities

**File: `P:\solana-agent-hackathon\apps\cli\src\utils\display.ts`**

```typescript
import chalk from 'chalk';
import Table from 'cli-table3';
import type { PortfolioState, TokenBalance } from '@makora/types';

// Makora brand colors
const BRAND = {
  primary: chalk.hex('#8b5cf6'),   // Electric purple
  secondary: chalk.hex('#a78bfa'), // Light purple
  accent: chalk.hex('#c4b5fd'),    // Very light purple
  success: chalk.hex('#10b981'),   // Green
  warning: chalk.hex('#f59e0b'),   // Amber
  error: chalk.hex('#ef4444'),     // Red
  muted: chalk.gray,
};

/**
 * Print the Makora banner/header.
 */
export function printBanner(): void {
  console.log('');
  console.log(BRAND.primary('  ╔══════════════════════════════════════╗'));
  console.log(BRAND.primary('  ║') + BRAND.secondary('     MAKORA - Adaptive DeFi Agent     ') + BRAND.primary('║'));
  console.log(BRAND.primary('  ║') + BRAND.muted('        Master of Adaptation          ') + BRAND.primary('║'));
  console.log(BRAND.primary('  ╚══════════════════════════════════════╝'));
  console.log('');
}

/**
 * Format a USD value with $ sign and 2 decimal places.
 */
export function formatUsd(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
}

/**
 * Format a token balance with appropriate decimal places.
 */
export function formatBalance(balance: number, decimals: number = 4): string {
  if (balance === 0) return '0';
  if (balance < 0.0001) return '<0.0001';
  return balance.toFixed(decimals);
}

/**
 * Print the portfolio status as a formatted table.
 */
export function printPortfolioStatus(portfolio: PortfolioState): void {
  // Header
  console.log(BRAND.primary('  Wallet: ') + chalk.white(portfolio.owner.toBase58()));
  console.log(BRAND.primary('  Total Value: ') + chalk.bold.white(formatUsd(portfolio.totalValueUsd)));
  console.log('');

  // Token balances table
  const table = new Table({
    head: [
      chalk.bold('Token'),
      chalk.bold('Balance'),
      chalk.bold('Price'),
      chalk.bold('Value'),
      chalk.bold('Allocation'),
    ],
    colWidths: [12, 18, 14, 14, 14],
    style: {
      head: [],
      border: ['gray'],
    },
  });

  for (const balance of portfolio.balances) {
    const allocationPct = portfolio.totalValueUsd > 0
      ? (balance.usdValue / portfolio.totalValueUsd) * 100
      : 0;

    const allocationBar = getAllocationBar(allocationPct);

    table.push([
      BRAND.secondary(balance.token.symbol),
      chalk.white(formatBalance(balance.uiBalance)),
      BRAND.muted(formatUsd(balance.priceUsd)),
      chalk.white(formatUsd(balance.usdValue)),
      `${allocationBar} ${allocationPct.toFixed(1)}%`,
    ]);
  }

  console.log(table.toString());
  console.log('');
  console.log(BRAND.muted(`  Last updated: ${new Date(portfolio.lastUpdated).toLocaleTimeString()}`));
}

/**
 * Create a visual allocation bar.
 */
function getAllocationBar(pct: number): string {
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  return BRAND.primary('█'.repeat(filled)) + BRAND.muted('░'.repeat(empty));
}

/**
 * Print an info message.
 */
export function printInfo(message: string): void {
  console.log(BRAND.secondary('  ℹ ') + message);
}

/**
 * Print a success message.
 */
export function printSuccess(message: string): void {
  console.log(BRAND.success('  ✓ ') + message);
}

/**
 * Print a warning message.
 */
export function printWarning(message: string): void {
  console.log(BRAND.warning('  ⚠ ') + message);
}

/**
 * Print an error message.
 */
export function printError(message: string): void {
  console.log(BRAND.error('  ✗ ') + message);
}
```

### Task 15: Status Command

The `makora status` command -- connects to devnet, reads wallet balances, fetches prices, and displays everything.

**File: `P:\solana-agent-hackathon\apps\cli\src\commands\status.ts`**

```typescript
import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { createConnection, getRpcDisplayUrl, PortfolioReader, type ConnectionConfig } from '@makora/data-feed';
import { loadConfig } from '../utils/config.js';
import { loadWalletFromFile } from '../utils/wallet.js';
import {
  printBanner,
  printPortfolioStatus,
  printInfo,
  printError,
  printSuccess,
  printWarning,
} from '../utils/display.js';

/**
 * Register the `makora status` command.
 *
 * Connects to Solana devnet (via Helius or public RPC),
 * reads the wallet's SOL and SPL token balances,
 * fetches USD prices from Jupiter Price API,
 * and displays a formatted portfolio view.
 */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show wallet balance, token holdings, and portfolio value')
    .option('--rpc <url>', 'Custom RPC endpoint URL')
    .option('--wallet <path>', 'Path to wallet keypair JSON file')
    .option('--cluster <cluster>', 'Solana cluster: devnet, mainnet-beta, localnet', 'devnet')
    .action(async (options) => {
      printBanner();

      const config = loadConfig();

      // Override config with CLI options
      if (options.rpc) config.rpcUrl = options.rpc;
      if (options.wallet) config.walletPath = options.wallet;
      if (options.cluster) config.cluster = options.cluster;

      // Load wallet
      const spinner = ora({ text: 'Loading wallet...', color: 'magenta' }).start();
      let wallet;
      try {
        wallet = loadWalletFromFile(config.walletPath);
        spinner.succeed(`Wallet loaded: ${wallet.publicKey.toBase58().slice(0, 8)}...${wallet.publicKey.toBase58().slice(-4)}`);
      } catch (err) {
        spinner.fail('Failed to load wallet');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      // Connect to Solana
      const connectionConfig: ConnectionConfig = {
        cluster: config.cluster,
        heliusApiKey: process.env.HELIUS_API_KEY,
        customRpcUrl: options.rpc,
      };

      const rpcDisplay = getRpcDisplayUrl(connectionConfig);
      const connectSpinner = ora({ text: `Connecting to ${config.cluster} (${rpcDisplay})...`, color: 'magenta' }).start();

      try {
        const connection = createConnection(connectionConfig);

        // Quick health check: get slot
        const slot = await connection.getSlot();
        connectSpinner.succeed(`Connected to ${config.cluster} (slot: ${slot})`);
      } catch (err) {
        connectSpinner.fail(`Failed to connect to ${config.cluster}`);
        printError(err instanceof Error ? err.message : String(err));

        // Try fallback
        if (config.rpcFallback) {
          printWarning(`Trying fallback RPC: ${config.rpcFallback}`);
          connectionConfig.customRpcUrl = config.rpcFallback;
        } else {
          process.exit(1);
        }
      }

      const connection = createConnection(connectionConfig);

      // Fetch portfolio
      const portfolioSpinner = ora({ text: 'Fetching portfolio data...', color: 'magenta' }).start();
      try {
        const reader = new PortfolioReader(connection, config.cluster);
        const portfolio = await reader.getPortfolio(wallet.publicKey);
        portfolioSpinner.succeed('Portfolio data loaded');

        console.log('');
        printPortfolioStatus(portfolio);

        // Network info
        console.log('');
        printInfo(`Network: ${chalk.white(config.cluster)}`);
        printInfo(`RPC: ${chalk.white(rpcDisplay)}`);
        printInfo(`Mode: ${chalk.white(config.mode)}`);

      } catch (err) {
        portfolioSpinner.fail('Failed to fetch portfolio');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}
```

### Task 16: CLI Entry Point

**File: `P:\solana-agent-hackathon\apps\cli\src\index.ts`**

```typescript
import { Command } from 'commander';
import { registerStatusCommand } from './commands/status.js';

const program = new Command();

program
  .name('makora')
  .description('Makora - The Adaptive DeFi Agent for Solana')
  .version('0.1.0');

// Register commands
registerStatusCommand(program);

// Parse and execute
program.parse();
```

### Task 17: Build All Packages

Run from the project root:

```bash
cd P:\solana-agent-hackathon
pnpm install
pnpm build
```

This should build in dependency order:
1. `@makora/types` (no deps)
2. `@makora/data-feed` (depends on types)
3. `@makora/adapters-jupiter` (depends on types)
4. `@makora/cli` (depends on types, data-feed, adapters-jupiter)

### Task 18: Test the CLI

After building, test the CLI:

```bash
# Link the CLI binary
cd apps/cli
pnpm link --global

# Or run directly
node apps/cli/dist/index.js status

# Or via pnpm
pnpm --filter @makora/cli start -- status
```

Expected output (with a funded devnet wallet):

```
  ╔══════════════════════════════════════╗
  ║     MAKORA - Adaptive DeFi Agent     ║
  ║        Master of Adaptation          ║
  ╚══════════════════════════════════════╝

  ✓ Wallet loaded: 8xK2...j4Fp
  ✓ Connected to devnet (slot: 312456789)
  ✓ Portfolio data loaded

  Wallet: 8xK2abcdef1234567890ghijklmnopqrstuvwxyzj4Fp
  Total Value: $245.30

  ┌────────────┬──────────────────┬──────────────┬──────────────┬──────────────┐
  │ Token      │ Balance          │ Price        │ Value        │ Allocation   │
  ├────────────┼──────────────────┼──────────────┼──────────────┼──────────────┤
  │ SOL        │ 1.5000           │ $145.20      │ $217.80      │ ████████░░ … │
  │ USDC       │ 27.5000          │ $1.00        │ $27.50       │ █░░░░░░░░░ … │
  └────────────┴──────────────────┴──────────────┴──────────────┴──────────────┘

  Last updated: 14:32:05

  ℹ Network: devnet
  ℹ RPC: https://devnet.helius-rpc.com/?api-key=***
  ℹ Mode: advisory
```

## Verification

1. **`pnpm build` compiles all packages** -- `packages/data-feed/dist/`, `packages/adapters/jupiter/dist/`, and `apps/cli/dist/` all contain compiled JavaScript and type declarations.
2. **`makora status` works** -- connects to devnet, prints wallet balances with USD values. If no Helius API key is set, falls back to public RPC.
3. **Jupiter adapter fetches quotes** -- calling `adapter.getQuote()` with SOL->USDC parameters returns a valid quote with expected output amount and route description.
4. **Jupiter adapter builds swap transactions** -- calling `adapter.getSwapTransaction()` returns a valid VersionedTransaction that can be signed and sent.
5. **Price feed works** -- `JupiterPriceFeed.getPrice()` returns a non-zero USD price for SOL.
6. **No TypeScript errors** -- `pnpm typecheck` passes for all three packages.

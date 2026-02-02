---
phase: 01-foundation
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - pnpm-workspace.yaml
  - turbo.json
  - tsconfig.json
  - tsconfig.base.json
  - .nvmrc
  - rust-toolchain.toml
  - .cargo/config.toml
  - Cargo.toml
  - Anchor.toml
  - .env.example
  - .gitignore
  - packages/types/package.json
  - packages/types/tsconfig.json
  - packages/types/src/index.ts
  - packages/types/src/common.ts
  - packages/types/src/protocols.ts
  - packages/types/src/agent.ts
  - packages/types/src/strategy.ts
  - packages/types/src/privacy.ts
  - packages/types/src/risk.ts
  - packages/types/src/vault.ts
autonomous: true
must_haves:
  truths:
    - "`pnpm install` completes without errors"
    - "`pnpm build` compiles the @makora/types package without errors"
    - "TypeScript strict mode is enabled across all packages"
    - "All toolchain versions are locked in their respective files"
    - "`anchor --version` reports 0.30.1"
    - "`solana --version` reports 1.18.17"
    - "`node --version` reports 20.x+"
  artifacts:
    - package.json
    - pnpm-workspace.yaml
    - turbo.json
    - tsconfig.json
    - tsconfig.base.json
    - .nvmrc
    - rust-toolchain.toml
    - Cargo.toml
    - Anchor.toml
    - packages/types/dist/index.js
    - packages/types/dist/index.d.ts
---

# Plan 01: Monorepo Scaffolding + Shared Types + Toolchain Lock

## Objective

Establish the monorepo infrastructure, lock all toolchain versions, define the shared TypeScript type system, and create the Anchor/Cargo workspace. After this plan completes, `pnpm build` compiles successfully and every other plan can build on top of this foundation.

## Context

- **Pattern reference**: P01 uses pnpm workspaces + Turborepo with a flat `packages/*` + `apps/*` layout. We follow the same pattern but add `packages/adapters/*` for protocol adapters.
- **TypeScript target**: ES2022 (upgrade from P01's ES2020) for top-level await support. Module resolution: NodeNext (for ESM compatibility with Solana SDKs).
- **Anchor/Rust**: Match P01 exactly -- Anchor 0.30.1, Solana 1.18.17, Rust 1.75, edition 2021.
- **Package prefix**: `@makora/` (not `@mahoraga/` -- the shorter name was chosen for the project).
- **Build tool for packages**: `tsup` (same as P01's zk-sdk) for dual CJS/ESM output with type declarations.
- **Naming convention**: Program names use snake_case (`makora_vault`), package names use kebab-case (`@makora/types`).

## Tasks

### Task 1: Root package.json

Create the root `package.json` with workspace scripts, devDependencies, and engine constraints.

**File: `P:\solana-agent-hackathon\package.json`**

```json
{
  "name": "makora",
  "version": "0.1.0",
  "private": true,
  "description": "Makora - The Adaptive DeFi Agent for Solana",
  "scripts": {
    "dev": "turbo run dev",
    "build": "turbo run build",
    "build:types": "turbo run build --filter=@makora/types",
    "build:packages": "turbo run build --filter='./packages/*'",
    "test": "turbo run test",
    "test:programs": "anchor test",
    "lint": "turbo run lint",
    "typecheck": "turbo run typecheck",
    "clean": "turbo run clean && rimraf node_modules",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md}\""
  },
  "devDependencies": {
    "@coral-xyz/anchor": "^0.30.1",
    "@solana/spl-token": "^0.4.14",
    "@solana/web3.js": "^1.98.4",
    "@types/node": "^20.11.0",
    "prettier": "^3.2.0",
    "rimraf": "^5.0.0",
    "tsup": "^8.0.1",
    "turbo": "^2.0.0",
    "typescript": "^5.3.0",
    "vitest": "^4.0.17"
  },
  "packageManager": "pnpm@8.15.0",
  "engines": {
    "node": ">=20"
  }
}
```

### Task 2: pnpm-workspace.yaml

Define workspace package locations. Include `packages/adapters/*` as a separate glob since adapters are nested one level deeper.

**File: `P:\solana-agent-hackathon\pnpm-workspace.yaml`**

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'packages/adapters/*'
```

### Task 3: turbo.json

Turborepo configuration. Uses the `tasks` key (Turbo v2 syntax, not the deprecated `pipeline` key).

**File: `P:\solana-agent-hackathon\turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

### Task 4: TypeScript Configuration

Create a shared base config and root config. Target ES2022 with NodeNext module resolution.

**File: `P:\solana-agent-hackathon\tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "isolatedModules": true
  }
}
```

**File: `P:\solana-agent-hackathon\tsconfig.json`**

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@makora/types": ["packages/types/src"],
      "@makora/data-feed": ["packages/data-feed/src"],
      "@makora/adapters-jupiter": ["packages/adapters/jupiter/src"],
      "@makora/agent-core": ["packages/agent-core/src"],
      "@makora/risk-manager": ["packages/risk-manager/src"],
      "@makora/execution-engine": ["packages/execution-engine/src"],
      "@makora/protocol-router": ["packages/protocol-router/src"],
      "@makora/privacy": ["packages/privacy/src"],
      "@makora/strategy-engine": ["packages/strategy-engine/src"]
    }
  },
  "exclude": ["node_modules", "dist", ".next", "target", "programs"]
}
```

### Task 5: Toolchain Lock Files

Lock Rust, Node.js, and Solana versions.

**File: `P:\solana-agent-hackathon\rust-toolchain.toml`**

```toml
[toolchain]
channel = "1.75.0"
components = ["rustfmt", "clippy"]
profile = "minimal"
```

**File: `P:\solana-agent-hackathon\.nvmrc`**

```
20
```

### Task 6: Cargo Workspace

Root Cargo.toml for the Rust workspace. Mirror P01's structure with overflow-checks and workspace dependencies.

**File: `P:\solana-agent-hackathon\Cargo.toml`**

```toml
[workspace]
members = [
    "programs/*"
]

resolver = "2"

[workspace.package]
rust-version = "1.75"

[profile.release]
overflow-checks = true
lto = "fat"
codegen-units = 1

[profile.release.build-override]
opt-level = 3
incremental = false
codegen-units = 1

[workspace.dependencies]
# Anchor dependencies pinned to 0.30.1 (compatible with Solana 1.18)
anchor-lang = "0.30.1"
anchor-spl = "0.30.1"

# Solana dependencies
solana-program = "1.18.17"
solana-sdk = "1.18.17"

# Serialization - borsh version compatible with Anchor 0.30.1
borsh = "1.5"

# Common utilities
thiserror = "1.0"
bytemuck = { version = "1.14", features = ["derive"] }

# ZK dependencies for shielded transactions (Phase 4)
# ark-bn254 = "0.4.0"
# ark-groth16 = "0.4.0"
# ark-serialize = "0.4.0"
# groth16-solana = "0.2.0"
# sha3 = "0.10"
```

**File: `P:\solana-agent-hackathon\.cargo\config.toml`**

```toml
[build]
# Use Solana's platform-tools for BPF compilation
# This is handled by `anchor build` but we set defaults for cargo check

[env]
# Ensure consistent builds
CARGO_INCREMENTAL = "0"

[net]
retry = 3
```

### Task 7: Anchor.toml

Anchor project configuration. Program IDs use placeholder keypairs (will be replaced after `anchor keys list`).

**File: `P:\solana-agent-hackathon\Anchor.toml`**

```toml
[toolchain]
anchor_version = "0.30.1"
solana_version = "1.18.17"

[features]
seeds = false
skip-lint = false

[programs.localnet]
makora_vault = "MKRvau1tPKsZY7B8fZQGpuvqbVwEML3RCrgBJ4sSXkP"

[programs.devnet]
makora_vault = "MKRvau1tPKsZY7B8fZQGpuvqbVwEML3RCrgBJ4sSXkP"

[registry]
url = "https://api.apr.dev"

[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"

[scripts]
test = "pnpm run test:programs"

[test]
startup_wait = 5000
shutdown_wait = 2000
```

> **Note**: The program ID `MKRvau1tPKsZY7B8fZQGpuvqbVwEML3RCrgBJ4sSXkP` is a placeholder. After the vault program keypair is generated in Plan 02, run `anchor keys list` and update this value.

### Task 8: Environment Configuration

**File: `P:\solana-agent-hackathon\.env.example`**

```bash
# Makora Environment Configuration

# Solana RPC (Helius - free tier: 1M credits/month, 10 RPS)
HELIUS_API_KEY=your_helius_api_key_here
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}
SOLANA_RPC_FALLBACK=https://api.devnet.solana.com

# Network: devnet | mainnet-beta | localnet
SOLANA_NETWORK=devnet

# Wallet path (default Solana CLI wallet)
WALLET_PATH=~/.config/solana/id.json

# Agent configuration
MAKORA_MODE=advisory
MAKORA_LOG_LEVEL=info
```

### Task 9: .gitignore

**File: `P:\solana-agent-hackathon\.gitignore`**

```
# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
.next/
target/
.anchor/

# Turbo
.turbo/

# Environment
.env
.env.local
.env.*.local

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Solana
test-ledger/
*.so

# ZK artifacts (large binary files)
circuits/build/*.wasm
circuits/build/*.zkey
circuits/build/*.ptau

# Logs
*.log
npm-debug.log*
```

### Task 10: @makora/types Package

The leaf package with zero internal dependencies. All shared TypeScript interfaces and types.

**File: `P:\solana-agent-hackathon\packages\types\package.json`**

```json
{
  "name": "@makora/types",
  "version": "0.1.0",
  "private": true,
  "description": "Shared TypeScript types for Makora",
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
    "typecheck": "tsc --noEmit",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "@solana/web3.js": "^1.98.4"
  },
  "devDependencies": {
    "tsup": "^8.0.1",
    "typescript": "^5.3.0",
    "rimraf": "^5.0.0"
  }
}
```

**File: `P:\solana-agent-hackathon\packages\types\tsconfig.json`**

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

**File: `P:\solana-agent-hackathon\packages\types\src\index.ts`**

```typescript
/**
 * @makora/types - Shared type definitions for the Makora DeFi Agent
 *
 * This is the leaf package in the dependency tree.
 * Every other @makora/* package depends on this one.
 */

export * from './common.js';
export * from './protocols.js';
export * from './agent.js';
export * from './strategy.js';
export * from './risk.js';
export * from './privacy.js';
export * from './vault.js';
```

**File: `P:\solana-agent-hackathon\packages\types\src\common.ts`**

```typescript
import type { PublicKey, TransactionInstruction, VersionedTransaction } from '@solana/web3.js';

// ============================================================================
// Core Primitives
// ============================================================================

/** Unique identifier for a protocol adapter */
export type ProtocolId = 'jupiter' | 'raydium' | 'marinade' | 'kamino' | 'privacy';

/** Action types the agent can perform */
export type ActionType = 'swap' | 'stake' | 'unstake' | 'deposit' | 'withdraw' | 'provide_liquidity' | 'remove_liquidity' | 'shield' | 'unshield' | 'transfer';

/** Agent operating mode */
export type AgentMode = 'advisory' | 'auto';

/** OODA cycle phase */
export type OODAPhase = 'observe' | 'orient' | 'decide' | 'act';

/** Network cluster */
export type SolanaCluster = 'devnet' | 'mainnet-beta' | 'localnet';

// ============================================================================
// Token Types
// ============================================================================

/** Known token mint addresses (devnet and mainnet) */
export interface TokenInfo {
  symbol: string;
  name: string;
  mint: PublicKey;
  decimals: number;
  logoUri?: string;
  coingeckoId?: string;
}

/** Token balance with USD value */
export interface TokenBalance {
  token: TokenInfo;
  /** Raw balance in smallest unit (lamports for SOL) */
  rawBalance: bigint;
  /** Human-readable balance (e.g., 1.5 SOL) */
  uiBalance: number;
  /** USD value at current market price */
  usdValue: number;
  /** Price per token in USD */
  priceUsd: number;
}

/** Token price from an oracle or API */
export interface TokenPrice {
  mint: PublicKey;
  symbol: string;
  priceUsd: number;
  /** Confidence interval (for Pyth) */
  confidence?: number;
  /** Unix timestamp in seconds */
  timestamp: number;
  /** Source of the price data */
  source: 'pyth' | 'jupiter' | 'birdeye' | 'manual';
}

// ============================================================================
// Portfolio Types
// ============================================================================

/** Full portfolio state for the agent */
export interface PortfolioState {
  /** Wallet public key */
  owner: PublicKey;
  /** All token balances with USD values */
  balances: TokenBalance[];
  /** Total portfolio value in USD */
  totalValueUsd: number;
  /** SOL balance (convenience, always present) */
  solBalance: number;
  /** Timestamp of last update */
  lastUpdated: number;
}

/** Portfolio allocation entry (percentage-based) */
export interface AllocationEntry {
  token: TokenInfo;
  /** Current allocation as percentage (0-100) */
  currentPct: number;
  /** Target allocation as percentage (0-100) */
  targetPct?: number;
  /** USD value of this position */
  usdValue: number;
}

// ============================================================================
// Transaction Types
// ============================================================================

/** Result of executing an action on-chain */
export interface ExecutionResult {
  success: boolean;
  /** Transaction signature (base58) */
  signature?: string;
  /** Error message if failed */
  error?: string;
  /** Slot of confirmation */
  slot?: number;
  /** Compute units consumed */
  computeUnits?: number;
  /** Timestamp of confirmation */
  timestamp?: number;
}

/** Transaction status for monitoring */
export interface TransactionStatus {
  signature: string;
  status: 'pending' | 'confirmed' | 'finalized' | 'failed';
  slot?: number;
  error?: string;
}

// ============================================================================
// Configuration
// ============================================================================

/** Makora global configuration */
export interface MakoraConfig {
  /** Solana cluster */
  cluster: SolanaCluster;
  /** Primary RPC endpoint */
  rpcUrl: string;
  /** Fallback RPC endpoint */
  rpcFallback?: string;
  /** Path to wallet keypair file */
  walletPath: string;
  /** Agent operating mode */
  mode: AgentMode;
  /** Log level */
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}
```

**File: `P:\solana-agent-hackathon\packages\types\src\protocols.ts`**

```typescript
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
```

**File: `P:\solana-agent-hackathon\packages\types\src\agent.ts`**

```typescript
import type { PublicKey } from '@solana/web3.js';
import type {
  ActionType,
  AgentMode,
  ExecutionResult,
  OODAPhase,
  PortfolioState,
  ProtocolId,
  TokenInfo,
} from './common.js';
import type { RiskAssessment } from './risk.js';

// ============================================================================
// Agent Action Types
// ============================================================================

/** A proposed action from the strategy engine (not yet validated) */
export interface ProposedAction {
  id: string;
  type: ActionType;
  protocol: ProtocolId;
  description: string;
  /** Why this action is being proposed */
  rationale: string;
  /** Expected outcome description */
  expectedOutcome: string;
  /** Input token */
  inputToken: TokenInfo;
  /** Output token (for swaps) */
  outputToken?: TokenInfo;
  /** Amount in smallest unit */
  amount: bigint;
  /** Maximum slippage in bps */
  maxSlippageBps: number;
  /** Expected USD value change */
  expectedValueChange: number;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Timestamp of proposal */
  timestamp: number;
}

/** An action that has passed risk validation */
export interface ValidatedAction extends ProposedAction {
  riskAssessment: RiskAssessment;
  /** Whether the risk manager approved this action */
  approved: boolean;
}

/** Result of an agent decision cycle */
export interface DecisionCycleResult {
  /** Current OODA phase */
  phase: OODAPhase;
  /** Actions proposed in this cycle */
  proposedActions: ProposedAction[];
  /** Actions approved by risk manager */
  approvedActions: ValidatedAction[];
  /** Actions rejected by risk manager */
  rejectedActions: ValidatedAction[];
  /** Execution results (only in auto mode) */
  executionResults?: ExecutionResult[];
  /** Duration of this cycle in ms */
  cycleTimeMs: number;
  /** Timestamp */
  timestamp: number;
}

// ============================================================================
// Market Data Types
// ============================================================================

/** Market conditions snapshot from the data feed */
export interface MarketData {
  /** SOL price in USD */
  solPriceUsd: number;
  /** 24h price change percentage */
  solChange24hPct: number;
  /** Market volatility indicator (0-100, higher = more volatile) */
  volatilityIndex: number;
  /** Total value locked across monitored protocols */
  totalTvlUsd: number;
  /** Timestamp */
  timestamp: number;
  /** Per-token prices */
  prices: Map<string, number>;
}

/** OHLCV candle data for charting */
export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

// ============================================================================
// Agent Event Types
// ============================================================================

/** Events emitted by the agent core */
export type AgentEvent =
  | { type: 'mode_changed'; mode: AgentMode }
  | { type: 'cycle_started'; phase: OODAPhase }
  | { type: 'cycle_completed'; result: DecisionCycleResult }
  | { type: 'action_proposed'; action: ProposedAction }
  | { type: 'action_approved'; action: ValidatedAction }
  | { type: 'action_rejected'; action: ValidatedAction; reason: string }
  | { type: 'action_executed'; action: ValidatedAction; result: ExecutionResult }
  | { type: 'error'; message: string; details?: unknown };

/** Handler for agent events */
export type AgentEventHandler = (event: AgentEvent) => void;
```

**File: `P:\solana-agent-hackathon\packages\types\src\strategy.ts`**

```typescript
import type { ProtocolId, ActionType, TokenInfo } from './common.js';
import type { ProposedAction, MarketData } from './agent.js';
import type { PortfolioState } from './common.js';

// ============================================================================
// Strategy Types
// ============================================================================

/** Strategy type classification */
export type StrategyType = 'yield' | 'trading' | 'rebalance' | 'liquidity';

/** Strategy signal from the strategy engine */
export interface StrategySignal {
  strategyId: string;
  strategyName: string;
  type: StrategyType;
  /** Confidence level 0-100 */
  confidence: number;
  /** Suggested actions */
  actions: ProposedAction[];
  /** Human-readable explanation */
  explanation: string;
  /** Expected annual yield (if applicable) */
  expectedApy?: number;
  /** Risk score 0-100 (higher = riskier) */
  riskScore: number;
}

/** Strategy definition */
export interface Strategy {
  id: string;
  name: string;
  type: StrategyType;
  description: string;
  /** Which protocols this strategy uses */
  protocols: ProtocolId[];
  /** Whether this strategy is currently active */
  isActive: boolean;
  /** Strategy-specific parameters */
  parameters: Record<string, number | string | boolean>;
}

/** Strategy evaluation context */
export interface StrategyContext {
  portfolio: PortfolioState;
  marketData: MarketData;
  /** Current timestamp */
  timestamp: number;
}

/** Yield opportunity across protocols */
export interface YieldOpportunity {
  protocol: ProtocolId;
  type: 'staking' | 'lending' | 'lp' | 'vault';
  token: TokenInfo;
  tokenB?: TokenInfo;
  apy: number;
  tvlUsd: number;
  riskScore: number;
  description: string;
}
```

**File: `P:\solana-agent-hackathon\packages\types\src\risk.ts`**

```typescript
// ============================================================================
// Risk Management Types
// ============================================================================

/** Risk parameter limits */
export interface RiskLimits {
  /** Maximum position size as percentage of portfolio (e.g., 50 = 50%) */
  maxPositionSizePct: number;
  /** Maximum slippage in basis points (e.g., 100 = 1%) */
  maxSlippageBps: number;
  /** Maximum daily loss as percentage of portfolio */
  maxDailyLossPct: number;
  /** Minimum SOL to keep for rent/gas (in SOL, not lamports) */
  minSolReserve: number;
  /** Maximum exposure to any single protocol (percentage) */
  maxProtocolExposurePct: number;
}

/** Default risk limits (conservative) */
export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPositionSizePct: 25,
  maxSlippageBps: 100,
  maxDailyLossPct: 5,
  minSolReserve: 0.05,
  maxProtocolExposurePct: 50,
};

/** Risk assessment for a proposed action */
export interface RiskAssessment {
  /** Whether the action passes risk checks */
  approved: boolean;
  /** Overall risk score 0-100 */
  riskScore: number;
  /** Individual check results */
  checks: RiskCheck[];
  /** Human-readable summary */
  summary: string;
}

/** Individual risk check result */
export interface RiskCheck {
  name: string;
  passed: boolean;
  /** Current value */
  value: number;
  /** Limit that was checked against */
  limit: number;
  message: string;
}

/** Circuit breaker state */
export interface CircuitBreakerState {
  isActive: boolean;
  activatedAt?: number;
  reason?: string;
  /** Cumulative daily loss in USD */
  dailyLossUsd: number;
  /** Number of failed transactions today */
  failedTxCount: number;
}
```

**File: `P:\solana-agent-hackathon\packages\types\src\privacy.ts`**

```typescript
import type { PublicKey } from '@solana/web3.js';

// ============================================================================
// Privacy Types (for Phase 4 - placeholders now, full implementation later)
// ============================================================================

/** Stealth meta-address (published publicly by recipient) */
export interface StealthMetaAddress {
  spendingPublicKey: Uint8Array;
  viewingPublicKey: Uint8Array;
}

/** One-time stealth address (derived by sender) */
export interface StealthAddress {
  address: PublicKey;
  ephemeralPublicKey: Uint8Array;
}

/** Shielded note (private UTXO) */
export interface ShieldedNote {
  amount: bigint;
  tokenMint: PublicKey;
  owner: Uint8Array;
  randomness: Uint8Array;
  commitment: Uint8Array;
}

/** Groth16 proof for shielded transfers */
export interface Groth16Proof {
  piA: [string, string];
  piB: [[string, string], [string, string]];
  piC: [string, string];
  publicInputs: string[];
}

/** Privacy mode for the agent */
export type PrivacyMode = 'off' | 'stealth_only' | 'full_shielded';
```

**File: `P:\solana-agent-hackathon\packages\types\src\vault.ts`**

```typescript
import type { PublicKey } from '@solana/web3.js';
import type { AgentMode } from './common.js';
import type { RiskLimits } from './risk.js';

// ============================================================================
// Vault Program Types (matches on-chain state)
// ============================================================================

/** On-chain vault account state */
export interface VaultAccount {
  /** Wallet owner */
  owner: PublicKey;
  /** Agent's signing authority */
  agentAuthority: PublicKey;
  /** Total SOL deposited (lamports) */
  totalDeposited: bigint;
  /** Total SOL withdrawn (lamports) */
  totalWithdrawn: bigint;
  /** Current agent mode */
  mode: AgentMode;
  /** Risk limits stored on-chain */
  riskLimits: RiskLimits;
  /** Unix timestamp of vault creation */
  createdAt: number;
  /** Unix timestamp of last action */
  lastActionAt: number;
  /** PDA bump seed */
  bump: number;
}

/** Vault deposit parameters */
export interface VaultDepositParams {
  amount: bigint;
}

/** Vault withdraw parameters */
export interface VaultWithdrawParams {
  amount: bigint;
}
```

### Task 11: Create Empty Directory Structure

Create the directory skeleton for all packages that will be populated by Plans 02 and 03. This ensures `pnpm install` can resolve workspace references.

Create these directories with minimal placeholder `package.json` files:

**Directories to create** (empty, with only package.json stubs):

```
packages/data-feed/
packages/adapters/jupiter/
packages/agent-core/
packages/risk-manager/
packages/execution-engine/
packages/protocol-router/
packages/privacy/
packages/strategy-engine/
apps/cli/
apps/dashboard/
programs/makora_vault/
tests/
```

For each package directory, create a minimal `package.json`:

```json
{
  "name": "@makora/<package-name>",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "types": "dist/index.d.ts"
}
```

These stubs allow pnpm to resolve the workspace graph. The actual implementation is added by subsequent plans.

### Task 12: Install Dependencies

Run from the project root:

```bash
cd P:\solana-agent-hackathon
pnpm install
```

Then build the types package:

```bash
pnpm build:types
```

Verify the build succeeded by checking `packages/types/dist/index.js` exists.

## Verification

1. **`pnpm install` succeeds** -- no resolution errors, no peer dependency warnings for workspace packages.
2. **`pnpm build:types` succeeds** -- produces `packages/types/dist/index.js`, `index.mjs`, and `index.d.ts`.
3. **Toolchain files exist**:
   - `rust-toolchain.toml` contains `channel = "1.75.0"`
   - `.nvmrc` contains `20`
   - `Cargo.toml` has `overflow-checks = true` and workspace dependencies for Anchor 0.30.1
   - `Anchor.toml` has `anchor_version = "0.30.1"` and `solana_version = "1.18.17"`
4. **TypeScript compiles** -- `npx tsc --noEmit -p packages/types/tsconfig.json` exits with code 0.
5. **Workspace graph** -- `pnpm ls --depth 0` shows all workspace packages.

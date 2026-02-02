---
phase: 02-core-defi
plan: 05
type: execute
wave: 1
depends_on: [01, 02, 03]
files_modified:
  - packages/protocol-router/package.json
  - packages/protocol-router/tsconfig.json
  - packages/protocol-router/src/index.ts
  - packages/protocol-router/src/router.ts
  - packages/protocol-router/src/registry.ts
  - packages/protocol-router/src/orchestrator.ts
  - packages/execution-engine/package.json
  - packages/execution-engine/tsconfig.json
  - packages/execution-engine/src/index.ts
  - packages/execution-engine/src/engine.ts
  - packages/execution-engine/src/transaction-builder.ts
  - packages/execution-engine/src/confirmation.ts
  - packages/execution-engine/src/types.ts
  - pnpm-workspace.yaml
autonomous: true
must_haves:
  truths:
    - "`pnpm build` compiles both @makora/protocol-router and @makora/execution-engine without errors"
    - "Protocol router dispatches a swap action to JupiterAdapter and a stake action to MarinadeAdapter without the caller knowing which adapter handles it"
    - "Protocol router rejects an unsupported action type with a clear error message"
    - "Orchestrator decomposes 'move 30% to yield' into [swap, stake, deposit] action sequence"
    - "Execution engine builds a VersionedTransaction with ComputeBudget instructions"
    - "Execution engine submits a transaction and returns confirmed status within 30 seconds"
    - "Execution engine handles retry logic for expired blockhash errors"
    - "Transaction builder sets explicit compute unit limit and priority fee"
  artifacts:
    - packages/protocol-router/dist/index.js
    - packages/execution-engine/dist/index.js
---

# Plan 05: Protocol Router + Execution Engine (DEFI-05, TX Building)

## Objective

Build two core infrastructure packages:
1. **Protocol Router** (`@makora/protocol-router`) -- routes `AgentAction` to the correct adapter based on action type and protocol, and orchestrates multi-step DeFi operations.
2. **Execution Engine** (`@makora/execution-engine`) -- builds versioned transactions with compute budgets, signs, submits, confirms, and retries.

After this plan completes:
- The protocol router dispatches swap to Jupiter and stake to Marinade transparently
- Multi-step operations (e.g., "move 30% to yield") are decomposed into ordered action sequences
- The execution engine builds, submits, and confirms transactions within 30 seconds

## Context

- **Architecture**: The protocol router sits between the agent core/strategy engine and the individual adapters. It is the ONLY component that knows about specific adapters. Agent core interacts with the router, never with adapters directly.
- **Execution flow**: Agent Core -> Risk Manager (VETO check, Plan 06) -> Protocol Router (dispatch) -> Adapter (build IX) -> Execution Engine (build TX, sign, send, confirm)
- **Risk Manager integration**: The execution engine MUST have a hook point for the risk manager to VETO transactions. In this plan, we add the interface but the actual risk validation comes in Plan 06. The engine will accept an optional `RiskValidator` that can approve/reject before sending.
- **Transaction building**: All transactions are VersionedTransaction with explicit ComputeUnitLimit and ComputeUnitPrice instructions. Jupiter transactions come pre-built as VersionedTransaction, so the engine must handle both instruction-based and pre-built transaction paths.
- **Retry logic**: If a transaction fails with a blockhash expiry, the engine retries with a fresh blockhash (max 3 retries).
- **Adapters available**: Jupiter (Phase 1), Marinade/Raydium/Kamino (Plan 04, parallel)

## Tasks

### Task 1: Protocol Router Package Setup

**File: `P:\solana-agent-hackathon\packages\protocol-router\package.json`**

```json
{
  "name": "@makora/protocol-router",
  "version": "0.1.0",
  "private": true,
  "description": "Protocol router for Makora - dispatches actions to the correct DeFi adapter",
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
    "@solana/web3.js": "^1.98.4"
  },
  "devDependencies": {
    "tsup": "^8.0.1",
    "typescript": "^5.3.0",
    "rimraf": "^5.0.0"
  }
}
```

**File: `P:\solana-agent-hackathon\packages\protocol-router\tsconfig.json`**

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

### Task 2: Adapter Registry

Manages the lifecycle and lookup of all protocol adapters.

**File: `P:\solana-agent-hackathon\packages\protocol-router\src\registry.ts`**

```typescript
import type {
  ProtocolAdapter,
  ProtocolId,
  ActionType,
  ProtocolHealth,
  ProtocolCapability,
  AdapterConfig,
} from '@makora/types';

/**
 * Adapter Registry
 *
 * Manages all registered protocol adapters. Provides lookup by protocol ID
 * and by capability/action type. Handles initialization of all adapters.
 */
export class AdapterRegistry {
  private adapters: Map<ProtocolId, ProtocolAdapter> = new Map();
  private initialized = false;

  /**
   * Register a protocol adapter.
   * Must be called before initialize().
   */
  register(adapter: ProtocolAdapter): void {
    if (this.initialized) {
      throw new Error(
        'Cannot register adapters after initialization. ' +
        'Register all adapters first, then call initialize().'
      );
    }

    if (this.adapters.has(adapter.protocolId)) {
      throw new Error(`Adapter already registered for protocol: ${adapter.protocolId}`);
    }

    this.adapters.set(adapter.protocolId, adapter);
  }

  /**
   * Initialize all registered adapters with the given config.
   */
  async initialize(config: AdapterConfig): Promise<void> {
    const results: Array<{ protocolId: ProtocolId; success: boolean; error?: string }> = [];

    for (const [protocolId, adapter] of this.adapters) {
      try {
        await adapter.initialize(config);
        results.push({ protocolId, success: true });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.push({ protocolId, success: false, error: errorMsg });
        console.warn(`Failed to initialize adapter ${protocolId}: ${errorMsg}`);
      }
    }

    this.initialized = true;

    // Log initialization summary
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    console.log(
      `AdapterRegistry initialized: ${succeeded} adapters ready, ${failed} failed`
    );

    if (failed > 0) {
      for (const result of results.filter((r) => !r.success)) {
        console.warn(`  - ${result.protocolId}: ${result.error}`);
      }
    }
  }

  /**
   * Get an adapter by protocol ID.
   * Throws if the adapter is not registered.
   */
  get(protocolId: ProtocolId): ProtocolAdapter {
    const adapter = this.adapters.get(protocolId);
    if (!adapter) {
      throw new Error(
        `No adapter registered for protocol: ${protocolId}. ` +
        `Available: ${this.getRegisteredProtocols().join(', ')}`
      );
    }
    return adapter;
  }

  /**
   * Find the best adapter for a given action type.
   *
   * Returns the first adapter that supports the action.
   * For actions supported by multiple adapters (e.g., swap),
   * returns them in registration order (Jupiter should be registered first for swaps).
   */
  findByAction(actionType: ActionType): ProtocolAdapter | undefined {
    for (const [, adapter] of this.adapters) {
      if (adapter.supportsAction(actionType)) {
        return adapter;
      }
    }
    return undefined;
  }

  /**
   * Find ALL adapters that support a given action type.
   */
  findAllByAction(actionType: ActionType): ProtocolAdapter[] {
    const result: ProtocolAdapter[] = [];
    for (const [, adapter] of this.adapters) {
      if (adapter.supportsAction(actionType)) {
        result.push(adapter);
      }
    }
    return result;
  }

  /**
   * Find adapters by capability.
   */
  findByCapability(capability: ProtocolCapability): ProtocolAdapter[] {
    const result: ProtocolAdapter[] = [];
    for (const [, adapter] of this.adapters) {
      if (adapter.getCapabilities().includes(capability)) {
        result.push(adapter);
      }
    }
    return result;
  }

  /**
   * Health check all registered adapters.
   */
  async healthCheckAll(): Promise<ProtocolHealth[]> {
    const results: ProtocolHealth[] = [];

    for (const [, adapter] of this.adapters) {
      try {
        const health = await adapter.healthCheck();
        results.push(health);
      } catch (err) {
        results.push({
          protocolId: adapter.protocolId,
          isHealthy: false,
          latencyMs: 0,
          lastChecked: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return results;
  }

  /**
   * Get list of all registered protocol IDs.
   */
  getRegisteredProtocols(): ProtocolId[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Get a summary of all registered adapters and their capabilities.
   */
  getSummary(): Array<{
    protocolId: ProtocolId;
    name: string;
    capabilities: ProtocolCapability[];
  }> {
    return Array.from(this.adapters.entries()).map(([id, adapter]) => ({
      protocolId: id,
      name: adapter.name,
      capabilities: adapter.getCapabilities(),
    }));
  }

  /**
   * Check if any adapter is registered.
   */
  get isEmpty(): boolean {
    return this.adapters.size === 0;
  }

  /**
   * Get the number of registered adapters.
   */
  get size(): number {
    return this.adapters.size;
  }
}
```

### Task 3: Protocol Router

The core router that dispatches actions to the correct adapter.

**File: `P:\solana-agent-hackathon\packages\protocol-router\src\router.ts`**

```typescript
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type {
  ProtocolAdapter,
  ProtocolId,
  ActionType,
  Quote,
  QuoteParams,
  SwapParams,
  StakeParams,
  DepositParams,
  WithdrawParams,
  Position,
  ProtocolHealth,
  AdapterConfig,
} from '@makora/types';
import { AdapterRegistry } from './registry.js';

/** Action routing request -- what the agent core sends to the router */
export interface RouteRequest {
  /** Action type to perform */
  actionType: ActionType;
  /** Target protocol (optional -- if not specified, router finds the best one) */
  protocol?: ProtocolId;
  /** Action parameters (type depends on actionType) */
  params: SwapParams | StakeParams | DepositParams | WithdrawParams;
}

/** Route result -- instructions ready for the execution engine */
export interface RouteResult {
  /** Protocol that handled the request */
  protocolId: ProtocolId;
  /** Protocol adapter name */
  protocolName: string;
  /** Built transaction instructions */
  instructions: TransactionInstruction[];
  /** Quote data (if applicable) */
  quote?: Quote;
  /** Action description for logging/display */
  description: string;
}

/**
 * Protocol Router
 *
 * Routes agent actions to the correct protocol adapter. This is the ONLY component
 * that knows about specific adapter implementations. The agent core interacts
 * exclusively through the router.
 *
 * Routing rules:
 * 1. If `protocol` is specified in the request, use that adapter directly
 * 2. If not specified, find the best adapter by action type
 * 3. For swaps: always use Jupiter (it aggregates all DEXes)
 * 4. For stakes: use Marinade
 * 5. For LP: use Raydium
 * 6. For vault deposits: use Kamino
 */
export class ProtocolRouter {
  private registry: AdapterRegistry;

  constructor(registry: AdapterRegistry) {
    this.registry = registry;
  }

  /**
   * Route an action to the appropriate adapter and build instructions.
   *
   * This is the main entry point for the agent core.
   */
  async route(request: RouteRequest): Promise<RouteResult> {
    const adapter = this.resolveAdapter(request.actionType, request.protocol);

    // Build instructions based on action type
    const instructions = await this.buildInstructions(adapter, request);

    // Get a quote if the adapter supports it for this action
    let quote: Quote | undefined;
    if (request.actionType === 'swap' || request.actionType === 'stake') {
      try {
        quote = await this.getQuoteForAction(adapter, request);
      } catch {
        // Quote is optional -- don't fail the route if quote fails
      }
    }

    return {
      protocolId: adapter.protocolId,
      protocolName: adapter.name,
      instructions,
      quote,
      description: this.describeAction(adapter, request),
    };
  }

  /**
   * Get a quote without building instructions.
   * Useful for advisory mode where the agent shows quotes before execution.
   */
  async getQuote(
    actionType: ActionType,
    protocol: ProtocolId | undefined,
    quoteParams: QuoteParams
  ): Promise<Quote> {
    const adapter = this.resolveAdapter(actionType, protocol);
    return adapter.getQuote(quoteParams);
  }

  /**
   * Get all positions across all registered protocols for a wallet.
   */
  async getAllPositions(owner: PublicKey): Promise<Position[]> {
    const allPositions: Position[] = [];

    for (const protocolId of this.registry.getRegisteredProtocols()) {
      try {
        const adapter = this.registry.get(protocolId);
        const positions = await adapter.getPositions(owner);
        allPositions.push(...positions);
      } catch (err) {
        console.warn(`Failed to get positions from ${protocolId}:`, err);
      }
    }

    return allPositions;
  }

  /**
   * Health check all protocols.
   */
  async healthCheckAll(): Promise<ProtocolHealth[]> {
    return this.registry.healthCheckAll();
  }

  /**
   * Get the adapter registry (for advanced use cases).
   */
  getRegistry(): AdapterRegistry {
    return this.registry;
  }

  // ---- Private helpers ----

  /**
   * Resolve the correct adapter for an action.
   * If a specific protocol is requested, use that. Otherwise, find by action type.
   */
  private resolveAdapter(actionType: ActionType, protocol?: ProtocolId): ProtocolAdapter {
    if (protocol) {
      const adapter = this.registry.get(protocol);
      if (!adapter.supportsAction(actionType)) {
        throw new Error(
          `Protocol ${protocol} (${adapter.name}) does not support action: ${actionType}. ` +
          `Supported actions: ${this.getAdapterActionTypes(adapter).join(', ')}`
        );
      }
      return adapter;
    }

    // Auto-resolve: find the best adapter for this action type
    const adapter = this.registry.findByAction(actionType);
    if (!adapter) {
      throw new Error(
        `No adapter found that supports action: ${actionType}. ` +
        `Registered protocols: ${this.registry.getRegisteredProtocols().join(', ')}`
      );
    }

    return adapter;
  }

  /**
   * Build instructions based on action type.
   */
  private async buildInstructions(
    adapter: ProtocolAdapter,
    request: RouteRequest
  ): Promise<TransactionInstruction[]> {
    switch (request.actionType) {
      case 'swap':
        return adapter.buildSwapIx(request.params as SwapParams);

      case 'stake':
        if (!adapter.buildStakeIx) {
          throw new Error(`${adapter.name} does not implement buildStakeIx`);
        }
        return adapter.buildStakeIx(request.params as StakeParams);

      case 'unstake':
        if (!adapter.buildUnstakeIx) {
          throw new Error(`${adapter.name} does not implement buildUnstakeIx`);
        }
        return adapter.buildUnstakeIx(request.params as StakeParams);

      case 'deposit':
      case 'provide_liquidity':
        if (!adapter.buildDepositIx) {
          throw new Error(`${adapter.name} does not implement buildDepositIx`);
        }
        return adapter.buildDepositIx(request.params as DepositParams);

      case 'withdraw':
      case 'remove_liquidity':
        if (!adapter.buildWithdrawIx) {
          throw new Error(`${adapter.name} does not implement buildWithdrawIx`);
        }
        return adapter.buildWithdrawIx(request.params as WithdrawParams);

      default:
        throw new Error(`Unsupported action type: ${request.actionType}`);
    }
  }

  /**
   * Get a quote for a given action request.
   */
  private async getQuoteForAction(
    adapter: ProtocolAdapter,
    request: RouteRequest
  ): Promise<Quote> {
    const params = request.params;

    // Build QuoteParams from the action params
    if ('inputToken' in params && 'outputToken' in params) {
      return adapter.getQuote({
        inputToken: params.inputToken as PublicKey,
        outputToken: params.outputToken as PublicKey,
        amount: params.amount,
        maxSlippageBps: 'maxSlippageBps' in params ? (params as SwapParams).maxSlippageBps : 50,
      });
    }

    throw new Error('Cannot create quote params from this action type');
  }

  /**
   * Generate a human-readable description of an action.
   */
  private describeAction(adapter: ProtocolAdapter, request: RouteRequest): string {
    const params = request.params;

    switch (request.actionType) {
      case 'swap':
        return `Swap via ${adapter.name}`;
      case 'stake':
        return `Stake SOL via ${adapter.name}`;
      case 'unstake':
        return `Unstake via ${adapter.name}`;
      case 'deposit':
        return `Deposit into ${adapter.name}`;
      case 'withdraw':
        return `Withdraw from ${adapter.name}`;
      case 'provide_liquidity':
        return `Provide liquidity via ${adapter.name}`;
      case 'remove_liquidity':
        return `Remove liquidity via ${adapter.name}`;
      default:
        return `${request.actionType} via ${adapter.name}`;
    }
  }

  /**
   * Get all action types an adapter supports.
   */
  private getAdapterActionTypes(adapter: ProtocolAdapter): ActionType[] {
    const types: ActionType[] = [];
    const allTypes: ActionType[] = [
      'swap', 'stake', 'unstake', 'deposit', 'withdraw',
      'provide_liquidity', 'remove_liquidity', 'shield', 'unshield', 'transfer',
    ];

    for (const type of allTypes) {
      if (adapter.supportsAction(type)) {
        types.push(type);
      }
    }

    return types;
  }
}
```

### Task 4: Multi-Step Orchestrator

Decomposes high-level DeFi intents into ordered sequences of atomic actions.

**File: `P:\solana-agent-hackathon\packages\protocol-router\src\orchestrator.ts`**

```typescript
import { PublicKey } from '@solana/web3.js';
import type {
  ActionType,
  ProtocolId,
  PortfolioState,
  TokenInfo,
} from '@makora/types';
import type { RouteRequest } from './router.js';

/** High-level DeFi intent that may require multiple steps */
export interface DeFiIntent {
  /** What the user wants to achieve */
  type: 'move_to_yield' | 'rebalance' | 'exit_all' | 'compound' | 'custom';
  /** Amount in smallest units (optional, for percentage-based intents) */
  amount?: bigint;
  /** Percentage of portfolio (alternative to amount) */
  percentOfPortfolio?: number;
  /** Target tokens/protocols */
  targetProtocol?: ProtocolId;
  /** Source token */
  fromToken?: TokenInfo;
  /** Destination token */
  toToken?: TokenInfo;
}

/** An ordered step in a multi-step operation */
export interface OrchestrationStep {
  /** Step index (execution order) */
  index: number;
  /** Action to perform */
  actionType: ActionType;
  /** Target protocol */
  protocol: ProtocolId;
  /** Human-readable description */
  description: string;
  /** Parameters to pass to the router */
  routeRequest: RouteRequest;
  /** Whether this step depends on the previous step's output */
  dependsOnPrevious: boolean;
}

/** Result of orchestration planning */
export interface OrchestrationPlan {
  /** Original intent */
  intent: DeFiIntent;
  /** Ordered steps to execute */
  steps: OrchestrationStep[];
  /** Total number of transactions */
  transactionCount: number;
  /** Human-readable summary */
  summary: string;
  /** Estimated total time in ms */
  estimatedTimeMs: number;
}

/**
 * Multi-Step DeFi Orchestrator
 *
 * Decomposes high-level DeFi intents into ordered sequences of atomic actions.
 * For example:
 *   "Move 30% of portfolio to yield" ->
 *     1. Swap USDC -> SOL (if needed)
 *     2. Stake SOL -> mSOL (Marinade)
 *     3. Deposit mSOL into Kamino vault
 *
 * The orchestrator plans the sequence; the protocol router executes each step.
 *
 * DEFI-05: Multi-step DeFi orchestration
 */
export class DeFiOrchestrator {
  /**
   * Plan a multi-step operation from a high-level intent.
   *
   * @param intent - What the user wants to achieve
   * @param portfolio - Current portfolio state (for calculating amounts)
   * @param walletPublicKey - User's wallet
   * @returns Ordered plan of steps to execute
   */
  planExecution(
    intent: DeFiIntent,
    portfolio: PortfolioState,
    walletPublicKey: PublicKey
  ): OrchestrationPlan {
    switch (intent.type) {
      case 'move_to_yield':
        return this.planMoveToYield(intent, portfolio, walletPublicKey);
      case 'rebalance':
        return this.planRebalance(intent, portfolio, walletPublicKey);
      case 'exit_all':
        return this.planExitAll(intent, portfolio, walletPublicKey);
      case 'compound':
        return this.planCompound(intent, portfolio, walletPublicKey);
      default:
        throw new Error(`Unknown intent type: ${intent.type}`);
    }
  }

  /**
   * Plan: Move X% of portfolio to yield.
   *
   * Strategy:
   * 1. Calculate target amount from portfolio percentage
   * 2. If SOL available: stake SOL -> mSOL via Marinade
   * 3. If non-SOL tokens need converting: swap to SOL first, then stake
   */
  private planMoveToYield(
    intent: DeFiIntent,
    portfolio: PortfolioState,
    walletPublicKey: PublicKey
  ): OrchestrationPlan {
    const steps: OrchestrationStep[] = [];
    let stepIndex = 0;

    // Calculate target amount
    const pct = intent.percentOfPortfolio ?? 30;
    const targetUsd = portfolio.totalValueUsd * (pct / 100);

    // Find available SOL
    const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');
    const solValueUsd = solBalance?.usdValue ?? 0;
    const solLamports = solBalance?.rawBalance ?? 0n;

    // Find USDC balance (if we need to swap)
    const usdcBalance = portfolio.balances.find((b) => b.token.symbol === 'USDC');
    const usdcValueUsd = usdcBalance?.usdValue ?? 0;

    // Keep minimum SOL reserve (0.05 SOL for rent/gas)
    const minReserveLamports = 50_000_000n; // 0.05 SOL

    if (solValueUsd >= targetUsd) {
      // Case 1: Enough SOL -- just stake it
      const stakeAmountLamports = this.calculateLamportsFromUsd(
        targetUsd,
        solBalance!.priceUsd,
        9
      );
      const safeAmount = stakeAmountLamports > solLamports - minReserveLamports
        ? solLamports - minReserveLamports
        : stakeAmountLamports;

      steps.push({
        index: stepIndex++,
        actionType: 'stake',
        protocol: 'marinade',
        description: `Stake ${this.formatLamports(safeAmount, 9)} SOL via Marinade for mSOL yield`,
        routeRequest: {
          actionType: 'stake',
          protocol: 'marinade',
          params: {
            amount: safeAmount,
            userPublicKey: walletPublicKey,
          },
        },
        dependsOnPrevious: false,
      });
    } else if (solValueUsd + usdcValueUsd >= targetUsd) {
      // Case 2: Need to swap some USDC to SOL first, then stake all
      const neededFromUsdc = targetUsd - solValueUsd;
      const usdcToSwap = this.calculateLamportsFromUsd(
        neededFromUsdc,
        usdcBalance!.priceUsd,
        6 // USDC has 6 decimals
      );

      // Step 1: Swap USDC -> SOL
      steps.push({
        index: stepIndex++,
        actionType: 'swap',
        protocol: 'jupiter',
        description: `Swap ${this.formatLamports(usdcToSwap, 6)} USDC to SOL via Jupiter`,
        routeRequest: {
          actionType: 'swap',
          protocol: 'jupiter',
          params: {
            inputToken: usdcBalance!.token.mint,
            outputToken: solBalance!.token.mint,
            amount: usdcToSwap,
            maxSlippageBps: 50,
            userPublicKey: walletPublicKey,
          },
        },
        dependsOnPrevious: false,
      });

      // Step 2: Stake all available SOL -> mSOL
      const stakeAmountLamports = solLamports > minReserveLamports
        ? solLamports - minReserveLamports
        : 0n;

      if (stakeAmountLamports > 0n) {
        steps.push({
          index: stepIndex++,
          actionType: 'stake',
          protocol: 'marinade',
          description: `Stake SOL via Marinade for mSOL yield`,
          routeRequest: {
            actionType: 'stake',
            protocol: 'marinade',
            params: {
              amount: stakeAmountLamports,
              userPublicKey: walletPublicKey,
            },
          },
          dependsOnPrevious: true, // Need the SOL from swap first
        });
      }
    } else {
      // Case 3: Not enough liquid assets for the target amount
      // Stake whatever SOL is available
      const availableLamports = solLamports > minReserveLamports
        ? solLamports - minReserveLamports
        : 0n;

      if (availableLamports > 0n) {
        steps.push({
          index: stepIndex++,
          actionType: 'stake',
          protocol: 'marinade',
          description: `Stake ${this.formatLamports(availableLamports, 9)} SOL via Marinade (partial -- not enough for full ${pct}%)`,
          routeRequest: {
            actionType: 'stake',
            protocol: 'marinade',
            params: {
              amount: availableLamports,
              userPublicKey: walletPublicKey,
            },
          },
          dependsOnPrevious: false,
        });
      }
    }

    return {
      intent,
      steps,
      transactionCount: steps.length,
      summary: `Move ${pct}% of portfolio to yield: ${steps.map((s) => s.description).join(' -> ')}`,
      estimatedTimeMs: steps.length * 15_000, // ~15s per transaction
    };
  }

  /**
   * Plan: Rebalance portfolio to target allocation.
   */
  private planRebalance(
    intent: DeFiIntent,
    portfolio: PortfolioState,
    walletPublicKey: PublicKey
  ): OrchestrationPlan {
    // Simplified rebalance: if over-allocated in one token, swap excess to SOL
    const steps: OrchestrationStep[] = [];
    let stepIndex = 0;

    // For now, a basic rebalance just ensures no single token is > 50% of portfolio
    for (const balance of portfolio.balances) {
      if (balance.token.symbol === 'SOL') continue; // SOL is the base, skip

      const allocationPct = (balance.usdValue / portfolio.totalValueUsd) * 100;

      if (allocationPct > 50) {
        // Over-allocated: swap excess to SOL
        const excessPct = allocationPct - 50;
        const excessAmount = BigInt(
          Math.floor(Number(balance.rawBalance) * (excessPct / allocationPct))
        );

        const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');
        if (!solBalance) continue;

        steps.push({
          index: stepIndex++,
          actionType: 'swap',
          protocol: 'jupiter',
          description: `Rebalance: swap excess ${balance.token.symbol} to SOL`,
          routeRequest: {
            actionType: 'swap',
            protocol: 'jupiter',
            params: {
              inputToken: balance.token.mint,
              outputToken: solBalance.token.mint,
              amount: excessAmount,
              maxSlippageBps: 50,
              userPublicKey: walletPublicKey,
            },
          },
          dependsOnPrevious: false,
        });
      }
    }

    return {
      intent,
      steps,
      transactionCount: steps.length,
      summary: steps.length > 0
        ? `Rebalance: ${steps.length} swap(s) to normalize allocation`
        : 'Portfolio is already balanced -- no action needed',
      estimatedTimeMs: steps.length * 15_000,
    };
  }

  /**
   * Plan: Exit all DeFi positions to SOL/USDC.
   */
  private planExitAll(
    intent: DeFiIntent,
    portfolio: PortfolioState,
    walletPublicKey: PublicKey
  ): OrchestrationPlan {
    const steps: OrchestrationStep[] = [];
    let stepIndex = 0;

    // Unstake mSOL if any
    const msolBalance = portfolio.balances.find((b) => b.token.symbol === 'mSOL');
    if (msolBalance && msolBalance.rawBalance > 0n) {
      const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');
      steps.push({
        index: stepIndex++,
        actionType: 'unstake',
        protocol: 'marinade',
        description: `Unstake ${this.formatLamports(msolBalance.rawBalance, 9)} mSOL via Marinade`,
        routeRequest: {
          actionType: 'unstake',
          protocol: 'marinade',
          params: {
            amount: msolBalance.rawBalance,
            userPublicKey: walletPublicKey,
          },
        },
        dependsOnPrevious: false,
      });
    }

    // Swap any non-SOL/non-USDC tokens to SOL
    for (const balance of portfolio.balances) {
      if (balance.token.symbol === 'SOL' || balance.token.symbol === 'USDC') continue;
      if (balance.token.symbol === 'mSOL') continue; // Handled above
      if (balance.rawBalance === 0n) continue;

      const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');
      if (!solBalance) continue;

      steps.push({
        index: stepIndex++,
        actionType: 'swap',
        protocol: 'jupiter',
        description: `Exit: swap ${balance.token.symbol} to SOL`,
        routeRequest: {
          actionType: 'swap',
          protocol: 'jupiter',
          params: {
            inputToken: balance.token.mint,
            outputToken: solBalance.token.mint,
            amount: balance.rawBalance,
            maxSlippageBps: 100,
            userPublicKey: walletPublicKey,
          },
        },
        dependsOnPrevious: stepIndex > 1, // After unstake completes
      });
    }

    return {
      intent,
      steps,
      transactionCount: steps.length,
      summary: steps.length > 0
        ? `Exit all positions: ${steps.length} transaction(s)`
        : 'No DeFi positions to exit',
      estimatedTimeMs: steps.length * 15_000,
    };
  }

  /**
   * Plan: Compound staking rewards.
   */
  private planCompound(
    intent: DeFiIntent,
    portfolio: PortfolioState,
    walletPublicKey: PublicKey
  ): OrchestrationPlan {
    // mSOL compounds automatically (price appreciation) so this is a no-op for Marinade
    // For other protocols, this would harvest rewards and re-deposit

    return {
      intent,
      steps: [],
      transactionCount: 0,
      summary: 'Marinade mSOL compounds automatically via price appreciation. No action needed.',
      estimatedTimeMs: 0,
    };
  }

  // ---- Utility helpers ----

  private calculateLamportsFromUsd(
    targetUsd: number,
    pricePerToken: number,
    decimals: number
  ): bigint {
    if (pricePerToken === 0) return 0n;
    const tokenAmount = targetUsd / pricePerToken;
    return BigInt(Math.floor(tokenAmount * 10 ** decimals));
  }

  private formatLamports(lamports: bigint, decimals: number): string {
    const value = Number(lamports) / 10 ** decimals;
    return value.toFixed(4);
  }
}
```

### Task 5: Protocol Router Package Index

**File: `P:\solana-agent-hackathon\packages\protocol-router\src\index.ts`**

```typescript
/**
 * @makora/protocol-router - Routes agent actions to the correct DeFi adapter
 *
 * The router is the ONLY component that knows about specific adapter implementations.
 * Agent core interacts exclusively through the router.
 *
 * Components:
 * - AdapterRegistry: manages adapter lifecycle and lookup
 * - ProtocolRouter: dispatches actions to adapters
 * - DeFiOrchestrator: decomposes multi-step intents into atomic actions
 */

export { AdapterRegistry } from './registry.js';
export { ProtocolRouter, type RouteRequest, type RouteResult } from './router.js';
export {
  DeFiOrchestrator,
  type DeFiIntent,
  type OrchestrationStep,
  type OrchestrationPlan,
} from './orchestrator.js';
```

### Task 6: Execution Engine Package Setup

**File: `P:\solana-agent-hackathon\packages\execution-engine\package.json`**

```json
{
  "name": "@makora/execution-engine",
  "version": "0.1.0",
  "private": true,
  "description": "Transaction execution engine for Makora - builds, signs, submits, and confirms Solana transactions",
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
    "@solana/web3.js": "^1.98.4"
  },
  "devDependencies": {
    "tsup": "^8.0.1",
    "typescript": "^5.3.0",
    "rimraf": "^5.0.0"
  }
}
```

**File: `P:\solana-agent-hackathon\packages\execution-engine\tsconfig.json`**

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

### Task 7: Execution Engine Types

Internal types specific to the execution engine.

**File: `P:\solana-agent-hackathon\packages\execution-engine\src\types.ts`**

```typescript
import type { TransactionInstruction, VersionedTransaction, Keypair } from '@solana/web3.js';
import type { ExecutionResult, RiskAssessment, ProposedAction } from '@makora/types';

/** Configuration for the execution engine */
export interface ExecutionConfig {
  /** Maximum compute units per transaction */
  maxComputeUnits: number;
  /** Priority fee in microlamports per compute unit */
  priorityFeeMicroLamports: number;
  /** Maximum retries for failed transactions */
  maxRetries: number;
  /** Timeout for transaction confirmation in ms */
  confirmationTimeoutMs: number;
  /** Whether to simulate before sending */
  simulateBeforeSend: boolean;
  /** Whether to skip preflight checks (faster but riskier) */
  skipPreflight: boolean;
}

/** Default execution configuration */
export const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  maxComputeUnits: 400_000,
  priorityFeeMicroLamports: 50_000, // 0.05 lamports per CU
  maxRetries: 3,
  confirmationTimeoutMs: 30_000,
  simulateBeforeSend: true,
  skipPreflight: false,
};

/** What the execution engine receives to process */
export interface ExecutionRequest {
  /** Transaction instructions to execute */
  instructions: TransactionInstruction[];
  /** Or a pre-built versioned transaction (e.g., from Jupiter) */
  preBuiltTransaction?: VersionedTransaction;
  /** Signing keypair */
  signer: Keypair;
  /** Human-readable description for logging */
  description: string;
  /** Associated action (for audit trail) */
  action?: ProposedAction;
  /** Override compute units for this specific transaction */
  computeUnits?: number;
  /** Override priority fee for this specific transaction */
  priorityFeeMicroLamports?: number;
}

/**
 * Risk validator interface -- the hook point for the risk manager.
 * The execution engine calls this BEFORE sending any transaction.
 * If the validator rejects, the transaction is NOT sent.
 *
 * This interface is defined here; the actual implementation is in @makora/risk-manager (Plan 06).
 */
export interface RiskValidator {
  /**
   * Validate a proposed action before execution.
   * Returns a RiskAssessment. If approved is false, the execution engine
   * MUST NOT send the transaction.
   */
  validate(action: ProposedAction): Promise<RiskAssessment>;
}

/** Transaction execution state for monitoring */
export type ExecutionState =
  | { phase: 'building'; description: string }
  | { phase: 'simulating'; description: string }
  | { phase: 'risk_check'; description: string }
  | { phase: 'sending'; description: string; attempt: number }
  | { phase: 'confirming'; description: string; signature: string }
  | { phase: 'confirmed'; result: ExecutionResult }
  | { phase: 'failed'; error: string; retriesLeft: number }
  | { phase: 'vetoed'; reason: string };

/** Callback for execution state changes */
export type ExecutionStateCallback = (state: ExecutionState) => void;
```

### Task 8: Transaction Builder

Builds VersionedTransactions with ComputeBudget instructions.

**File: `P:\solana-agent-hackathon\packages\execution-engine\src\transaction-builder.ts`**

```typescript
import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  type Commitment,
} from '@solana/web3.js';
import type { ExecutionConfig } from './types.js';

/**
 * Transaction Builder
 *
 * Constructs VersionedTransactions with proper compute budget instructions.
 * Every transaction includes:
 * 1. SetComputeUnitLimit -- explicit CU budget (prevents default 200k limit)
 * 2. SetComputeUnitPrice -- priority fee for faster inclusion
 * 3. User instructions
 */
export class TransactionBuilder {
  private connection: Connection;
  private config: ExecutionConfig;

  constructor(connection: Connection, config: ExecutionConfig) {
    this.connection = connection;
    this.config = config;
  }

  /**
   * Build a VersionedTransaction from instructions.
   *
   * Adds ComputeBudget instructions at the beginning, fetches a fresh blockhash,
   * and creates a v0 message (supports address lookup tables in the future).
   *
   * @param instructions - User instructions (from protocol adapters)
   * @param payer - Transaction fee payer
   * @param computeUnits - Override compute unit limit (optional)
   * @param priorityFee - Override priority fee in microlamports (optional)
   */
  async build(
    instructions: TransactionInstruction[],
    payer: PublicKey,
    computeUnits?: number,
    priorityFee?: number
  ): Promise<{
    transaction: VersionedTransaction;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const cuLimit = computeUnits ?? this.config.maxComputeUnits;
    const cuPrice = priorityFee ?? this.config.priorityFeeMicroLamports;

    // Build compute budget instructions
    const computeInstructions: TransactionInstruction[] = [
      ComputeBudgetProgram.setComputeUnitLimit({
        units: cuLimit,
      }),
      ComputeBudgetProgram.setComputeUnitPrice({
        microLamports: cuPrice,
      }),
    ];

    // Combine: compute budget first, then user instructions
    const allInstructions = [...computeInstructions, ...instructions];

    // Fetch fresh blockhash
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');

    // Create v0 message
    const messageV0 = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: blockhash,
      instructions: allInstructions,
    }).compileToV0Message();

    const transaction = new VersionedTransaction(messageV0);

    return {
      transaction,
      blockhash,
      lastValidBlockHeight,
    };
  }

  /**
   * Rebuild a pre-built VersionedTransaction with a fresh blockhash.
   *
   * Used for retries when the original blockhash has expired.
   * NOTE: This only works for transactions where we have the original instructions.
   * For Jupiter's pre-built transactions, we must re-fetch from Jupiter.
   */
  async refreshBlockhash(
    transaction: VersionedTransaction
  ): Promise<{
    transaction: VersionedTransaction;
    blockhash: string;
    lastValidBlockHeight: number;
  }> {
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('confirmed');

    // Create a new transaction with the same message but fresh blockhash
    // VersionedTransaction messages are immutable, so we need to reconstruct
    const message = transaction.message;

    // For V0 messages, we can update the blockhash directly on the compiled message
    // by modifying the recentBlockhash field
    const newMessage = new TransactionMessage({
      payerKey: message.staticAccountKeys[0],
      recentBlockhash: blockhash,
      instructions: message.compiledInstructions.map((ix) => {
        const programId = message.staticAccountKeys[ix.programIdIndex];
        const keys = ix.accountKeyIndexes.map((idx) => ({
          pubkey: message.staticAccountKeys[idx] ?? PublicKey.default,
          isSigner: message.isAccountSigner(idx),
          isWritable: message.isAccountWritable(idx),
        }));

        return new TransactionInstruction({
          programId,
          keys,
          data: Buffer.from(ix.data),
        });
      }),
    }).compileToV0Message();

    const newTransaction = new VersionedTransaction(newMessage);

    return {
      transaction: newTransaction,
      blockhash,
      lastValidBlockHeight,
    };
  }

  /**
   * Simulate a transaction to check for errors before sending.
   *
   * @returns null if simulation succeeds, error message if it fails.
   */
  async simulate(
    transaction: VersionedTransaction
  ): Promise<{ success: boolean; error?: string; unitsConsumed?: number }> {
    try {
      const result = await this.connection.simulateTransaction(transaction, {
        sigVerify: false,
        replaceRecentBlockhash: true,
      });

      if (result.value.err) {
        return {
          success: false,
          error: JSON.stringify(result.value.err),
          unitsConsumed: result.value.unitsConsumed ?? undefined,
        };
      }

      return {
        success: true,
        unitsConsumed: result.value.unitsConsumed ?? undefined,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
```

### Task 9: Transaction Confirmation Tracker

Tracks transaction confirmation with timeout and retry logic.

**File: `P:\solana-agent-hackathon\packages\execution-engine\src\confirmation.ts`**

```typescript
import { Connection, type TransactionSignature } from '@solana/web3.js';
import type { ExecutionResult } from '@makora/types';

/**
 * Transaction Confirmation Tracker
 *
 * Monitors a submitted transaction until it reaches 'confirmed' commitment
 * or times out. Reports compute units consumed and slot of confirmation.
 */
export class ConfirmationTracker {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Wait for a transaction to be confirmed.
   *
   * Uses confirmTransaction() with blockhash strategy for reliable confirmation.
   * Falls back to signature polling if blockhash strategy fails.
   *
   * @param signature - Transaction signature to track
   * @param blockhash - Recent blockhash used in the transaction
   * @param lastValidBlockHeight - Block height after which the transaction expires
   * @param timeoutMs - Maximum wait time in ms
   */
  async waitForConfirmation(
    signature: TransactionSignature,
    blockhash: string,
    lastValidBlockHeight: number,
    timeoutMs: number = 30_000
  ): Promise<ExecutionResult> {
    const startTime = Date.now();

    try {
      // Use blockhash-based confirmation (most reliable)
      const result = await this.connection.confirmTransaction(
        {
          signature,
          blockhash,
          lastValidBlockHeight,
        },
        'confirmed'
      );

      if (result.value.err) {
        return {
          success: false,
          signature,
          error: `Transaction confirmed but failed: ${JSON.stringify(result.value.err)}`,
          timestamp: Date.now(),
        };
      }

      // Fetch transaction details for compute units and slot
      const details = await this.fetchTransactionDetails(signature);

      return {
        success: true,
        signature,
        slot: details.slot,
        computeUnits: details.computeUnits,
        timestamp: Date.now(),
      };
    } catch (err) {
      const elapsed = Date.now() - startTime;

      // Check if it is a timeout
      if (elapsed >= timeoutMs) {
        return {
          success: false,
          signature,
          error: `Transaction confirmation timed out after ${timeoutMs}ms`,
          timestamp: Date.now(),
        };
      }

      // Check if blockhash expired
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('block height exceeded') || errMsg.includes('Blockhash not found')) {
        return {
          success: false,
          signature,
          error: 'Transaction expired: blockhash no longer valid. Retry with fresh blockhash.',
          timestamp: Date.now(),
        };
      }

      return {
        success: false,
        signature,
        error: errMsg,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * Check if a transaction has already been confirmed (for idempotency).
   */
  async isConfirmed(signature: TransactionSignature): Promise<boolean> {
    try {
      const status = await this.connection.getSignatureStatus(signature);
      return status.value?.confirmationStatus === 'confirmed' ||
             status.value?.confirmationStatus === 'finalized';
    } catch {
      return false;
    }
  }

  /**
   * Fetch transaction details (slot, compute units) after confirmation.
   */
  private async fetchTransactionDetails(
    signature: TransactionSignature
  ): Promise<{ slot: number; computeUnits: number }> {
    try {
      const tx = await this.connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });

      return {
        slot: tx?.slot ?? 0,
        computeUnits: tx?.meta?.computeUnitsConsumed ?? 0,
      };
    } catch {
      return { slot: 0, computeUnits: 0 };
    }
  }
}
```

### Task 10: Execution Engine

The main engine that orchestrates the full transaction lifecycle.

**File: `P:\solana-agent-hackathon\packages\execution-engine\src\engine.ts`**

```typescript
import {
  Connection,
  Keypair,
  VersionedTransaction,
  type TransactionSignature,
} from '@solana/web3.js';
import type { ExecutionResult, ProposedAction, RiskAssessment } from '@makora/types';
import { TransactionBuilder } from './transaction-builder.js';
import { ConfirmationTracker } from './confirmation.js';
import {
  type ExecutionConfig,
  type ExecutionRequest,
  type RiskValidator,
  type ExecutionState,
  type ExecutionStateCallback,
  DEFAULT_EXECUTION_CONFIG,
} from './types.js';

/**
 * Execution Engine
 *
 * Manages the complete lifecycle of a Solana transaction:
 * 1. Build -- construct VersionedTransaction with compute budget
 * 2. Simulate -- dry-run to catch errors before paying fees
 * 3. Risk Check -- validate via risk manager (VETO point)
 * 4. Sign -- sign with the provided keypair
 * 5. Send -- submit to the network
 * 6. Confirm -- wait for confirmation with timeout
 * 7. Retry -- if blockhash expired, retry with fresh blockhash
 *
 * The engine is stateless: each execute() call is independent.
 * State callbacks are provided for UI/CLI progress reporting.
 */
export class ExecutionEngine {
  private connection: Connection;
  private config: ExecutionConfig;
  private builder: TransactionBuilder;
  private tracker: ConfirmationTracker;
  private riskValidator?: RiskValidator;
  private stateCallback?: ExecutionStateCallback;

  constructor(
    connection: Connection,
    config: Partial<ExecutionConfig> = {},
    riskValidator?: RiskValidator
  ) {
    this.connection = connection;
    this.config = { ...DEFAULT_EXECUTION_CONFIG, ...config };
    this.builder = new TransactionBuilder(connection, this.config);
    this.tracker = new ConfirmationTracker(connection);
    this.riskValidator = riskValidator;
  }

  /**
   * Set or update the risk validator.
   * Called by the risk manager during initialization.
   */
  setRiskValidator(validator: RiskValidator): void {
    this.riskValidator = validator;
  }

  /**
   * Set a callback to receive execution state updates.
   * Useful for CLI spinners or dashboard progress indicators.
   */
  onStateChange(callback: ExecutionStateCallback): void {
    this.stateCallback = callback;
  }

  /**
   * Execute a transaction request.
   *
   * Full lifecycle: build -> simulate -> risk check -> sign -> send -> confirm -> retry
   */
  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    let lastError: string | undefined;

    for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
      try {
        const result = await this.executeAttempt(request, attempt);

        if (result.success) {
          return result;
        }

        // Check if error is retryable
        if (result.error && this.isRetryableError(result.error)) {
          lastError = result.error;
          this.emitState({
            phase: 'failed',
            error: result.error,
            retriesLeft: this.config.maxRetries - attempt,
          });

          // Small delay before retry
          await this.sleep(1000 * attempt); // Progressive backoff
          continue;
        }

        // Non-retryable error
        return result;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);

        if (attempt < this.config.maxRetries && this.isRetryableError(lastError)) {
          this.emitState({
            phase: 'failed',
            error: lastError,
            retriesLeft: this.config.maxRetries - attempt,
          });
          await this.sleep(1000 * attempt);
          continue;
        }

        return {
          success: false,
          error: lastError,
          timestamp: Date.now(),
        };
      }
    }

    return {
      success: false,
      error: `All ${this.config.maxRetries} attempts failed. Last error: ${lastError}`,
      timestamp: Date.now(),
    };
  }

  /**
   * Execute a pre-built VersionedTransaction (e.g., from Jupiter).
   *
   * Skips the build phase. Still runs simulation, risk check, and confirmation.
   */
  async executePreBuilt(
    transaction: VersionedTransaction,
    signer: Keypair,
    description: string,
    action?: ProposedAction
  ): Promise<ExecutionResult> {
    return this.execute({
      instructions: [],
      preBuiltTransaction: transaction,
      signer,
      description,
      action,
    });
  }

  /**
   * Get the current execution configuration.
   */
  getConfig(): ExecutionConfig {
    return { ...this.config };
  }

  /**
   * Update execution configuration.
   */
  updateConfig(updates: Partial<ExecutionConfig>): void {
    this.config = { ...this.config, ...updates };
    this.builder = new TransactionBuilder(this.connection, this.config);
  }

  // ---- Private methods ----

  /**
   * A single execution attempt.
   */
  private async executeAttempt(
    request: ExecutionRequest,
    attempt: number
  ): Promise<ExecutionResult> {
    // Step 1: Build or use pre-built transaction
    this.emitState({ phase: 'building', description: request.description });

    let transaction: VersionedTransaction;
    let blockhash: string;
    let lastValidBlockHeight: number;

    if (request.preBuiltTransaction) {
      // Use pre-built transaction (e.g., from Jupiter)
      // For retries, we may need to refresh the blockhash
      if (attempt > 1) {
        const refreshed = await this.builder.refreshBlockhash(request.preBuiltTransaction);
        transaction = refreshed.transaction;
        blockhash = refreshed.blockhash;
        lastValidBlockHeight = refreshed.lastValidBlockHeight;
      } else {
        transaction = request.preBuiltTransaction;
        // Extract blockhash from the existing transaction
        const bh = await this.connection.getLatestBlockhash('confirmed');
        blockhash = bh.blockhash;
        lastValidBlockHeight = bh.lastValidBlockHeight;
      }
    } else {
      // Build from instructions
      const built = await this.builder.build(
        request.instructions,
        request.signer.publicKey,
        request.computeUnits,
        request.priorityFeeMicroLamports
      );
      transaction = built.transaction;
      blockhash = built.blockhash;
      lastValidBlockHeight = built.lastValidBlockHeight;
    }

    // Step 2: Simulate (optional)
    if (this.config.simulateBeforeSend) {
      this.emitState({ phase: 'simulating', description: request.description });

      // Need to sign before simulation
      transaction.sign([request.signer]);

      const simResult = await this.builder.simulate(transaction);
      if (!simResult.success) {
        return {
          success: false,
          error: `Simulation failed: ${simResult.error}`,
          computeUnits: simResult.unitsConsumed,
          timestamp: Date.now(),
        };
      }

      // Transaction is already signed from simulation
    } else {
      // Sign the transaction
      transaction.sign([request.signer]);
    }

    // Step 3: Risk check (if validator is configured)
    if (this.riskValidator && request.action) {
      this.emitState({ phase: 'risk_check', description: request.description });

      const assessment = await this.riskValidator.validate(request.action);
      if (!assessment.approved) {
        this.emitState({ phase: 'vetoed', reason: assessment.summary });
        return {
          success: false,
          error: `RISK VETO: ${assessment.summary}`,
          timestamp: Date.now(),
        };
      }
    }

    // Step 4: Send
    this.emitState({
      phase: 'sending',
      description: request.description,
      attempt,
    });

    const signature = await this.connection.sendTransaction(transaction, {
      skipPreflight: this.config.skipPreflight,
      maxRetries: 0, // We handle retries ourselves
    });

    // Step 5: Confirm
    this.emitState({
      phase: 'confirming',
      description: request.description,
      signature,
    });

    const result = await this.tracker.waitForConfirmation(
      signature,
      blockhash,
      lastValidBlockHeight,
      this.config.confirmationTimeoutMs
    );

    if (result.success) {
      this.emitState({ phase: 'confirmed', result });
    }

    return result;
  }

  /**
   * Check if an error is retryable.
   */
  private isRetryableError(error: string): boolean {
    const retryablePatterns = [
      'block height exceeded',
      'Blockhash not found',
      'blockhash',
      'Transaction simulation failed',
      'NodeBehind',
      'Too many requests',
      '429',
      'ECONNRESET',
      'ETIMEDOUT',
      'socket hang up',
    ];

    const lowerError = error.toLowerCase();
    return retryablePatterns.some((p) => lowerError.includes(p.toLowerCase()));
  }

  /**
   * Emit a state change to the callback.
   */
  private emitState(state: ExecutionState): void {
    if (this.stateCallback) {
      this.stateCallback(state);
    }
  }

  /**
   * Sleep helper for retry backoff.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

### Task 11: Execution Engine Package Index

**File: `P:\solana-agent-hackathon\packages\execution-engine\src\index.ts`**

```typescript
/**
 * @makora/execution-engine - Transaction execution for Makora
 *
 * Manages the complete lifecycle of Solana transactions:
 * build -> simulate -> risk check -> sign -> send -> confirm -> retry
 *
 * Features:
 * - VersionedTransaction with explicit compute budget
 * - Pre-flight simulation to catch errors before paying fees
 * - Risk validator hook (VETO point for risk manager)
 * - Automatic retry with fresh blockhash on expiry
 * - State callbacks for progress reporting
 */

export { ExecutionEngine } from './engine.js';
export { TransactionBuilder } from './transaction-builder.js';
export { ConfirmationTracker } from './confirmation.js';
export {
  type ExecutionConfig,
  type ExecutionRequest,
  type RiskValidator,
  type ExecutionState,
  type ExecutionStateCallback,
  DEFAULT_EXECUTION_CONFIG,
} from './types.js';
```

### Task 12: Update pnpm-workspace.yaml

The workspace file needs to include the new packages at `packages/protocol-router` and `packages/execution-engine`. Since `packages/*` is already a glob, these are already covered.

Verify `P:\solana-agent-hackathon\pnpm-workspace.yaml` contains:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
  - 'packages/adapters/*'
```

No change needed -- both `packages/protocol-router` and `packages/execution-engine` are matched by `packages/*`.

### Task 13: Install Dependencies and Build

```bash
cd P:\solana-agent-hackathon

# Install new workspace packages
pnpm install

# Build all (dependency order handled by turborepo)
pnpm build
```

Build order:
1. `@makora/types` (leaf)
2. `@makora/protocol-router` (depends on types)
3. `@makora/execution-engine` (depends on types)

## Verification

1. **Both packages compile** -- `packages/protocol-router/dist/` and `packages/execution-engine/dist/` contain compiled JavaScript and type declarations.
2. **Router dispatches swap to Jupiter** -- `router.route({ actionType: 'swap', params: swapParams })` returns a `RouteResult` with `protocolId: 'jupiter'` and non-empty instructions.
3. **Router dispatches stake to Marinade** -- `router.route({ actionType: 'stake', params: stakeParams })` returns a `RouteResult` with `protocolId: 'marinade'` and non-empty instructions.
4. **Router rejects unsupported actions** -- `router.route({ actionType: 'swap', protocol: 'marinade', params: swapParams })` throws an error because Marinade does not support direct swaps.
5. **Orchestrator plans multi-step** -- `orchestrator.planExecution({ type: 'move_to_yield', percentOfPortfolio: 30 }, portfolio, wallet)` returns an `OrchestrationPlan` with 1-3 steps.
6. **Execution engine builds versioned TX** -- `engine.execute(request)` builds a `VersionedTransaction` with `SetComputeUnitLimit` and `SetComputeUnitPrice` instructions at positions 0 and 1.
7. **Execution engine confirms within 30s** -- a simple SOL transfer sent via the engine returns `{ success: true }` within 30 seconds on devnet.
8. **Risk validator hook works** -- setting a `RiskValidator` that always rejects causes `execute()` to return `{ success: false, error: 'RISK VETO: ...' }` without sending the transaction.
9. **No TypeScript errors** -- `pnpm typecheck` passes for both packages.

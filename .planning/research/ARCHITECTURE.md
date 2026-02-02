# Architecture Research -- Mahoraga: Adaptive DeFi Agent for Solana

> Research compiled from: P01 reference project analysis, Solana Agent Kit v2 patterns,
> Jupiter/Raydium/Marinade/Kamino SDK analysis, multi-agent design pattern literature,
> Solana real-time data architecture, and ZK privacy layer design patterns.

---

## Table of Contents

1. [System Architecture](#system-architecture)
2. [Component Boundaries](#component-boundaries)
3. [Data Flow](#data-flow)
4. [Multi-Protocol Integration Pattern](#multi-protocol-integration-pattern)
5. [Privacy Layer Architecture](#privacy-layer-architecture)
6. [Solana Program Structure](#solana-program-structure)
7. [Real-Time Data Strategy](#real-time-data-strategy)
8. [Monorepo Layout](#monorepo-layout)
9. [Build Order](#build-order)

---

## System Architecture

### High-Level Component Diagram

```
+------------------------------------------------------------------+
|                        MAHORAGA SYSTEM                            |
+------------------------------------------------------------------+
|                                                                    |
|  +--------------------+     +-----------------------------+       |
|  |    Dashboard UI    |     |         CLI Interface       |       |
|  |    (Next.js)       |     |      (Commander.js)         |       |
|  +--------+-----------+     +-------------+---------------+       |
|           |                               |                       |
|           +---------------+---------------+                       |
|                           |                                       |
|                    +------v------+                                 |
|                    |  Agent Core |                                 |
|                    |   (TS)      |                                 |
|                    +------+------+                                 |
|                           |                                       |
|          +----------------+------------------+                    |
|          |                |                  |                    |
|   +------v------+  +-----v-------+   +------v------+            |
|   |  Strategy   |  |    Risk     |   |  Execution  |            |
|   |   Engine    |  |   Manager   |   |   Engine    |            |
|   +------+------+  +-----+-------+   +------+------+            |
|          |                |                  |                    |
|          +----------------+------------------+                    |
|                           |                                       |
|                    +------v------+                                 |
|                    |  Protocol   |                                 |
|                    |  Router     |                                 |
|                    +------+------+                                 |
|                           |                                       |
|     +----------+----------+----------+-----------+               |
|     |          |          |          |           |               |
|  +--v---+ +---v----+ +---v-----+ +-v-------+ +-v--------+      |
|  |Jupit.| |Raydium | |Marinade | |Kamino   | |Privacy   |      |
|  |Adapt.| |Adapter | |Adapter  | |Adapter  | |Adapter   |      |
|  +--+---+ +---+----+ +---+-----+ +-+-------+ +--+-------+      |
|     |         |           |         |            |               |
+-----|---------|-----------|---------|------------|---------------+
      |         |           |         |            |
+-----v---------v-----------v---------v------------v--------------+
|                    SOLANA BLOCKCHAIN                              |
|  +----------+ +----------+ +-----------+ +----------+           |
|  | Jupiter  | | Raydium  | | Marinade  | | Kamino   |           |
|  | Program  | | Program  | | Program   | | Program  |           |
|  +----------+ +----------+ +-----------+ +----------+           |
|                                                                  |
|  +-----------------------------------------------------------+  |
|  |               Mahoraga On-Chain Programs                   |  |
|  |  +--------------+  +---------------+  +----------------+  |  |
|  |  | mahoraga_    |  | mahoraga_     |  | mahoraga_      |  |  |
|  |  | vault        |  | strategy      |  | privacy        |  |  |
|  |  | (escrow,     |  | (params,      |  | (ZK shielded   |  |  |
|  |  |  treasury)   |  |  limits,      |  |  pool, stealth |  |  |
|  |  |              |  |  permissions) |  |  addresses)    |  |  |
|  |  +--------------+  +---------------+  +----------------+  |  |
|  +-----------------------------------------------------------+  |
+------------------------------------------------------------------+
```

### Architectural Decision: Modular Monolith

**Decision**: Modular monolith (not microservices, not pure monolith).

**Rationale**:
- A pure monolith would create tight coupling between protocol adapters, making it
  difficult to add new protocols or modify strategies independently.
- Full microservices would be over-engineered for a 10-day hackathon and would introduce
  network latency between components that need to make sub-second trading decisions.
- A modular monolith provides clean boundaries (each module has explicit interfaces),
  single-process deployment (simpler ops), shared memory for fast inter-module
  communication, and the ability to extract into services later if needed.

**Reference**: This mirrors P01's architecture -- a monorepo with clean package boundaries
(specter-sdk, zk-sdk, auth-sdk) that communicate through well-defined TypeScript interfaces,
all running in a single process context.

**Reference**: The Solana Agent Kit v2 uses a similar modular approach with its plugin
architecture -- `@solana-agent-kit/plugin-token`, `@solana-agent-kit/plugin-defi`, etc. --
where plugins are registered via a chainable `.use()` pattern but run in-process.

---

## Component Boundaries

### 1. Agent Core (`packages/agent-core`)

**Responsibility**: Orchestrates all decision-making. The "brain" of Mahoraga.

**Interfaces**:
```typescript
interface AgentCore {
  // Mode management
  setMode(mode: 'advisory' | 'auto'): void;
  getMode(): AgentMode;

  // Strategy lifecycle
  evaluateMarket(): Promise<MarketAssessment>;
  proposeActions(): Promise<ProposedAction[]>;
  executeActions(actions: ProposedAction[]): Promise<ExecutionResult[]>;

  // Event-driven
  onMarketUpdate(handler: MarketUpdateHandler): void;
  onPositionChange(handler: PositionChangeHandler): void;

  // State
  getPortfolioState(): PortfolioState;
  getActiveStrategies(): Strategy[];
}
```

**Dependencies**: Strategy Engine, Risk Manager, Execution Engine, Data Feed.

**Design Pattern**: The agent core implements a **decision loop** (observe -> orient ->
decide -> act), inspired by the OODA loop used in trading systems. In advisory mode,
the loop stops at "decide" and presents recommendations. In auto mode, it completes
the full loop.

---

### 2. Strategy Engine (`packages/strategy-engine`)

**Responsibility**: Defines and evaluates trading/DeFi strategies.

**Interfaces**:
```typescript
interface StrategyEngine {
  // Strategy management
  registerStrategy(strategy: Strategy): void;
  getStrategies(): Strategy[];
  getActiveStrategies(): Strategy[];

  // Evaluation
  evaluate(marketData: MarketData, portfolio: PortfolioState): StrategySignal[];
  backtest(strategy: Strategy, historicalData: HistoricalData): BacktestResult;

  // Adaptation (the "Mahoraga" concept -- continuous adaptation)
  adapt(performance: PerformanceMetrics): void;
}

interface Strategy {
  id: string;
  name: string;
  type: 'yield' | 'trading' | 'rebalance' | 'liquidity';
  protocols: ProtocolId[];
  evaluate(context: StrategyContext): StrategySignal;
  getParameters(): StrategyParams;
  setParameters(params: StrategyParams): void;
}
```

**Dependencies**: Protocol adapters (for protocol-specific data), Data Feed.

**Strategies to implement (priority order)**:
1. Yield optimization (Marinade staking, Kamino vaults)
2. Portfolio rebalancing (Jupiter swaps)
3. Liquidity provision (Raydium pools)
4. Arbitrage detection (cross-DEX via Jupiter routing)

---

### 3. Risk Manager (`packages/risk-manager`)

**Responsibility**: Enforces safety constraints. Can veto any action.

**Interfaces**:
```typescript
interface RiskManager {
  // Validation
  validateAction(action: ProposedAction): RiskAssessment;
  validatePortfolio(state: PortfolioState): PortfolioRisk;

  // Limits
  setLimits(limits: RiskLimits): void;
  getLimits(): RiskLimits;

  // Circuit breaker
  isCircuitBreakerActive(): boolean;
  triggerCircuitBreaker(reason: string): void;
  resetCircuitBreaker(): void;
}

interface RiskLimits {
  maxPositionSize: number;          // % of portfolio
  maxSlippage: number;              // basis points
  maxDailyLoss: number;             // % of portfolio
  maxGasPerTransaction: number;     // lamports
  minLiquidityDepth: number;        // USD
  maxProtocolExposure: number;      // % per protocol
  requirePrivacy: boolean;          // force ZK for transactions above threshold
  privacyThreshold: number;         // lamports threshold for privacy mode
}
```

**Dependencies**: Data Feed (for price validation), Portfolio State.

**Critical design point**: The risk manager has VETO power. No action reaches the
execution engine without passing risk validation. This is a hard architectural
constraint, not a soft check.

---

### 4. Execution Engine (`packages/execution-engine`)

**Responsibility**: Builds, signs, and submits Solana transactions.

**Interfaces**:
```typescript
interface ExecutionEngine {
  // Transaction execution
  execute(action: ValidatedAction): Promise<ExecutionResult>;
  executeBatch(actions: ValidatedAction[]): Promise<ExecutionResult[]>;

  // Transaction building
  buildTransaction(action: ValidatedAction): Promise<VersionedTransaction>;
  simulateTransaction(tx: VersionedTransaction): Promise<SimulationResult>;

  // Privacy-aware execution
  executePrivate(action: ValidatedAction): Promise<ExecutionResult>;

  // Monitoring
  getTransactionStatus(signature: string): Promise<TransactionStatus>;
  getPendingTransactions(): PendingTransaction[];
}
```

**Dependencies**: Protocol Router, Solana Connection, Privacy Adapter.

**Key implementation details**:
- Uses versioned transactions (v0) with Address Lookup Tables for efficiency.
- Implements priority fee estimation using recent block data.
- Supports Jito bundles for MEV protection when executing large trades.
- Transaction simulation before every execution (fail-fast).
- Retry logic with exponential backoff for transient failures.

---

### 5. Protocol Router (`packages/protocol-router`)

**Responsibility**: Routes actions to the correct protocol adapter.

**Interfaces**:
```typescript
interface ProtocolRouter {
  // Registration
  registerAdapter(adapter: ProtocolAdapter): void;
  getAdapter(protocolId: ProtocolId): ProtocolAdapter;
  getAdapters(): Map<ProtocolId, ProtocolAdapter>;

  // Routing
  route(action: ValidatedAction): Promise<RoutedAction>;
  findBestRoute(intent: ActionIntent): Promise<RouteOption[]>;

  // Health
  getProtocolHealth(): Map<ProtocolId, ProtocolHealth>;
}
```

**Dependencies**: All protocol adapters.

---

### 6. Protocol Adapters (`packages/adapters/*`)

**Responsibility**: Each adapter wraps a single DeFi protocol behind a uniform interface.

**Uniform Interface**:
```typescript
interface ProtocolAdapter {
  // Identity
  readonly protocolId: ProtocolId;
  readonly name: string;
  readonly version: string;

  // Lifecycle
  initialize(connection: Connection, wallet: Keypair): Promise<void>;
  healthCheck(): Promise<ProtocolHealth>;

  // Capabilities
  getCapabilities(): ProtocolCapability[];
  supportsAction(actionType: ActionType): boolean;

  // Read operations
  getPositions(owner: PublicKey): Promise<Position[]>;
  getQuote(params: QuoteParams): Promise<Quote>;
  getPoolData(poolId: string): Promise<PoolData>;

  // Write operations
  buildSwapIx(params: SwapParams): Promise<TransactionInstruction[]>;
  buildDepositIx(params: DepositParams): Promise<TransactionInstruction[]>;
  buildWithdrawIx(params: WithdrawParams): Promise<TransactionInstruction[]>;
}
```

**Concrete Adapters**:

| Adapter | Protocol | Capabilities | SDK |
|---------|----------|-------------|-----|
| `JupiterAdapter` | Jupiter | swap, route | `@jup-ag/api` |
| `RaydiumAdapter` | Raydium | swap, LP, CLMM | `@raydium-io/raydium-sdk-v2` |
| `MarinadeAdapter` | Marinade | liquid staking, mSOL | `@marinade.finance/marinade-ts-sdk` |
| `KaminoAdapter` | Kamino | lending, vaults, CLMM | `@kamino-finance/klend-sdk` |
| `PrivacyAdapter` | Mahoraga Privacy | shield, unshield, stealth | internal (based on P01 zk-sdk) |

**Design Pattern**: This is the **Adapter Pattern** (GoF). Each adapter translates the
uniform `ProtocolAdapter` interface into protocol-specific SDK calls. The agent core
never interacts with protocol SDKs directly.

**Reference**: This mirrors how Solana Agent Kit v2 structures its plugins -- each
plugin (`plugin-token`, `plugin-defi`) encapsulates protocol-specific logic behind
standardized action interfaces.

---

### 7. Data Feed (`packages/data-feed`)

**Responsibility**: Provides real-time and historical market data.

**Interfaces**:
```typescript
interface DataFeed {
  // Real-time
  subscribePrice(token: PublicKey, handler: PriceHandler): Subscription;
  subscribeAccount(account: PublicKey, handler: AccountHandler): Subscription;
  subscribeProgram(program: PublicKey, handler: ProgramHandler): Subscription;

  // Snapshot
  getPrice(token: PublicKey): Promise<TokenPrice>;
  getPrices(tokens: PublicKey[]): Promise<Map<PublicKey, TokenPrice>>;
  getTokenMetadata(token: PublicKey): Promise<TokenMetadata>;

  // Historical
  getOHLCV(token: PublicKey, interval: TimeInterval, range: TimeRange): Promise<OHLCV[]>;
  getVolumeHistory(pool: string, range: TimeRange): Promise<VolumeData[]>;
}
```

**Dependencies**: Solana WebSocket, Pyth/Switchboard oracles, Birdeye API (optional).

---

### 8. Privacy Module (`packages/privacy`)

**Responsibility**: Provides ZK proof generation, stealth addresses, and shielded transfers.

**Interfaces**:
```typescript
interface PrivacyModule {
  // Stealth addresses (from P01 pattern)
  generateStealthMetaAddress(): StealthMetaAddress;
  generateStealthAddress(meta: StealthMetaAddress): StealthAddress;
  scanForPayments(viewingKey: Uint8Array): Promise<StealthPayment[]>;

  // Shielded transfers (from P01 pattern)
  shield(amount: bigint, tokenMint: PublicKey): Promise<ShieldResult>;
  transfer(params: ShieldedTransferParams): Promise<TransferResult>;
  unshield(amount: bigint, recipient: PublicKey): Promise<UnshieldResult>;

  // Proof generation
  generateProof(inputs: ProofInputs): Promise<Groth16Proof>;
  verifyProof(proof: Groth16Proof, publicInputs: PublicInputs): Promise<boolean>;
}
```

**Dependencies**: Circom circuits (compiled WASM), snarkjs, Solana connection.

---

### 9. Dashboard (`apps/dashboard`)

**Responsibility**: Visual interface for monitoring and controlling the agent.

**Tech**: Next.js 14+ with App Router, Tailwind CSS, Recharts/Tremor for visualizations.

**Pages**:
- `/` -- Portfolio overview (balances, P&L, allocation chart)
- `/strategies` -- Active strategies, performance metrics
- `/history` -- Transaction history with privacy indicators
- `/settings` -- Risk limits, mode toggle (advisory/auto), protocol configs

**Communication**: WebSocket connection to agent core for real-time updates.

---

### 10. CLI (`apps/cli`)

**Responsibility**: Command-line interface for agent control.

**Tech**: Commander.js + Inquirer.js for interactive prompts.

**Commands**:
```
mahoraga start                 # Start agent in advisory mode
mahoraga start --auto          # Start agent in auto mode
mahoraga status                # Show portfolio and active strategies
mahoraga execute <strategy>    # Execute a specific strategy
mahoraga config set <key> <val> # Set configuration
mahoraga privacy shield <amt>  # Shield tokens
mahoraga privacy unshield <amt> # Unshield tokens
mahoraga history               # Show transaction history
```

---

## Data Flow

### Primary Decision Loop

```
[1] Market Data Sources
    |
    | WebSocket subscriptions (prices, account changes)
    | Polling (pool states, TVL, APY)
    v
[2] Data Feed (packages/data-feed)
    |
    | Normalized MarketData events
    v
[3] Agent Core -- Observation Phase
    |
    | MarketData + PortfolioState
    v
[4] Strategy Engine -- Evaluation Phase
    |
    | StrategySignal[] (buy/sell/rebalance/stake/provide-liquidity)
    v
[5] Agent Core -- Decision Phase
    |
    | ProposedAction[] (concrete actions with amounts, targets)
    |
    +---> [Advisory Mode] --> Dashboard/CLI (display recommendations, STOP)
    |
    v (Auto Mode only)
[6] Risk Manager -- Validation Phase
    |
    | ValidatedAction[] or VETO
    v
[7] Execution Engine -- Execution Phase
    |
    | Routes through Protocol Router
    v
[8] Protocol Adapter (Jupiter/Raydium/Marinade/Kamino/Privacy)
    |
    | Builds TransactionInstruction[]
    v
[9] Transaction Builder
    |
    | Simulation -> Signing -> Submission
    v
[10] Solana Blockchain
    |
    | Confirmation
    v
[11] Result Processing
    |
    | Update PortfolioState, emit events
    v
[12] Dashboard/CLI (real-time update via WebSocket)
```

### Privacy-Enhanced Flow (when privacy is required)

```
[Standard flow steps 1-6]
    |
    v
[7a] Privacy Module -- Proof Generation
    |
    | Generate ZK proof (off-chain, ~2-5 seconds for Groth16)
    | Compute nullifiers, commitments
    v
[7b] Execution Engine -- Private Execution
    |
    | Build shielded transaction with proof
    | Include encrypted note for recipient
    v
[8] Mahoraga Privacy Program (on-chain)
    |
    | Verify Groth16 proof
    | Update Merkle tree
    | Emit encrypted events
    v
[9-12] Same as standard flow (but with encrypted data)
```

### Data Flow: Real-Time Price Update Example

```
Pyth Oracle (on-chain account update)
    |
    v
WebSocket subscription (accountSubscribe)
    |
    v
DataFeed.onAccountChange()
    |
    | Parse Pyth price data
    | Normalize to TokenPrice { price, confidence, timestamp }
    v
Agent Core event handler
    |
    | Check against strategy triggers
    | e.g., SOL price dropped 5% -> trigger rebalance strategy
    v
Strategy Engine evaluates rebalance
    |
    | Signal: REBALANCE { sell: USDC, buy: SOL, amount: X }
    v
Risk Manager validates
    |
    | Check: position size OK, slippage acceptable, daily loss limit not hit
    v
Execution Engine
    |
    | Route through Jupiter for best swap rate
    | Build versioned transaction with priority fee
    | Simulate -> Sign -> Submit
    v
Solana confirms
    |
    v
Portfolio state updated, dashboard refreshed
```

---

## Multi-Protocol Integration Pattern

### Adapter Pattern Implementation

The adapter pattern is the recommended approach for multi-protocol DeFi integration.
Each protocol has a fundamentally different SDK interface, but the agent core needs
a uniform way to interact with all of them.

```typescript
// Base adapter interface -- all adapters implement this
abstract class BaseProtocolAdapter implements ProtocolAdapter {
  protected connection: Connection;
  protected wallet: Keypair;
  abstract readonly protocolId: ProtocolId;
  abstract readonly name: string;

  async initialize(connection: Connection, wallet: Keypair): Promise<void> {
    this.connection = connection;
    this.wallet = wallet;
    await this.setup();
  }

  protected abstract setup(): Promise<void>;

  // Common helpers
  protected async getTokenBalance(mint: PublicKey): Promise<bigint> { /* ... */ }
  protected async confirmTransaction(sig: string): Promise<void> { /* ... */ }
}

// Concrete adapter example: Jupiter
class JupiterAdapter extends BaseProtocolAdapter {
  readonly protocolId = 'jupiter' as ProtocolId;
  readonly name = 'Jupiter Aggregator';
  private jupiterApi: JupiterApi;

  protected async setup(): Promise<void> {
    this.jupiterApi = createJupiterApiClient();
  }

  getCapabilities(): ProtocolCapability[] {
    return ['swap', 'route', 'limit-order'];
  }

  async getQuote(params: QuoteParams): Promise<Quote> {
    // Translate uniform QuoteParams -> Jupiter-specific API call
    const jupiterQuote = await this.jupiterApi.quoteGet({
      inputMint: params.inputToken.toBase58(),
      outputMint: params.outputToken.toBase58(),
      amount: params.amount,
      slippageBps: params.maxSlippage,
    });
    // Translate Jupiter response -> uniform Quote
    return this.normalizeQuote(jupiterQuote);
  }

  async buildSwapIx(params: SwapParams): Promise<TransactionInstruction[]> {
    const quote = await this.getQuote(params);
    const swapResult = await this.jupiterApi.swapPost({
      swapRequest: {
        quoteResponse: quote.raw,
        userPublicKey: this.wallet.publicKey.toBase58(),
      },
    });
    // Deserialize and return instructions
    return this.deserializeInstructions(swapResult);
  }
}
```

### Protocol Router Pattern

The router selects the best adapter for a given action:

```typescript
class ProtocolRouterImpl implements ProtocolRouter {
  private adapters: Map<ProtocolId, ProtocolAdapter> = new Map();

  registerAdapter(adapter: ProtocolAdapter): void {
    this.adapters.set(adapter.protocolId, adapter);
  }

  async findBestRoute(intent: ActionIntent): Promise<RouteOption[]> {
    const candidates = Array.from(this.adapters.values())
      .filter(a => a.supportsAction(intent.type));

    const quotes = await Promise.all(
      candidates.map(async adapter => {
        try {
          const quote = await adapter.getQuote(intent.params);
          return { adapter, quote, score: this.scoreQuote(quote, intent) };
        } catch {
          return null; // Adapter failed, skip
        }
      })
    );

    return quotes
      .filter(Boolean)
      .sort((a, b) => b.score - a.score); // Best score first
  }

  private scoreQuote(quote: Quote, intent: ActionIntent): number {
    // Scoring factors: output amount, slippage, gas cost, route complexity
    let score = quote.outputAmount;
    score -= quote.estimatedGas * GAS_WEIGHT;
    score -= quote.priceImpact * IMPACT_WEIGHT;
    return score;
  }
}
```

### Protocol-Specific Integration Notes

**Jupiter (Swap Aggregator)**:
- Use the Ultra Swap API for standard swaps (recommended path).
- Fall back to Metis API only for CPI integration or custom instruction composition.
- Package: `@jup-ag/api` -- provides `quoteGet()` and `swapPost()`.
- Jupiter already aggregates Raydium, Orca, Lifinity, Meteora, Phoenix, and OpenBook.
- For simple swaps, Jupiter alone may be sufficient (it routes through Raydium internally).

**Raydium (Direct LP)**:
- Use `@raydium-io/raydium-sdk-v2` for direct pool interactions.
- Needed specifically for: CLMM position management, LP provision, pool creation.
- `Raydium.load()` initializes with connection and wallet.
- Supports both legacy and versioned transactions.

**Marinade (Liquid Staking)**:
- Use `@marinade.finance/marinade-ts-sdk` for staking operations.
- Key operations: `deposit()` (SOL -> mSOL), `liquidUnstake()` (mSOL -> SOL).
- mSOL can then be used in other protocols (Kamino vaults, Raydium pools).
- Simple SDK -- mostly wraps instruction building.

**Kamino (Lending/Vaults)**:
- Use `@kamino-finance/klend-sdk` for lending market operations.
- Use `@kamino-finance/kliquidity-sdk` for liquidity vault operations.
- `KaminoMarket.load()` to initialize market connection.
- Vaults auto-rebalance -- agent mainly needs deposit/withdraw.
- Lending: supply/borrow with interest rate curves.

---

## Privacy Layer Architecture

### Where ZK Proofs Fit

The privacy layer is based on the proven architecture from P01, adapted for DeFi
agent operations.

```
+---------------------------------------------------------------+
|                    PRIVACY LAYER                                |
|                                                                 |
|  +------------------+    +-----------------+                    |
|  | Stealth Address  |    | Shielded Pool   |                    |
|  | Module           |    | Module          |                    |
|  |                  |    |                 |                    |
|  | - Meta-address   |    | - Shield/       |                    |
|  |   generation     |    |   Unshield      |                    |
|  | - Address        |    | - Private       |                    |
|  |   derivation     |    |   Transfer      |                    |
|  | - Payment        |    | - Merkle Tree   |                    |
|  |   scanning       |    |   management    |                    |
|  +--------+---------+    +--------+--------+                    |
|           |                       |                             |
|           v                       v                             |
|  +------------------+    +-----------------+                    |
|  | Specter Program  |    | ZK Shielded     |                    |
|  | (on-chain)       |    | Program         |                    |
|  |                  |    | (on-chain)      |                    |
|  | - Stealth PDA    |    | - Pool state    |                    |
|  |   accounts       |    | - Proof verify  |                    |
|  | - Encrypted      |    | - Nullifier set |                    |
|  |   amounts        |    | - Commitment    |                    |
|  | - Claim logic    |    |   tree          |                    |
|  +------------------+    +-----------------+                    |
|                                                                 |
|  +--------------------------------------------------+          |
|  | ZK Proof Engine (off-chain)                       |          |
|  |                                                    |          |
|  | Circom Circuits (compiled to WASM):                |          |
|  | - transfer.circom (2-in-2-out, Merkle depth 20)   |          |
|  | - merkle.circom (Poseidon hash tree checker)       |          |
|  | - poseidon.circom (hash primitives)                |          |
|  |                                                    |          |
|  | snarkjs Groth16 prover:                            |          |
|  | - Generates proofs in ~2-5s (WASM)                 |          |
|  | - Proof: pi_a (G1), pi_b (G2), pi_c (G1)          |          |
|  | - Public inputs: root, nullifiers, commitments     |          |
|  +--------------------------------------------------+          |
+---------------------------------------------------------------+
```

### Stealth Address Flow (from P01)

```
SENDER                              RECIPIENT
  |                                     |
  | 1. Get recipient's stealth          |
  |    meta-address (published)         |
  |                                     |
  | 2. Derive one-time stealth address  |
  |    using ECDH                       |
  |                                     |
  | 3. Send SOL/tokens to stealth       |
  |    address PDA                      |
  |                                     |
  | 4. Publish encrypted announcement   |
  |    (ephemeral pubkey + encrypted    |
  |     amount)                         |
  |                                     |
  |              ...time passes...      |
  |                                     |
  |                   5. Recipient scans |
  |                      announcements   |
  |                      with viewing    |
  |                      key             |
  |                                     |
  |                   6. Derives stealth |
  |                      private key     |
  |                                     |
  |                   7. Claims funds    |
  |                      to own wallet   |
```

### Shielded Transfer Flow (from P01)

```
USER                    OFF-CHAIN               ON-CHAIN (ZK Shielded Program)
  |                         |                          |
  | 1. Shield (deposit)     |                          |
  |    amount: 10 SOL       |                          |
  |                         |                          |
  | 2. Create note:         |                          |
  |    {amount, owner,      |                          |
  |     randomness, mint}   |                          |
  |                         |                          |
  | 3. Compute commitment   |                          |
  |    = Poseidon(note)     |                          |
  |                         |                          |
  | 4. Submit shield tx ----|------------------------->|
  |                         |                          | Store commitment
  |                         |                          | Update Merkle root
  |                         |                          | Transfer SOL to pool
  |                         |                          |
  | --- Private Transfer ---|                          |
  |                         |                          |
  | 5. Select input notes   |                          |
  |    (to spend)           |                          |
  |                         |                          |
  | 6. Create output notes  |                          |
  |    (for recipient)      |                          |
  |                         |                          |
  |                  7. Generate Groth16 proof          |
  |                     - Merkle membership            |
  |                     - Nullifier computation         |
  |                     - Value conservation            |
  |                     - Range proofs                  |
  |                     (~2-5 seconds)                  |
  |                         |                          |
  | 8. Submit transfer tx --|------------------------->|
  |    with proof +         |                          | Verify Groth16 proof
  |    nullifiers +         |                          | Check nullifiers unused
  |    commitments          |                          | Store new commitments
  |                         |                          | Mark nullifiers spent
  |                         |                          |
  | --- Unshield (withdraw) |                          |
  |                         |                          |
  | 9. Generate proof       |                          |
  |    (ownership of notes) |                          |
  |                         |                          |
  | 10. Submit unshield tx -|------------------------->|
  |                         |                          | Verify proof
  |                         |                          | Transfer SOL from pool
  |                         |                          | Mark nullifiers spent
```

### Privacy Integration Points in the DeFi Agent

Privacy is optional and threshold-based. The risk manager determines when privacy
is required:

```
Agent decides to execute a swap
    |
    v
Risk Manager checks:
  - Is amount > privacyThreshold? --> Route through Privacy Adapter
  - Is requirePrivacy flag set?   --> Route through Privacy Adapter
  - Otherwise                     --> Route through standard adapter
    |
    v
[Privacy path]
  1. Shield source tokens into shielded pool
  2. Perform shielded transfer to a fresh stealth address
  3. Unshield from stealth address
  4. Execute DeFi operation from fresh address
  (Result: no link between agent wallet and DeFi position)

[Standard path]
  1. Execute DeFi operation directly
  (Result: visible on-chain, but faster and cheaper)
```

### Circom Circuit Structure (derived from P01)

For Mahoraga, we reuse the same circuit architecture from P01:

| Circuit | Purpose | Public Inputs | Depth |
|---------|---------|--------------|-------|
| `transfer.circom` | 2-in-2-out private transfer | merkle_root, nullifiers, commitments, public_amount, token_mint | 20 |
| `merkle.circom` | Merkle tree path verification | root | configurable |
| `poseidon.circom` | Hash primitives (commitment, nullifier) | N/A (sub-component) | N/A |

---

## Solana Program Structure

### Decision: Multiple Programs (not monolith)

**Rationale**: Following the P01 pattern (6 separate programs: specter, zk_shielded,
stream, subscription, whitelist, fee-splitter). Multiple programs provide:
- Independent upgradability
- Cleaner security boundaries
- Parallel development
- Composability via CPI

### Mahoraga Program Layout

```
programs/
  mahoraga_vault/          # Treasury and escrow management
    src/
      lib.rs               # Program entry point
      instructions/
        initialize.rs      # Initialize vault for user
        deposit.rs         # Deposit SOL/tokens into agent vault
        withdraw.rs        # Withdraw from vault
        rebalance.rs       # Agent rebalances vault (CPI to DeFi protocols)
      state/
        vault.rs           # Vault account structure
        config.rs          # Global config
      errors.rs
    Cargo.toml

  mahoraga_strategy/       # On-chain strategy parameters and permissions
    src/
      lib.rs
      instructions/
        create_strategy.rs   # Register a strategy on-chain
        update_params.rs     # Update strategy parameters
        set_permissions.rs   # Set agent execution permissions
        record_execution.rs  # Record strategy execution (audit trail)
      state/
        strategy.rs          # Strategy account
        execution_log.rs     # Execution history
        permissions.rs       # Permission settings
      errors.rs
    Cargo.toml

  mahoraga_privacy/        # ZK privacy (based on P01's zk_shielded)
    src/
      lib.rs
      instructions/
        initialize_pool.rs
        shield.rs
        transfer.rs
        unshield.rs
        transfer_via_relayer.rs
      state/
        pool.rs
        nullifier_set.rs
      verifier/
        groth16.rs           # On-chain proof verification
      errors.rs
    Cargo.toml
```

### Key PDA Structures

```rust
// Vault PDA: seeds = ["vault", user_pubkey]
#[account]
pub struct Vault {
    pub owner: Pubkey,           // Wallet owner
    pub agent_authority: Pubkey, // Agent's signing authority
    pub total_deposited: u64,    // Total SOL deposited
    pub total_withdrawn: u64,    // Total SOL withdrawn
    pub mode: AgentMode,         // 0 = advisory, 1 = auto
    pub risk_limits: RiskLimits, // Encoded risk parameters
    pub created_at: i64,
    pub last_action_at: i64,
    pub bump: u8,
}

// Strategy PDA: seeds = ["strategy", vault_pubkey, strategy_id]
#[account]
pub struct StrategyAccount {
    pub vault: Pubkey,
    pub strategy_id: [u8; 32],
    pub strategy_type: u8,       // yield, trading, rebalance, liquidity
    pub is_active: bool,
    pub parameters: [u8; 256],   // Encoded strategy params
    pub total_executions: u64,
    pub total_profit_loss: i64,  // In lamports (can be negative)
    pub last_execution: i64,
    pub bump: u8,
}

// ExecutionLog PDA: seeds = ["execution", strategy_pubkey, execution_index]
#[account]
pub struct ExecutionLog {
    pub strategy: Pubkey,
    pub index: u64,
    pub action_type: u8,
    pub protocol: u8,            // jupiter=0, raydium=1, marinade=2, kamino=3
    pub input_amount: u64,
    pub output_amount: u64,
    pub timestamp: i64,
    pub transaction_signature: [u8; 64],
    pub bump: u8,
}

// ShieldedPool PDA: seeds = ["pool", token_mint] (from P01)
#[account]
pub struct ShieldedPool {
    pub authority: Pubkey,
    pub token_mint: Pubkey,
    pub merkle_root: [u8; 32],
    pub next_leaf_index: u32,
    pub total_shielded: u64,
    pub vk_hash: [u8; 32],
    pub is_active: bool,
    pub bump: u8,
}
```

### CPI Patterns

The vault program uses CPI to interact with external DeFi protocols:

```rust
// Example: Vault calls Jupiter for a swap
pub fn rebalance(ctx: Context<Rebalance>, swap_data: Vec<u8>) -> Result<()> {
    // Verify agent has permission
    require!(ctx.accounts.vault.mode == AgentMode::Auto, ErrorCode::NotAutoMode);

    // CPI to Jupiter program
    let vault_seeds = &[
        b"vault",
        ctx.accounts.vault.owner.as_ref(),
        &[ctx.accounts.vault.bump],
    ];
    let signer = &[&vault_seeds[..]];

    // Jupiter swap via CPI
    invoke_signed(
        &jupiter_instruction,
        &ctx.accounts.to_account_infos(),
        signer,
    )?;

    // Record execution
    emit!(RebalanceEvent { ... });
    Ok(())
}
```

---

## Real-Time Data Strategy

### Recommended Approach: Tiered Architecture

```
Tier 1: WebSocket Subscriptions (primary, low-latency)
    |
    | Account subscriptions for:
    |   - Pyth/Switchboard price feeds
    |   - User token accounts (balance changes)
    |   - Pool accounts (state changes)
    |
    | Solana native: connection.onAccountChange()
    | Enhanced: Helius WebSocket (auto-reconnect, multi-node)
    |
Tier 2: Polling (secondary, reliable baseline)
    |
    | Every 10-30 seconds:
    |   - Full portfolio snapshot
    |   - Pool APY/TVL updates
    |   - Protocol health checks
    |
    | Why: WebSocket can drop events; polling catches gaps
    |
Tier 3: Geyser gRPC (optional, for production scale)
    |
    | Yellowstone gRPC streaming for:
    |   - All program account updates
    |   - Transaction confirmations
    |   - Slot notifications
    |
    | When to use: When WebSocket is insufficient for throughput
    | Provider: Chainstack, Helius, or Triton
```

### Implementation for Hackathon (10-day scope)

For the hackathon, we implement Tier 1 + Tier 2 only. Geyser is production-grade
infrastructure that adds complexity without changing the demo experience.

```typescript
class SolanaDataFeed implements DataFeed {
  private connection: Connection;
  private subscriptions: Map<string, number> = new Map();
  private priceCache: Map<string, TokenPrice> = new Map();

  // Tier 1: WebSocket for price feeds
  subscribePrice(token: PublicKey, handler: PriceHandler): Subscription {
    // Subscribe to Pyth price account
    const pythAccount = getPythPriceAccount(token);
    const subId = this.connection.onAccountChange(
      pythAccount,
      (accountInfo) => {
        const price = parsePythPrice(accountInfo);
        this.priceCache.set(token.toBase58(), price);
        handler(price);
      },
      'confirmed'
    );
    this.subscriptions.set(`price:${token.toBase58()}`, subId);
    return { unsubscribe: () => this.connection.removeAccountChangeListener(subId) };
  }

  // Tier 2: Polling for portfolio snapshots
  async startPolling(interval: number = 15_000): Promise<void> {
    setInterval(async () => {
      await this.refreshPortfolio();
      await this.refreshPoolStates();
    }, interval);
  }
}
```

### Data Sources

| Data Type | Source | Method | Frequency |
|-----------|--------|--------|-----------|
| Token prices | Pyth Network | WebSocket (onAccountChange) | Real-time (~400ms) |
| Token prices (backup) | Jupiter Price API | HTTP polling | Every 10s |
| Pool states | On-chain accounts | WebSocket + polling | Real-time + 15s |
| APY/TVL | Kamino/Marinade APIs | HTTP polling | Every 60s |
| Transaction confirmations | Solana RPC | WebSocket (signatureSubscribe) | Real-time |
| Historical OHLCV | Birdeye API | HTTP request | On-demand |

---

## Monorepo Layout

### Recommended Structure

```
P:\solana-agent-hackathon\
|
+-- .planning/                      # Planning documents (not shipped)
|   +-- research/
|       +-- ARCHITECTURE.md         # THIS FILE
|
+-- package.json                    # Root package.json (workspace config)
+-- pnpm-workspace.yaml             # pnpm workspace definition
+-- turbo.json                       # Turborepo build config
+-- tsconfig.json                    # Root TypeScript config
+-- Cargo.toml                       # Rust workspace (for Anchor programs)
+-- Anchor.toml                      # Anchor project config
|
+-- packages/                        # Shared TypeScript packages
|   +-- types/                       # Shared type definitions
|   |   +-- src/
|   |   |   +-- index.ts
|   |   |   +-- agent.ts             # AgentMode, MarketData, etc.
|   |   |   +-- protocols.ts         # ProtocolId, Quote, Position, etc.
|   |   |   +-- privacy.ts           # StealthAddress, ShieldedNote, etc.
|   |   |   +-- strategy.ts          # Strategy, Signal, BacktestResult, etc.
|   |   +-- package.json
|   |
|   +-- agent-core/                  # Agent brain (decision loop)
|   |   +-- src/
|   |   |   +-- index.ts
|   |   |   +-- agent.ts             # Main AgentCore class
|   |   |   +-- decision-loop.ts     # OODA loop implementation
|   |   |   +-- portfolio.ts         # Portfolio state management
|   |   +-- package.json
|   |
|   +-- strategy-engine/             # Strategy evaluation
|   |   +-- src/
|   |   |   +-- index.ts
|   |   |   +-- engine.ts
|   |   |   +-- strategies/
|   |   |   |   +-- yield-optimizer.ts
|   |   |   |   +-- rebalancer.ts
|   |   |   |   +-- liquidity-provider.ts
|   |   |   +-- adaptation.ts        # Strategy adaptation logic
|   |   +-- package.json
|   |
|   +-- risk-manager/                # Risk validation and limits
|   |   +-- src/
|   |   |   +-- index.ts
|   |   |   +-- manager.ts
|   |   |   +-- circuit-breaker.ts
|   |   |   +-- validators/
|   |   |   |   +-- position-size.ts
|   |   |   |   +-- slippage.ts
|   |   |   |   +-- daily-loss.ts
|   |   +-- package.json
|   |
|   +-- execution-engine/            # Transaction building and submission
|   |   +-- src/
|   |   |   +-- index.ts
|   |   |   +-- engine.ts
|   |   |   +-- transaction-builder.ts
|   |   |   +-- priority-fee.ts
|   |   |   +-- retry.ts
|   |   +-- package.json
|   |
|   +-- protocol-router/             # Routes actions to adapters
|   |   +-- src/
|   |   |   +-- index.ts
|   |   |   +-- router.ts
|   |   +-- package.json
|   |
|   +-- adapters/                    # Protocol adapters
|   |   +-- jupiter/
|   |   |   +-- src/
|   |   |   |   +-- index.ts
|   |   |   |   +-- adapter.ts
|   |   |   |   +-- types.ts
|   |   |   +-- package.json
|   |   +-- raydium/
|   |   |   +-- src/
|   |   |   |   +-- index.ts
|   |   |   |   +-- adapter.ts
|   |   |   |   +-- types.ts
|   |   |   +-- package.json
|   |   +-- marinade/
|   |   |   +-- src/
|   |   |   |   +-- index.ts
|   |   |   |   +-- adapter.ts
|   |   |   |   +-- types.ts
|   |   |   +-- package.json
|   |   +-- kamino/
|   |   |   +-- src/
|   |   |   |   +-- index.ts
|   |   |   |   +-- adapter.ts
|   |   |   |   +-- types.ts
|   |   |   +-- package.json
|   |
|   +-- privacy/                     # ZK privacy module
|   |   +-- src/
|   |   |   +-- index.ts
|   |   |   +-- stealth/             # Stealth addresses
|   |   |   +-- shielded/            # Shielded pool client
|   |   |   +-- prover/              # ZK proof generation
|   |   |   +-- circuits/            # Circuit helpers
|   |   |   +-- merkle/              # Merkle tree
|   |   |   +-- types.ts
|   |   +-- package.json
|   |
|   +-- data-feed/                   # Market data and subscriptions
|       +-- src/
|       |   +-- index.ts
|       |   +-- feed.ts
|       |   +-- sources/
|       |   |   +-- pyth.ts
|       |   |   +-- jupiter-price.ts
|       |   |   +-- on-chain.ts
|       |   +-- cache.ts
|       +-- package.json
|
+-- programs/                        # Solana programs (Anchor/Rust)
|   +-- mahoraga_vault/
|   |   +-- src/
|   |   +-- Cargo.toml
|   +-- mahoraga_strategy/
|   |   +-- src/
|   |   +-- Cargo.toml
|   +-- mahoraga_privacy/
|       +-- src/
|       +-- Cargo.toml
|
+-- circuits/                        # Circom ZK circuits
|   +-- transfer.circom
|   +-- merkle.circom
|   +-- poseidon.circom
|   +-- build/                       # Compiled circuits (WASM, zkey, vkey)
|
+-- apps/
|   +-- dashboard/                   # Next.js dashboard
|   |   +-- app/
|   |   |   +-- page.tsx             # Portfolio overview
|   |   |   +-- strategies/
|   |   |   +-- history/
|   |   |   +-- settings/
|   |   +-- components/
|   |   +-- package.json
|   |
|   +-- cli/                         # CLI application
|       +-- src/
|       |   +-- index.ts
|       |   +-- commands/
|       +-- package.json
|
+-- tests/                           # Integration and e2e tests
|   +-- agent-core.test.ts
|   +-- strategies.test.ts
|   +-- adapters/
|   |   +-- jupiter.test.ts
|   |   +-- raydium.test.ts
|   |   +-- marinade.test.ts
|   |   +-- kamino.test.ts
|   +-- privacy/
|   |   +-- stealth.test.ts
|   |   +-- shielded.test.ts
|   +-- e2e/
|       +-- full-cycle.test.ts
|       +-- advisory-mode.test.ts
|       +-- auto-mode.test.ts
```

### Workspace Configuration

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'packages/adapters/*'
  - 'apps/*'
```

```json
// turbo.json
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
    }
  }
}
```

### Package Dependency Graph

```
@mahoraga/types          <-- no internal dependencies (leaf node)
    ^
    |
@mahoraga/data-feed      <-- depends on types
    ^
    |
@mahoraga/adapters/*     <-- depends on types, data-feed
    ^
    |
@mahoraga/protocol-router <-- depends on types, adapters
    ^
    |
@mahoraga/privacy        <-- depends on types (and circom build artifacts)
    ^
    |
@mahoraga/risk-manager   <-- depends on types, data-feed
    ^
    |
@mahoraga/execution-engine <-- depends on types, protocol-router, privacy
    ^
    |
@mahoraga/strategy-engine <-- depends on types, data-feed, adapters
    ^
    |
@mahoraga/agent-core     <-- depends on all above (top of the tree)
    ^
    |
apps/cli, apps/dashboard <-- depends on agent-core
```

---

## Build Order

### Phase 1: Foundation (Days 1-2)
**Goal**: Skeleton that compiles and has basic Solana connectivity.

| Priority | Task | Package | Dependencies |
|----------|------|---------|-------------|
| 1.1 | Monorepo setup (pnpm, turbo, tsconfig) | root | None |
| 1.2 | Shared types package | `@mahoraga/types` | 1.1 |
| 1.3 | Anchor workspace setup | `programs/` | 1.1 |
| 1.4 | Data feed with Pyth + polling | `@mahoraga/data-feed` | 1.2 |
| 1.5 | Basic CLI skeleton | `apps/cli` | 1.2 |

### Phase 2: Protocol Integration (Days 3-4)
**Goal**: Can execute swaps and staking operations.

| Priority | Task | Package | Dependencies |
|----------|------|---------|-------------|
| 2.1 | Jupiter adapter (swap) | `@mahoraga/adapters/jupiter` | 1.2, 1.4 |
| 2.2 | Marinade adapter (stake) | `@mahoraga/adapters/marinade` | 1.2, 1.4 |
| 2.3 | Protocol router | `@mahoraga/protocol-router` | 2.1, 2.2 |
| 2.4 | Execution engine (tx building) | `@mahoraga/execution-engine` | 2.3 |
| 2.5 | Vault program (Anchor) | `programs/mahoraga_vault` | 1.3 |
| 2.6 | Raydium adapter (LP) | `@mahoraga/adapters/raydium` | 1.2, 1.4 |
| 2.7 | Kamino adapter (lending) | `@mahoraga/adapters/kamino` | 1.2, 1.4 |

### Phase 3: Agent Intelligence (Days 5-6)
**Goal**: Agent can analyze market and propose/execute strategies.

| Priority | Task | Package | Dependencies |
|----------|------|---------|-------------|
| 3.1 | Risk manager | `@mahoraga/risk-manager` | 1.2, 1.4 |
| 3.2 | Strategy engine + yield optimizer | `@mahoraga/strategy-engine` | 1.2, 2.1-2.7 |
| 3.3 | Agent core (decision loop) | `@mahoraga/agent-core` | 3.1, 3.2, 2.4 |
| 3.4 | Advisory mode (CLI output) | `apps/cli` | 3.3 |
| 3.5 | Auto mode | `@mahoraga/agent-core` | 3.3, 3.4 |
| 3.6 | Strategy program (Anchor) | `programs/mahoraga_strategy` | 1.3, 2.5 |

### Phase 4: Privacy Layer (Days 7-8)
**Goal**: ZK privacy for high-value operations.

| Priority | Task | Package | Dependencies |
|----------|------|---------|-------------|
| 4.1 | Circom circuits (port from P01) | `circuits/` | None |
| 4.2 | Privacy module (stealth + shielded) | `@mahoraga/privacy` | 4.1, 1.2 |
| 4.3 | Privacy adapter | `@mahoraga/adapters/privacy` | 4.2 |
| 4.4 | Privacy program (Anchor, port from P01) | `programs/mahoraga_privacy` | 1.3, 4.1 |
| 4.5 | Integration with execution engine | `@mahoraga/execution-engine` | 4.3, 2.4 |

### Phase 5: Dashboard & Polish (Days 9-10)
**Goal**: Impressive demo, clean code, tests passing.

| Priority | Task | Package | Dependencies |
|----------|------|---------|-------------|
| 5.1 | Dashboard: portfolio overview | `apps/dashboard` | 3.3 |
| 5.2 | Dashboard: strategy visualization | `apps/dashboard` | 5.1 |
| 5.3 | Dashboard: transaction history | `apps/dashboard` | 5.1 |
| 5.4 | Integration tests (e2e) | `tests/` | All |
| 5.5 | README, screenshots, demo recording | root | All |
| 5.6 | Final testing and bug fixes | All | All |

### Critical Path

```
Types -> DataFeed -> Jupiter Adapter -> Protocol Router -> Execution Engine
    -> Strategy Engine -> Agent Core -> CLI (advisory mode)
```

This critical path should be completable by Day 6, giving 4 days for privacy,
dashboard, and polish. If privacy proves too complex, the agent is still fully
functional without it (privacy is additive, not required for core functionality).

### Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| ZK circuits too complex for timeline | Port directly from P01 (proven, tested) |
| Protocol SDK breaking changes | Pin SDK versions, mock in tests |
| Anchor build issues on Windows | Use WSL2 for Rust compilation (P01 has `build-wsl.sh`) |
| WebSocket connection drops | Polling fallback (Tier 2 data) |
| Scope creep | Privacy layer is Phase 4 -- can be cut if behind schedule |

---

## Appendix: Key SDK Versions

| Package | Version | Purpose |
|---------|---------|---------|
| `@coral-xyz/anchor` | ^0.30.1 | Anchor client (match P01) |
| `@solana/web3.js` | ^1.98 | Solana SDK |
| `@solana/spl-token` | ^0.4 | SPL token operations |
| `@jup-ag/api` | latest | Jupiter swap aggregator |
| `@raydium-io/raydium-sdk-v2` | latest | Raydium DEX operations |
| `@marinade.finance/marinade-ts-sdk` | latest | Marinade staking |
| `@kamino-finance/klend-sdk` | latest | Kamino lending |
| `@kamino-finance/kliquidity-sdk` | latest | Kamino liquidity vaults |
| `snarkjs` | ^0.7.4 | ZK proof generation (match P01) |
| `circomlibjs` | ^0.1.7 | Circuit library (match P01) |
| `poseidon-lite` | ^0.2.0 | Poseidon hashing (match P01) |
| `anchor-lang` (Rust) | 0.30.1 | Anchor framework (match P01) |
| `solana-program` (Rust) | 1.18.17 | Solana runtime (match P01) |

## Appendix: Reference Sources

- [Solana Agent Kit (SendAI)](https://github.com/sendaifun/solana-agent-kit) -- Plugin architecture reference
- [Jupiter Developer Docs](https://station.jup.ag/docs/) -- Swap API integration
- [Raydium SDK V2](https://github.com/raydium-io/raydium-sdk-V2) -- DEX integration
- [Marinade TS SDK](https://github.com/marinade-finance/marinade-ts-sdk) -- Staking integration
- [Kamino Lending SDK](https://github.com/Kamino-Finance/klend-sdk) -- Lending integration
- [Kamino Liquidity SDK](https://github.com/Kamino-Finance/kliquidity-sdk) -- Vault integration
- [Helius: Secure AI Agent on Solana](https://www.helius.dev/blog/how-to-build-a-secure-ai-agent-on-solana) -- Security patterns
- [Solana PDAs with Anchor](https://solana.com/docs/programs/anchor/pda) -- PDA design patterns
- [Helius: Solana PDAs](https://www.helius.dev/blog/solana-pda) -- PDA architecture
- [Chainstack: Real-Time Solana Data](https://chainstack.com/real-time-solana-data-websocket-vs-yellowstone-grpc-geyser/) -- Data streaming
- [Solana Data Streaming (Syndica)](https://blog.syndica.io/solana-data-streaming-how-to-power-your-dapp-with-real-time-data/) -- Data architecture
- [Multi-Agent DeFi Investment Architecture](https://medium.com/@gwrx2005/multi-agent-ai-architecture-for-personalized-defi-investment-strategies-c81c1b9de20c) -- Agent patterns
- [Google Multi-Agent Design Patterns](https://www.infoq.com/news/2026/01/multi-agent-design-patterns/) -- Design patterns
- P01 Project (`P:\p01`) -- Proven Solana+ZK architecture reference

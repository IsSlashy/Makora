---
phase: 03-agent-intelligence
plan: 08
type: execute
wave: 1
depends_on: [04, 05, 06]
files_modified:
  - packages/agent-core/package.json
  - packages/agent-core/tsconfig.json
  - packages/agent-core/src/index.ts
  - packages/agent-core/src/agent.ts
  - packages/agent-core/src/ooda-loop.ts
  - packages/agent-core/src/nl-parser.ts
  - packages/agent-core/src/advisory.ts
  - packages/agent-core/src/auto-mode.ts
  - packages/agent-core/src/explainer.ts
  - packages/agent-core/src/decision-log.ts
  - packages/agent-core/src/types.ts
autonomous: true
must_haves:
  truths:
    - "`pnpm build` compiles @makora/agent-core without errors"
    - "Agent in advisory mode suggests 'Stake idle SOL via Marinade for 7.2% APY' with explanation and waits for user confirmation"
    - "Agent in auto mode executes a rebalancing action autonomously and logs the full decision rationale"
    - "NL parser interprets 'swap 10 SOL to USDC' into a structured ProposedAction with amount=10*1e9, type='swap', protocol='jupiter'"
    - "NL parser interprets 'stake 50% of my SOL' into a stake action with correct amount"
    - "NL parser interprets 'show my portfolio' into a query action (no execution)"
    - "OODA loop completes a full cycle (observe -> orient -> decide -> act) within 5 seconds"
    - "DecisionLog records every cycle with timestamp, phase durations, actions taken, and rationale"
    - "Agent emits typed AgentEvent for every state change (mode change, cycle start/end, action proposed/approved/rejected/executed)"
  artifacts:
    - packages/agent-core/dist/index.js
---

# Plan 08: Agent Core — NL Parser + OODA Loop + Advisory/Auto Modes (@makora/agent-core)

## Objective

Build the agent core that ties the entire system together: data-feed -> strategy-engine -> risk-manager -> execution-engine -> protocol-router. The agent core runs the OODA decision loop, supports advisory and auto modes, parses natural language commands, and provides clear explanations for every action.

After this plan completes:
- The agent runs a continuous OODA loop (Observe -> Orient -> Decide -> Act)
- Advisory mode suggests actions with detailed explanations and waits for user confirmation
- Auto mode executes within risk parameters and logs every decision
- Natural language commands like "swap 10 SOL to USDC" are parsed into structured actions
- Every agent event is emitted for CLI/dashboard consumption

## Context

- **Integration point**: This package is at the TOP of the dependency tree. It depends on `@makora/data-feed`, `@makora/strategy-engine` (Plan 07), `@makora/risk-manager` (Plan 06), `@makora/execution-engine` (Plan 05), and `@makora/protocol-router` (Plan 05).
- **Event system**: The agent emits `AgentEvent` (defined in `@makora/types/agent.ts`) for every state change. CLI and dashboard subscribe to these events.
- **OODA loop**: The core pattern is Observe (fetch data) -> Orient (analyze market + evaluate strategy) -> Decide (select actions, risk-validate) -> Act (execute or present to user).
- **Mode switching**: Advisory is default. Auto mode is opt-in and requires explicit risk parameter confirmation. Mode is stored on-chain in the vault PDA.
- **NL parser**: Pattern-matching-based parser (no LLM dependency). Handles a fixed set of intent patterns covering swap, stake, unstake, portfolio queries, and strategy commands.
- **Decision log**: Every OODA cycle is recorded with full rationale for auditability. This feeds the "Most Agentic" judging criteria.

## Tasks

### Task 1: Package Setup

**File: `P:\solana-agent-hackathon\packages\agent-core\package.json`**

```json
{
  "name": "@makora/agent-core",
  "version": "0.1.0",
  "private": true,
  "description": "Agent core for Makora - OODA loop, advisory/auto modes, NL parser, decision engine",
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
    "@makora/data-feed": "workspace:*",
    "@makora/strategy-engine": "workspace:*",
    "@makora/risk-manager": "workspace:*",
    "@makora/execution-engine": "workspace:*",
    "@makora/protocol-router": "workspace:*",
    "@solana/web3.js": "^1.98.4"
  },
  "devDependencies": {
    "tsup": "^8.0.1",
    "typescript": "^5.3.0",
    "rimraf": "^5.0.0",
    "vitest": "^4.0.17"
  }
}
```

**File: `P:\solana-agent-hackathon\packages\agent-core\tsconfig.json`**

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

### Task 2: Internal Types

**File: `P:\solana-agent-hackathon\packages\agent-core\src\types.ts`**

```typescript
import type { Connection, Keypair, PublicKey } from '@solana/web3.js';
import type {
  AgentMode,
  OODAPhase,
  PortfolioState,
  RiskLimits,
  SolanaCluster,
} from '@makora/types';
import type {
  AgentEvent,
  AgentEventHandler,
  DecisionCycleResult,
  ProposedAction,
  ValidatedAction,
  MarketData,
} from '@makora/types';
import type { StrategyEvaluation } from '@makora/strategy-engine';

// ============================================================================
// Agent Configuration
// ============================================================================

/** Full agent configuration */
export interface AgentConfig {
  /** Solana connection */
  connection: Connection;
  /** Agent's signing keypair */
  signer: Keypair;
  /** Wallet public key to manage */
  walletPublicKey: PublicKey;
  /** Solana cluster */
  cluster: SolanaCluster;
  /** Initial agent mode */
  mode: AgentMode;
  /** Risk limits */
  riskLimits: RiskLimits;
  /** OODA loop interval in ms (how often to run a cycle) */
  cycleIntervalMs: number;
  /** Whether to auto-start the OODA loop */
  autoStart: boolean;
  /** RPC URL */
  rpcUrl: string;
}

/** Default agent configuration */
export const DEFAULT_AGENT_CONFIG: Omit<AgentConfig, 'connection' | 'signer' | 'walletPublicKey' | 'rpcUrl'> = {
  cluster: 'devnet',
  mode: 'advisory',
  riskLimits: {
    maxPositionSizePct: 25,
    maxSlippageBps: 100,
    maxDailyLossPct: 5,
    minSolReserve: 0.05,
    maxProtocolExposurePct: 50,
  },
  cycleIntervalMs: 30_000, // 30 seconds
  autoStart: false,
};

// ============================================================================
// NL Parser Types
// ============================================================================

/** Parsed user intent from natural language */
export type ParsedIntent =
  | { type: 'swap'; amount: number; amountIsPercent: boolean; fromToken: string; toToken: string }
  | { type: 'stake'; amount: number; amountIsPercent: boolean; token: string }
  | { type: 'unstake'; amount: number; amountIsPercent: boolean; token: string }
  | { type: 'portfolio'; query: 'status' | 'allocation' | 'history' }
  | { type: 'strategy'; query: 'current' | 'opportunities' | 'rebalance' }
  | { type: 'mode'; mode: AgentMode }
  | { type: 'help' }
  | { type: 'unknown'; rawInput: string };

// ============================================================================
// User Confirmation Types
// ============================================================================

/** Callback for requesting user confirmation (advisory mode) */
export type ConfirmationCallback = (
  actions: ValidatedAction[],
  explanation: string,
) => Promise<boolean>;

/** No-op confirmation that always approves (for auto mode testing) */
export const AUTO_CONFIRM: ConfirmationCallback = async () => true;

/** No-op confirmation that always rejects (for testing) */
export const ALWAYS_REJECT: ConfirmationCallback = async () => false;

// ============================================================================
// Decision Log Types
// ============================================================================

/** A single logged decision cycle entry */
export interface DecisionLogEntry {
  /** Unique cycle ID */
  cycleId: string;
  /** Timestamp */
  timestamp: number;
  /** Agent mode at the time */
  mode: AgentMode;
  /** OODA phase durations in ms */
  phaseDurations: {
    observe: number;
    orient: number;
    decide: number;
    act: number;
    total: number;
  };
  /** Portfolio snapshot at observation */
  portfolioSnapshot: {
    totalValueUsd: number;
    solBalance: number;
    tokenCount: number;
  };
  /** Market condition summary */
  marketSummary: string;
  /** Strategy evaluation summary */
  strategySummary: string;
  /** Actions proposed */
  proposedActions: Array<{
    id: string;
    type: string;
    protocol: string;
    description: string;
  }>;
  /** Actions approved by risk manager */
  approvedActions: Array<{
    id: string;
    riskScore: number;
    summary: string;
  }>;
  /** Actions rejected by risk manager */
  rejectedActions: Array<{
    id: string;
    reason: string;
  }>;
  /** Actions executed (auto mode only) */
  executedActions: Array<{
    id: string;
    success: boolean;
    signature?: string;
    error?: string;
  }>;
  /** Whether user confirmed (advisory mode only) */
  userConfirmed?: boolean;
  /** Full decision rationale */
  rationale: string;
}
```

### Task 3: Natural Language Parser

Pattern-based parser for DeFi commands. No LLM dependency -- deterministic and fast.

**File: `P:\solana-agent-hackathon\packages\agent-core\src\nl-parser.ts`**

```typescript
import type { ParsedIntent } from './types.js';

/**
 * Natural Language Parser (AGENT-03)
 *
 * Parses natural language commands into structured intents.
 * Pattern-matching based -- no LLM dependency, deterministic, <1ms.
 *
 * Supported patterns:
 * - "swap 10 SOL to USDC" -> swap action
 * - "swap 50% of my SOL to USDC" -> swap with percentage
 * - "stake 5 SOL" -> stake action
 * - "stake 50% of my SOL" -> stake with percentage
 * - "unstake 3 mSOL" / "unstake all mSOL" -> unstake action
 * - "show my portfolio" / "status" / "balance" -> portfolio query
 * - "show strategy" / "opportunities" / "yield" -> strategy query
 * - "rebalance" / "rebalance my portfolio" -> rebalance intent
 * - "auto mode on" / "switch to advisory" -> mode switch
 * - "help" -> help intent
 *
 * Token symbols are case-insensitive: sol, SOL, Sol all work.
 * Amounts accept decimals: "1.5 SOL", "0.1 SOL".
 */
export class NLParser {
  /**
   * Parse a natural language command into a structured intent.
   */
  parse(input: string): ParsedIntent {
    const normalized = input.trim().toLowerCase();

    // Try each pattern in order of specificity
    return (
      this.trySwap(normalized) ??
      this.tryStake(normalized) ??
      this.tryUnstake(normalized) ??
      this.tryPortfolioQuery(normalized) ??
      this.tryStrategyQuery(normalized) ??
      this.tryModeSwitch(normalized) ??
      this.tryHelp(normalized) ??
      { type: 'unknown', rawInput: input }
    );
  }

  /**
   * Check if the input is a recognized command.
   */
  isRecognized(input: string): boolean {
    return this.parse(input).type !== 'unknown';
  }

  /**
   * Get a list of example commands for help display.
   */
  getExamples(): string[] {
    return [
      'swap 10 SOL to USDC',
      'swap 50% of my SOL to USDC',
      'stake 5 SOL',
      'stake 50% of my SOL',
      'unstake 3 mSOL',
      'unstake all mSOL',
      'show my portfolio',
      'show strategy',
      'show yield opportunities',
      'rebalance my portfolio',
      'switch to auto mode',
      'switch to advisory mode',
      'help',
    ];
  }

  // ---- Pattern matchers ----

  private trySwap(input: string): ParsedIntent | null {
    // Pattern: swap {amount} {from} to/for {to}
    // Pattern: swap {percent}% [of my] {from} to/for {to}
    // Pattern: convert {amount} {from} to {to}
    // Pattern: exchange {amount} {from} for {to}
    // Pattern: buy {amount} {to} with {from}

    // Percentage swap: "swap 50% of my SOL to USDC"
    const pctMatch = input.match(
      /(?:swap|convert|exchange)\s+(\d+(?:\.\d+)?)\s*%\s*(?:of\s+(?:my\s+)?)?(\w+)\s+(?:to|for|into)\s+(\w+)/i
    );
    if (pctMatch) {
      return {
        type: 'swap',
        amount: parseFloat(pctMatch[1]),
        amountIsPercent: true,
        fromToken: pctMatch[2].toUpperCase(),
        toToken: pctMatch[3].toUpperCase(),
      };
    }

    // Absolute swap: "swap 10 SOL to USDC"
    const absMatch = input.match(
      /(?:swap|convert|exchange)\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(?:to|for|into)\s+(\w+)/i
    );
    if (absMatch) {
      return {
        type: 'swap',
        amount: parseFloat(absMatch[1]),
        amountIsPercent: false,
        fromToken: absMatch[2].toUpperCase(),
        toToken: absMatch[3].toUpperCase(),
      };
    }

    // Buy pattern: "buy 100 USDC with SOL"
    const buyMatch = input.match(
      /buy\s+(\d+(?:\.\d+)?)\s+(\w+)\s+(?:with|using)\s+(\w+)/i
    );
    if (buyMatch) {
      return {
        type: 'swap',
        amount: parseFloat(buyMatch[1]),
        amountIsPercent: false,
        fromToken: buyMatch[3].toUpperCase(),
        toToken: buyMatch[2].toUpperCase(),
      };
    }

    return null;
  }

  private tryStake(input: string): ParsedIntent | null {
    // Pattern: stake {amount} SOL
    // Pattern: stake {percent}% [of my] SOL
    // Pattern: stake all [my] SOL

    // "stake all SOL"
    if (/(?:stake)\s+all\s+(?:my\s+)?sol/i.test(input)) {
      return {
        type: 'stake',
        amount: 100,
        amountIsPercent: true,
        token: 'SOL',
      };
    }

    // "stake 50% of my SOL"
    const pctMatch = input.match(
      /(?:stake)\s+(\d+(?:\.\d+)?)\s*%\s*(?:of\s+(?:my\s+)?)?(\w+)/i
    );
    if (pctMatch) {
      return {
        type: 'stake',
        amount: parseFloat(pctMatch[1]),
        amountIsPercent: true,
        token: pctMatch[2].toUpperCase(),
      };
    }

    // "stake 5 SOL"
    const absMatch = input.match(
      /(?:stake)\s+(\d+(?:\.\d+)?)\s+(\w+)/i
    );
    if (absMatch) {
      return {
        type: 'stake',
        amount: parseFloat(absMatch[1]),
        amountIsPercent: false,
        token: absMatch[2].toUpperCase(),
      };
    }

    return null;
  }

  private tryUnstake(input: string): ParsedIntent | null {
    // Pattern: unstake {amount} mSOL
    // Pattern: unstake all [my] mSOL

    // "unstake all mSOL"
    if (/(?:unstake|withdraw)\s+all\s+(?:my\s+)?msol/i.test(input)) {
      return {
        type: 'unstake',
        amount: 100,
        amountIsPercent: true,
        token: 'MSOL',
      };
    }

    // "unstake 50% of my mSOL"
    const pctMatch = input.match(
      /(?:unstake|withdraw)\s+(\d+(?:\.\d+)?)\s*%\s*(?:of\s+(?:my\s+)?)?(\w+)/i
    );
    if (pctMatch) {
      return {
        type: 'unstake',
        amount: parseFloat(pctMatch[1]),
        amountIsPercent: true,
        token: pctMatch[2].toUpperCase(),
      };
    }

    // "unstake 3 mSOL"
    const absMatch = input.match(
      /(?:unstake|withdraw)\s+(\d+(?:\.\d+)?)\s+(\w+)/i
    );
    if (absMatch) {
      return {
        type: 'unstake',
        amount: parseFloat(absMatch[1]),
        amountIsPercent: false,
        token: absMatch[2].toUpperCase(),
      };
    }

    return null;
  }

  private tryPortfolioQuery(input: string): ParsedIntent | null {
    // Portfolio status
    if (/(?:show|display|get|view|check)\s+(?:my\s+)?(?:portfolio|balance|status|holdings|wallet)/i.test(input)) {
      return { type: 'portfolio', query: 'status' };
    }
    if (/^(?:status|balance|portfolio|holdings)$/i.test(input)) {
      return { type: 'portfolio', query: 'status' };
    }

    // Allocation
    if (/(?:show|display|get|view)\s+(?:my\s+)?(?:allocation|distribution)/i.test(input)) {
      return { type: 'portfolio', query: 'allocation' };
    }

    // History
    if (/(?:show|display|get|view)\s+(?:my\s+)?(?:history|transactions|activity)/i.test(input)) {
      return { type: 'portfolio', query: 'history' };
    }

    return null;
  }

  private tryStrategyQuery(input: string): ParsedIntent | null {
    // Strategy info
    if (/(?:show|display|get|view|what)\s+(?:is\s+)?(?:my\s+)?(?:current\s+)?strategy/i.test(input)) {
      return { type: 'strategy', query: 'current' };
    }

    // Yield opportunities
    if (/(?:show|display|find|get|view)\s+(?:yield\s+)?(?:opportunities|yields|apy|rates)/i.test(input)) {
      return { type: 'strategy', query: 'opportunities' };
    }

    // Rebalance
    if (/(?:rebalance|rebal)\s*(?:my\s+)?(?:portfolio)?/i.test(input)) {
      return { type: 'strategy', query: 'rebalance' };
    }

    return null;
  }

  private tryModeSwitch(input: string): ParsedIntent | null {
    // Auto mode
    if (/(?:switch|change|set|enable|turn)\s+(?:to\s+)?auto\s*(?:mode)?/i.test(input)) {
      return { type: 'mode', mode: 'auto' };
    }
    if (/auto\s+(?:mode\s+)?on/i.test(input)) {
      return { type: 'mode', mode: 'auto' };
    }

    // Advisory mode
    if (/(?:switch|change|set|enable|turn)\s+(?:to\s+)?advisory\s*(?:mode)?/i.test(input)) {
      return { type: 'mode', mode: 'advisory' };
    }
    if (/(?:auto\s+(?:mode\s+)?off|disable\s+auto)/i.test(input)) {
      return { type: 'mode', mode: 'advisory' };
    }

    return null;
  }

  private tryHelp(input: string): ParsedIntent | null {
    if (/^(?:help|commands|\?|what can you do|how do i)$/i.test(input)) {
      return { type: 'help' };
    }
    return null;
  }
}
```

### Task 4: Action Explainer

Generates human-readable explanations for proposed actions (AGENT-05).

**File: `P:\solana-agent-hackathon\packages\agent-core\src\explainer.ts`**

```typescript
import type {
  ProposedAction,
  ValidatedAction,
  RiskAssessment,
  PortfolioState,
} from '@makora/types';
import type { StrategySignal, YieldOpportunity } from '@makora/types';
import type { StrategyEvaluation } from '@makora/strategy-engine';
import type { MarketCondition } from '@makora/strategy-engine';

/**
 * Action Explainer (AGENT-05)
 *
 * Generates clear, human-readable explanations for every agent suggestion.
 * Each explanation includes:
 * 1. WHAT: What action is being proposed
 * 2. WHY: Why this action is recommended right now
 * 3. OUTCOME: What the expected result is
 * 4. RISK: What could go wrong
 * 5. NUMBERS: Expected yield, risk score, amounts
 */
export class ActionExplainer {
  /**
   * Generate a full explanation for an advisory-mode suggestion.
   */
  explainSuggestion(
    signal: StrategySignal,
    evaluation: StrategyEvaluation,
    portfolio: PortfolioState,
  ): string {
    const sections: string[] = [];

    // Header
    sections.push(`Strategy: ${signal.strategyName} (${signal.type})`);
    sections.push(`Confidence: ${signal.confidence}/100`);
    sections.push('');

    // Market context
    sections.push(`Market Context:`);
    sections.push(`  ${evaluation.marketCondition.summary}`);
    sections.push('');

    // Portfolio context
    sections.push(`Your Portfolio:`);
    sections.push(`  Total Value: $${portfolio.totalValueUsd.toFixed(2)}`);
    sections.push(`  SOL Balance: ${portfolio.solBalance.toFixed(4)} SOL`);
    sections.push('');

    // Actions
    if (signal.actions.length === 0) {
      sections.push(`Recommendation: No action needed. Portfolio is well-positioned.`);
    } else {
      sections.push(`Proposed Actions (${signal.actions.length}):`);
      sections.push('');

      for (let i = 0; i < signal.actions.length; i++) {
        const action = signal.actions[i];
        sections.push(`  ${i + 1}. ${action.description}`);
        sections.push(`     Why: ${action.rationale}`);
        sections.push(`     Expected: ${action.expectedOutcome}`);
        sections.push('');
      }
    }

    // Expected outcome
    if (signal.expectedApy && signal.expectedApy > 0) {
      sections.push(`Expected APY: ${signal.expectedApy.toFixed(1)}%`);
    }
    sections.push(`Risk Score: ${signal.riskScore}/100`);

    // Strategy explanation
    sections.push('');
    sections.push(`Analysis: ${signal.explanation}`);

    return sections.join('\n');
  }

  /**
   * Generate a compact one-line explanation for a single action.
   */
  explainAction(action: ProposedAction): string {
    return `${action.description} -- ${action.rationale}`;
  }

  /**
   * Generate an explanation for a risk rejection.
   */
  explainRejection(action: ProposedAction, assessment: RiskAssessment): string {
    const sections: string[] = [];

    sections.push(`REJECTED: ${action.description}`);
    sections.push(`Reason: ${assessment.summary}`);
    sections.push('');
    sections.push(`Risk Checks:`);

    for (const check of assessment.checks) {
      const icon = check.passed ? 'PASS' : 'FAIL';
      sections.push(`  [${icon}] ${check.name}: ${check.message}`);
    }

    return sections.join('\n');
  }

  /**
   * Generate an explanation for an auto-mode execution.
   */
  explainAutoExecution(
    action: ValidatedAction,
    success: boolean,
    signature?: string,
    error?: string,
  ): string {
    if (success) {
      return (
        `AUTO EXECUTED: ${action.description}\n` +
        `Rationale: ${action.rationale}\n` +
        `Risk Score: ${action.riskAssessment.riskScore}/100\n` +
        `TX: ${signature ?? 'N/A'}`
      );
    } else {
      return (
        `AUTO EXECUTION FAILED: ${action.description}\n` +
        `Error: ${error ?? 'Unknown error'}\n` +
        `The action was approved by the risk manager but failed on-chain.`
      );
    }
  }

  /**
   * Generate a cycle summary for the decision log.
   */
  explainCycle(
    mode: string,
    marketSummary: string,
    proposed: number,
    approved: number,
    rejected: number,
    executed: number,
    durationMs: number,
  ): string {
    return (
      `OODA Cycle Complete (${mode} mode, ${durationMs}ms)\n` +
      `Market: ${marketSummary}\n` +
      `Actions: ${proposed} proposed, ${approved} approved, ${rejected} rejected, ${executed} executed`
    );
  }
}
```

### Task 5: Decision Log

Records every OODA cycle for auditability and "Most Agentic" judging.

**File: `P:\solana-agent-hackathon\packages\agent-core\src\decision-log.ts`**

```typescript
import type { DecisionLogEntry } from './types.js';

/**
 * Decision Log
 *
 * Records every OODA cycle with full decision rationale.
 * This is critical for:
 * 1. "Most Agentic" judging criteria -- proves autonomous decision-making
 * 2. Dashboard transaction history -- human-readable log
 * 3. Debugging -- trace why the agent did something
 *
 * Stores the last N entries in memory. For hackathon, no persistence
 * beyond the process lifetime (real product would use a DB).
 */
export class DecisionLog {
  private entries: DecisionLogEntry[] = [];
  private maxEntries: number;

  constructor(maxEntries: number = 500) {
    this.maxEntries = maxEntries;
  }

  /**
   * Record a new cycle entry.
   */
  record(entry: DecisionLogEntry): void {
    this.entries.push(entry);

    // Trim old entries if over limit
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }
  }

  /**
   * Get the last N entries (most recent first).
   */
  getRecent(count: number = 20): DecisionLogEntry[] {
    return this.entries.slice(-count).reverse();
  }

  /**
   * Get all entries.
   */
  getAll(): DecisionLogEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries that resulted in executed actions.
   */
  getExecutedCycles(): DecisionLogEntry[] {
    return this.entries.filter((e) => e.executedActions.length > 0);
  }

  /**
   * Get entries where the risk manager rejected actions.
   */
  getRejectedCycles(): DecisionLogEntry[] {
    return this.entries.filter((e) => e.rejectedActions.length > 0);
  }

  /**
   * Get the total number of cycles recorded.
   */
  get totalCycles(): number {
    return this.entries.length;
  }

  /**
   * Get summary statistics.
   */
  getStats(): {
    totalCycles: number;
    totalActionsProposed: number;
    totalActionsApproved: number;
    totalActionsRejected: number;
    totalActionsExecuted: number;
    avgCycleTimeMs: number;
  } {
    let totalProposed = 0;
    let totalApproved = 0;
    let totalRejected = 0;
    let totalExecuted = 0;
    let totalCycleTime = 0;

    for (const entry of this.entries) {
      totalProposed += entry.proposedActions.length;
      totalApproved += entry.approvedActions.length;
      totalRejected += entry.rejectedActions.length;
      totalExecuted += entry.executedActions.length;
      totalCycleTime += entry.phaseDurations.total;
    }

    return {
      totalCycles: this.entries.length,
      totalActionsProposed: totalProposed,
      totalActionsApproved: totalApproved,
      totalActionsRejected: totalRejected,
      totalActionsExecuted: totalExecuted,
      avgCycleTimeMs: this.entries.length > 0
        ? Math.round(totalCycleTime / this.entries.length)
        : 0,
    };
  }

  /**
   * Export the log as a JSON-serializable array.
   */
  export(): DecisionLogEntry[] {
    return [...this.entries];
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries = [];
  }
}
```

### Task 6: OODA Loop

The core decision loop that drives the agent.

**File: `P:\solana-agent-hackathon\packages\agent-core\src\ooda-loop.ts`**

```typescript
import { randomUUID } from 'crypto';
import type { PublicKey, Keypair, Connection } from '@solana/web3.js';
import type {
  AgentMode,
  OODAPhase,
  PortfolioState,
  ExecutionResult,
  RiskAssessment,
  Position,
} from '@makora/types';
import type {
  AgentEvent,
  AgentEventHandler,
  DecisionCycleResult,
  ProposedAction,
  ValidatedAction,
  MarketData,
} from '@makora/types';
import type { StrategySignal } from '@makora/types';

import { PortfolioReader } from '@makora/data-feed';
import { JupiterPriceFeed } from '@makora/data-feed';
import { StrategyEngine, type StrategyEvaluation } from '@makora/strategy-engine';
import { RiskManager } from '@makora/risk-manager';
import { ExecutionEngine } from '@makora/execution-engine';
import { ProtocolRouter, type RouteRequest } from '@makora/protocol-router';

import { ActionExplainer } from './explainer.js';
import { DecisionLog } from './decision-log.js';
import type { ConfirmationCallback, DecisionLogEntry } from './types.js';

/**
 * OODA Loop (AGENT-04)
 *
 * The core decision cycle: Observe -> Orient -> Decide -> Act
 *
 * - OBSERVE: Fetch portfolio state, market data, positions
 * - ORIENT: Analyze market conditions, evaluate strategies
 * - DECIDE: Select best strategy signal, validate actions through risk manager
 * - ACT: Execute (auto mode) or present to user (advisory mode)
 *
 * The loop runs continuously on a timer. Each cycle is independent.
 * The loop can be paused, resumed, or run as a single cycle.
 */
export class OODALoop {
  // Dependencies
  private portfolioReader: PortfolioReader;
  private priceFeed: JupiterPriceFeed;
  private strategyEngine: StrategyEngine;
  private riskManager: RiskManager;
  private executionEngine: ExecutionEngine;
  private router: ProtocolRouter;
  private explainer: ActionExplainer;
  private decisionLog: DecisionLog;

  // State
  private walletPublicKey: PublicKey;
  private signer: Keypair;
  private mode: AgentMode;
  private currentPhase: OODAPhase = 'observe';
  private isRunning = false;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private cycleIntervalMs: number;

  // Cached state from last observation
  private lastPortfolio: PortfolioState | null = null;
  private lastMarketData: MarketData | null = null;
  private lastEvaluation: StrategyEvaluation | null = null;

  // Callbacks
  private eventHandlers: AgentEventHandler[] = [];
  private confirmationCallback: ConfirmationCallback | null = null;

  constructor(
    walletPublicKey: PublicKey,
    signer: Keypair,
    mode: AgentMode,
    cycleIntervalMs: number,
    portfolioReader: PortfolioReader,
    priceFeed: JupiterPriceFeed,
    strategyEngine: StrategyEngine,
    riskManager: RiskManager,
    executionEngine: ExecutionEngine,
    router: ProtocolRouter,
  ) {
    this.walletPublicKey = walletPublicKey;
    this.signer = signer;
    this.mode = mode;
    this.cycleIntervalMs = cycleIntervalMs;
    this.portfolioReader = portfolioReader;
    this.priceFeed = priceFeed;
    this.strategyEngine = strategyEngine;
    this.riskManager = riskManager;
    this.executionEngine = executionEngine;
    this.router = router;
    this.explainer = new ActionExplainer();
    this.decisionLog = new DecisionLog();
  }

  /**
   * Run a single OODA cycle. Returns the cycle result.
   *
   * This is the core method. The continuous loop calls this on each tick.
   * Can also be called directly for single-shot evaluation.
   */
  async runCycle(): Promise<DecisionCycleResult> {
    const cycleStart = Date.now();
    const cycleId = randomUUID();
    const phaseTimings: Record<string, number> = {};

    let proposedActions: ProposedAction[] = [];
    let approvedActions: ValidatedAction[] = [];
    let rejectedActions: ValidatedAction[] = [];
    let executionResults: ExecutionResult[] = [];
    let evaluation: StrategyEvaluation | null = null;

    try {
      // ====== OBSERVE ======
      this.setPhase('observe');
      const observeStart = Date.now();

      const portfolio = await this.portfolioReader.getPortfolio(this.walletPublicKey);
      this.lastPortfolio = portfolio;

      // Build market data from price feed
      const solPrice = await this.priceFeed.getPrice(this.walletPublicKey); // Will be null, use portfolio
      const marketData = this.buildMarketData(portfolio);
      this.lastMarketData = marketData;

      // Update risk manager with fresh portfolio
      this.riskManager.updatePortfolio(portfolio);

      // Fetch positions from all protocols
      const positions = await this.router.getAllPositions(this.walletPublicKey);
      this.riskManager.updatePositions(positions);

      phaseTimings.observe = Date.now() - observeStart;

      // ====== ORIENT ======
      this.setPhase('orient');
      const orientStart = Date.now();

      evaluation = this.strategyEngine.evaluate(portfolio, marketData);
      this.lastEvaluation = evaluation;

      phaseTimings.orient = Date.now() - orientStart;

      // ====== DECIDE ======
      this.setPhase('decide');
      const decideStart = Date.now();

      // Get the recommended signal
      const signal = evaluation.recommended;
      proposedActions = signal.actions;

      // Emit proposed actions
      for (const action of proposedActions) {
        this.emit({ type: 'action_proposed', action });
      }

      // Validate each action through risk manager
      for (const action of proposedActions) {
        const assessment = await this.riskManager.validate(action);
        const validated: ValidatedAction = {
          ...action,
          riskAssessment: assessment,
          approved: assessment.approved,
        };

        if (assessment.approved) {
          approvedActions.push(validated);
          this.emit({ type: 'action_approved', action: validated });
        } else {
          rejectedActions.push(validated);
          this.emit({
            type: 'action_rejected',
            action: validated,
            reason: assessment.summary,
          });
        }
      }

      phaseTimings.decide = Date.now() - decideStart;

      // ====== ACT ======
      this.setPhase('act');
      const actStart = Date.now();

      if (approvedActions.length > 0) {
        if (this.mode === 'auto') {
          // Auto mode: execute immediately
          executionResults = await this.executeActions(approvedActions, portfolio);
        } else {
          // Advisory mode: present to user and wait for confirmation
          if (this.confirmationCallback) {
            const explanation = this.explainer.explainSuggestion(
              signal,
              evaluation,
              portfolio,
            );

            const confirmed = await this.confirmationCallback(approvedActions, explanation);

            if (confirmed) {
              executionResults = await this.executeActions(approvedActions, portfolio);
            }
          }
          // If no confirmation callback, actions are just presented (no execution)
        }
      }

      phaseTimings.act = Date.now() - actStart;

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this.emit({ type: 'error', message: `OODA cycle failed: ${errorMessage}`, details: err });
    }

    const totalTime = Date.now() - cycleStart;

    // Build cycle result
    const result: DecisionCycleResult = {
      phase: this.currentPhase,
      proposedActions,
      approvedActions,
      rejectedActions,
      executionResults: executionResults.length > 0 ? executionResults : undefined,
      cycleTimeMs: totalTime,
      timestamp: Date.now(),
    };

    // Log the cycle
    this.logCycle(cycleId, result, evaluation, phaseTimings, totalTime);

    // Emit cycle completed
    this.emit({ type: 'cycle_completed', result });

    return result;
  }

  /**
   * Start the continuous OODA loop.
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    // Run first cycle immediately
    this.runCycle().catch((err) => {
      this.emit({ type: 'error', message: `Cycle error: ${err}` });
    });

    // Then run on interval
    this.intervalHandle = setInterval(() => {
      if (this.isRunning) {
        this.runCycle().catch((err) => {
          this.emit({ type: 'error', message: `Cycle error: ${err}` });
        });
      }
    }, this.cycleIntervalMs);
  }

  /**
   * Stop the continuous OODA loop.
   */
  stop(): void {
    this.isRunning = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Get current OODA phase.
   */
  getPhase(): OODAPhase {
    return this.currentPhase;
  }

  /**
   * Get whether the loop is running.
   */
  getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get the decision log.
   */
  getDecisionLog(): DecisionLog {
    return this.decisionLog;
  }

  /**
   * Get last portfolio snapshot.
   */
  getLastPortfolio(): PortfolioState | null {
    return this.lastPortfolio;
  }

  /**
   * Get last market data.
   */
  getLastMarketData(): MarketData | null {
    return this.lastMarketData;
  }

  /**
   * Get last strategy evaluation.
   */
  getLastEvaluation(): StrategyEvaluation | null {
    return this.lastEvaluation;
  }

  /**
   * Set the agent mode.
   */
  setMode(mode: AgentMode): void {
    this.mode = mode;
    this.emit({ type: 'mode_changed', mode });
  }

  /**
   * Get the agent mode.
   */
  getMode(): AgentMode {
    return this.mode;
  }

  /**
   * Register an event handler.
   */
  onEvent(handler: AgentEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Set the confirmation callback for advisory mode.
   */
  setConfirmationCallback(callback: ConfirmationCallback): void {
    this.confirmationCallback = callback;
  }

  // ---- Private ----

  private setPhase(phase: OODAPhase): void {
    this.currentPhase = phase;
    this.emit({ type: 'cycle_started', phase });
  }

  private emit(event: AgentEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch (err) {
        console.warn('Event handler error:', err);
      }
    }
  }

  /**
   * Build a MarketData object from the current portfolio and price feed.
   * In production, this would also use Pyth WebSocket data.
   */
  private buildMarketData(portfolio: PortfolioState): MarketData {
    const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');
    const solPrice = solBalance?.priceUsd ?? 0;

    // Build prices map from portfolio
    const prices = new Map<string, number>();
    for (const balance of portfolio.balances) {
      if (balance.priceUsd > 0) {
        prices.set(balance.token.mint.toBase58(), balance.priceUsd);
      }
    }

    return {
      solPriceUsd: solPrice,
      solChange24hPct: 0, // Would come from a historical price API
      volatilityIndex: 30, // Default moderate; would come from Pyth or computed
      totalTvlUsd: 0, // Would come from protocol APIs
      timestamp: Date.now(),
      prices,
    };
  }

  /**
   * Execute a list of approved actions.
   */
  private async executeActions(
    actions: ValidatedAction[],
    prePortfolio: PortfolioState,
  ): Promise<ExecutionResult[]> {
    const results: ExecutionResult[] = [];

    for (const action of actions) {
      try {
        // Route the action to get instructions
        const routeRequest: RouteRequest = {
          actionType: action.type,
          protocol: action.protocol,
          params: this.buildRouteParams(action),
        };

        const routeResult = await this.router.route(routeRequest);

        // Execute via the execution engine
        const result = await this.executionEngine.execute({
          instructions: routeResult.instructions,
          signer: this.signer,
          description: action.description,
          action,
        });

        results.push(result);

        // Record execution in risk manager
        const postPortfolio = await this.portfolioReader.getPortfolio(this.walletPublicKey);
        this.riskManager.recordExecution(
          result,
          prePortfolio.totalValueUsd,
          postPortfolio.totalValueUsd,
        );

        // Emit execution event
        this.emit({ type: 'action_executed', action, result });

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const failResult: ExecutionResult = {
          success: false,
          error: errorMsg,
          timestamp: Date.now(),
        };
        results.push(failResult);
        this.emit({ type: 'action_executed', action, result: failResult });
      }
    }

    return results;
  }

  /**
   * Build RouteRequest params from a ProposedAction.
   * Maps the action's token/amount fields into the adapter's expected params.
   */
  private buildRouteParams(action: ProposedAction): RouteRequest['params'] {
    switch (action.type) {
      case 'swap':
        return {
          inputToken: action.inputToken.mint,
          outputToken: action.outputToken!.mint,
          amount: action.amount,
          maxSlippageBps: action.maxSlippageBps,
          userPublicKey: this.walletPublicKey,
        };

      case 'stake':
      case 'unstake':
        return {
          amount: action.amount,
          userPublicKey: this.walletPublicKey,
        };

      case 'deposit':
      case 'provide_liquidity':
        return {
          token: action.inputToken.mint,
          amount: action.amount,
          destination: action.outputToken?.mint ?? action.inputToken.mint,
          userPublicKey: this.walletPublicKey,
        };

      case 'withdraw':
      case 'remove_liquidity':
        return {
          token: action.inputToken.mint,
          amount: action.amount,
          source: action.outputToken?.mint ?? action.inputToken.mint,
          userPublicKey: this.walletPublicKey,
        };

      default:
        return {
          amount: action.amount,
          userPublicKey: this.walletPublicKey,
        };
    }
  }

  /**
   * Log a cycle to the decision log.
   */
  private logCycle(
    cycleId: string,
    result: DecisionCycleResult,
    evaluation: StrategyEvaluation | null,
    phaseTimings: Record<string, number>,
    totalTime: number,
  ): void {
    const entry: DecisionLogEntry = {
      cycleId,
      timestamp: Date.now(),
      mode: this.mode,
      phaseDurations: {
        observe: phaseTimings.observe ?? 0,
        orient: phaseTimings.orient ?? 0,
        decide: phaseTimings.decide ?? 0,
        act: phaseTimings.act ?? 0,
        total: totalTime,
      },
      portfolioSnapshot: {
        totalValueUsd: this.lastPortfolio?.totalValueUsd ?? 0,
        solBalance: this.lastPortfolio?.solBalance ?? 0,
        tokenCount: this.lastPortfolio?.balances.length ?? 0,
      },
      marketSummary: evaluation?.marketCondition.summary ?? 'N/A',
      strategySummary: evaluation?.recommended.explanation ?? 'N/A',
      proposedActions: result.proposedActions.map((a) => ({
        id: a.id,
        type: a.type,
        protocol: a.protocol,
        description: a.description,
      })),
      approvedActions: result.approvedActions.map((a) => ({
        id: a.id,
        riskScore: a.riskAssessment.riskScore,
        summary: a.riskAssessment.summary,
      })),
      rejectedActions: result.rejectedActions.map((a) => ({
        id: a.id,
        reason: a.riskAssessment.summary,
      })),
      executedActions: (result.executionResults ?? []).map((r, i) => ({
        id: result.approvedActions[i]?.id ?? `exec-${i}`,
        success: r.success,
        signature: r.signature,
        error: r.error,
      })),
      rationale: this.buildRationale(result, evaluation),
    };

    this.decisionLog.record(entry);
  }

  private buildRationale(
    result: DecisionCycleResult,
    evaluation: StrategyEvaluation | null,
  ): string {
    const parts: string[] = [];

    if (evaluation) {
      parts.push(`Market: ${evaluation.marketCondition.summary}`);
      parts.push(`Strategy: ${evaluation.recommended.strategyName} (confidence: ${evaluation.recommended.confidence}/100)`);
    }

    parts.push(`Proposed: ${result.proposedActions.length} action(s)`);
    parts.push(`Approved: ${result.approvedActions.length}`);
    parts.push(`Rejected: ${result.rejectedActions.length}`);

    if (result.executionResults) {
      const successes = result.executionResults.filter((r) => r.success).length;
      parts.push(`Executed: ${successes}/${result.executionResults.length} succeeded`);
    }

    return parts.join('. ') + '.';
  }
}
```

### Task 7: Main Agent Class

The top-level agent that ties everything together and exposes a clean public API.

**File: `P:\solana-agent-hackathon\packages\agent-core\src\agent.ts`**

```typescript
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import type {
  AgentMode,
  OODAPhase,
  PortfolioState,
  RiskLimits,
} from '@makora/types';
import type {
  AgentEvent,
  AgentEventHandler,
  DecisionCycleResult,
  ProposedAction,
  ValidatedAction,
} from '@makora/types';

import { createConnection, PortfolioReader, JupiterPriceFeed } from '@makora/data-feed';
import { StrategyEngine, type StrategyEvaluation } from '@makora/strategy-engine';
import { RiskManager } from '@makora/risk-manager';
import { ExecutionEngine } from '@makora/execution-engine';
import { ProtocolRouter, AdapterRegistry } from '@makora/protocol-router';

import { OODALoop } from './ooda-loop.js';
import { NLParser } from './nl-parser.js';
import { ActionExplainer } from './explainer.js';
import { DecisionLog } from './decision-log.js';
import type { AgentConfig, ConfirmationCallback, ParsedIntent, DecisionLogEntry } from './types.js';
import { DEFAULT_AGENT_CONFIG } from './types.js';

/**
 * Makora Agent (AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05)
 *
 * The top-level agent class that ties the entire system together.
 * This is the primary interface for CLI and dashboard.
 *
 * Responsibilities:
 * - Initialize all subsystems (data feed, strategy engine, risk manager, etc.)
 * - Run the OODA loop (continuous or single-shot)
 * - Parse natural language commands
 * - Route user commands to the appropriate subsystem
 * - Emit events for external consumers (CLI, dashboard)
 *
 * Usage:
 *   const agent = new MakoraAgent(config);
 *   await agent.initialize(registry);
 *   agent.onEvent((event) => console.log(event));
 *   await agent.start(); // Start OODA loop
 *   // Or:
 *   const result = await agent.executeCommand("swap 10 SOL to USDC");
 */
export class MakoraAgent {
  // Core components
  private connection: Connection;
  private portfolioReader: PortfolioReader;
  private priceFeed: JupiterPriceFeed;
  private strategyEngine: StrategyEngine;
  private riskManager: RiskManager;
  private executionEngine: ExecutionEngine;
  private router!: ProtocolRouter;
  private oodaLoop!: OODALoop;

  // Utilities
  private nlParser: NLParser;
  private explainer: ActionExplainer;

  // Configuration
  private config: AgentConfig;
  private initialized = false;

  constructor(config: AgentConfig) {
    this.config = config;
    this.connection = config.connection;

    // Initialize core components
    this.portfolioReader = new PortfolioReader(this.connection, config.cluster);
    this.priceFeed = new JupiterPriceFeed();
    this.strategyEngine = new StrategyEngine();
    this.riskManager = new RiskManager(0, config.riskLimits);
    this.executionEngine = new ExecutionEngine(this.connection, {}, this.riskManager);

    // Initialize utilities
    this.nlParser = new NLParser();
    this.explainer = new ActionExplainer();
  }

  /**
   * Initialize the agent with a pre-configured adapter registry.
   *
   * The registry must already have adapters registered.
   * This separation allows the CLI/dashboard to configure adapters
   * before passing them to the agent.
   */
  async initialize(registry: AdapterRegistry): Promise<void> {
    if (this.initialized) {
      throw new Error('Agent is already initialized');
    }

    // Initialize the protocol router
    this.router = new ProtocolRouter(registry);

    // Initialize the adapter registry
    await registry.initialize({
      rpcUrl: this.config.rpcUrl,
      walletPublicKey: this.config.walletPublicKey,
    });

    // Wire up the execution engine with the risk manager
    this.executionEngine.setRiskValidator(this.riskManager);

    // Create the OODA loop
    this.oodaLoop = new OODALoop(
      this.config.walletPublicKey,
      this.config.signer,
      this.config.mode,
      this.config.cycleIntervalMs,
      this.portfolioReader,
      this.priceFeed,
      this.strategyEngine,
      this.riskManager,
      this.executionEngine,
      this.router,
    );

    this.initialized = true;
  }

  /**
   * Start the continuous OODA loop.
   */
  start(): void {
    this.ensureInitialized();
    this.oodaLoop.start();
  }

  /**
   * Stop the OODA loop.
   */
  stop(): void {
    this.ensureInitialized();
    this.oodaLoop.stop();
  }

  /**
   * Run a single OODA cycle (without starting the continuous loop).
   */
  async runSingleCycle(): Promise<DecisionCycleResult> {
    this.ensureInitialized();
    return this.oodaLoop.runCycle();
  }

  /**
   * Execute a natural language command.
   *
   * Parses the command, determines the intent, and either:
   * - Executes an action (advisory: present + wait, auto: execute)
   * - Returns query results (portfolio, strategy)
   * - Changes agent configuration (mode switch)
   *
   * @returns A human-readable response string
   */
  async executeCommand(input: string): Promise<string> {
    this.ensureInitialized();

    const intent = this.nlParser.parse(input);

    switch (intent.type) {
      case 'swap':
        return this.handleSwapIntent(intent);
      case 'stake':
        return this.handleStakeIntent(intent);
      case 'unstake':
        return this.handleUnstakeIntent(intent);
      case 'portfolio':
        return this.handlePortfolioQuery(intent);
      case 'strategy':
        return this.handleStrategyQuery(intent);
      case 'mode':
        return this.handleModeSwitch(intent);
      case 'help':
        return this.handleHelp();
      case 'unknown':
        return `I don't understand "${intent.rawInput}". Type "help" for available commands.`;
      default:
        return 'Unrecognized command.';
    }
  }

  /**
   * Parse a natural language command without executing it.
   */
  parseCommand(input: string): ParsedIntent {
    return this.nlParser.parse(input);
  }

  // ---- Mode management ----

  /**
   * Get the current agent mode.
   */
  getMode(): AgentMode {
    return this.oodaLoop?.getMode() ?? this.config.mode;
  }

  /**
   * Set the agent mode.
   */
  setMode(mode: AgentMode): void {
    this.ensureInitialized();
    this.oodaLoop.setMode(mode);
  }

  // ---- Event system ----

  /**
   * Register an event handler.
   */
  onEvent(handler: AgentEventHandler): void {
    if (this.oodaLoop) {
      this.oodaLoop.onEvent(handler);
    }
  }

  /**
   * Set the confirmation callback for advisory mode.
   */
  setConfirmationCallback(callback: ConfirmationCallback): void {
    if (this.oodaLoop) {
      this.oodaLoop.setConfirmationCallback(callback);
    }
  }

  // ---- Accessors ----

  /**
   * Get the current OODA phase.
   */
  getPhase(): OODAPhase {
    return this.oodaLoop?.getPhase() ?? 'observe';
  }

  /**
   * Get whether the OODA loop is running.
   */
  isRunning(): boolean {
    return this.oodaLoop?.getIsRunning() ?? false;
  }

  /**
   * Get the last portfolio state.
   */
  getLastPortfolio(): PortfolioState | null {
    return this.oodaLoop?.getLastPortfolio() ?? null;
  }

  /**
   * Get the last strategy evaluation.
   */
  getLastEvaluation(): StrategyEvaluation | null {
    return this.oodaLoop?.getLastEvaluation() ?? null;
  }

  /**
   * Get the decision log.
   */
  getDecisionLog(): DecisionLog {
    return this.oodaLoop?.getDecisionLog() ?? new DecisionLog();
  }

  /**
   * Get risk manager snapshot.
   */
  getRiskSnapshot() {
    return this.riskManager.getRiskSnapshot();
  }

  /**
   * Update risk limits.
   */
  setRiskLimits(limits: Partial<RiskLimits>): void {
    this.riskManager.setLimits(limits);
  }

  /**
   * Get portfolio directly (without waiting for OODA cycle).
   */
  async getPortfolio(): Promise<PortfolioState> {
    return this.portfolioReader.getPortfolio(this.config.walletPublicKey);
  }

  /**
   * Get the strategy engine.
   */
  getStrategyEngine(): StrategyEngine {
    return this.strategyEngine;
  }

  /**
   * Get the NL parser (for testing/inspection).
   */
  getNLParser(): NLParser {
    return this.nlParser;
  }

  /**
   * Get the explainer.
   */
  getExplainer(): ActionExplainer {
    return this.explainer;
  }

  // ---- Intent handlers ----

  private async handleSwapIntent(
    intent: Extract<ParsedIntent, { type: 'swap' }>
  ): Promise<string> {
    const portfolio = await this.getPortfolio();
    const fromBalance = portfolio.balances.find(
      (b) => b.token.symbol.toUpperCase() === intent.fromToken
    );

    if (!fromBalance) {
      return `You don't have any ${intent.fromToken} in your portfolio.`;
    }

    // Calculate amount
    let rawAmount: bigint;
    if (intent.amountIsPercent) {
      rawAmount = (fromBalance.rawBalance * BigInt(Math.floor(intent.amount))) / 100n;
    } else {
      rawAmount = BigInt(Math.floor(intent.amount * (10 ** fromBalance.token.decimals)));
    }

    if (rawAmount <= 0n) {
      return `Invalid amount for ${intent.fromToken}.`;
    }

    if (rawAmount > fromBalance.rawBalance) {
      return `Insufficient ${intent.fromToken}. You have ${fromBalance.uiBalance.toFixed(4)} ${intent.fromToken}.`;
    }

    // For advisory mode, describe what would happen
    const amountStr = intent.amountIsPercent
      ? `${intent.amount}% of ${intent.fromToken}`
      : `${intent.amount} ${intent.fromToken}`;

    return (
      `Swap: ${amountStr} -> ${intent.toToken}\n` +
      `Protocol: Jupiter (optimal routing)\n` +
      `Amount: ${(Number(rawAmount) / (10 ** fromBalance.token.decimals)).toFixed(4)} ${intent.fromToken}\n` +
      `Slippage: 0.5% max\n` +
      `\nIn advisory mode, run the OODA cycle to get a full strategy evaluation ` +
      `or switch to auto mode for immediate execution.`
    );
  }

  private async handleStakeIntent(
    intent: Extract<ParsedIntent, { type: 'stake' }>
  ): Promise<string> {
    const portfolio = await this.getPortfolio();
    const solBalance = portfolio.balances.find((b) => b.token.symbol === 'SOL');

    if (!solBalance || solBalance.rawBalance <= BigInt(50_000_000)) {
      return 'Insufficient SOL balance for staking (need to keep 0.05 SOL for gas).';
    }

    let rawAmount: bigint;
    if (intent.amountIsPercent) {
      rawAmount = (solBalance.rawBalance * BigInt(Math.floor(intent.amount))) / 100n;
    } else {
      rawAmount = BigInt(Math.floor(intent.amount * 1e9));
    }

    // Reserve gas
    const maxStake = solBalance.rawBalance - BigInt(50_000_000);
    if (rawAmount > maxStake) {
      rawAmount = maxStake;
    }

    const solAmount = Number(rawAmount) / 1e9;

    return (
      `Stake: ${solAmount.toFixed(4)} SOL via Marinade\n` +
      `You will receive: ~${solAmount.toFixed(4)} mSOL\n` +
      `Expected APY: ~7.2%\n` +
      `mSOL is liquid -- you can unstake anytime.\n` +
      `Risk: Very low (liquid staking, audited protocol)`
    );
  }

  private async handleUnstakeIntent(
    intent: Extract<ParsedIntent, { type: 'unstake' }>
  ): Promise<string> {
    const portfolio = await this.getPortfolio();
    const msolBalance = portfolio.balances.find(
      (b) => b.token.symbol.toUpperCase() === 'MSOL'
    );

    if (!msolBalance || msolBalance.rawBalance <= 0n) {
      return 'You don\'t have any mSOL to unstake.';
    }

    let rawAmount: bigint;
    if (intent.amountIsPercent) {
      rawAmount = (msolBalance.rawBalance * BigInt(Math.floor(intent.amount))) / 100n;
    } else {
      rawAmount = BigInt(Math.floor(intent.amount * 1e9));
    }

    if (rawAmount > msolBalance.rawBalance) {
      rawAmount = msolBalance.rawBalance;
    }

    const msolAmount = Number(rawAmount) / 1e9;

    return (
      `Unstake: ${msolAmount.toFixed(4)} mSOL via Marinade\n` +
      `You will receive: ~${msolAmount.toFixed(4)} SOL\n` +
      `Note: Instant unstake may have a small fee (~0.3%).`
    );
  }

  private async handlePortfolioQuery(
    intent: Extract<ParsedIntent, { type: 'portfolio' }>
  ): Promise<string> {
    const portfolio = await this.getPortfolio();
    const lines: string[] = [];

    lines.push(`Portfolio Value: $${portfolio.totalValueUsd.toFixed(2)}`);
    lines.push(`SOL Balance: ${portfolio.solBalance.toFixed(4)} SOL`);
    lines.push('');
    lines.push('Holdings:');

    for (const balance of portfolio.balances) {
      if (balance.uiBalance > 0) {
        lines.push(
          `  ${balance.token.symbol}: ${balance.uiBalance.toFixed(4)} ($${balance.usdValue.toFixed(2)})`
        );
      }
    }

    return lines.join('\n');
  }

  private async handleStrategyQuery(
    intent: Extract<ParsedIntent, { type: 'strategy' }>
  ): Promise<string> {
    if (intent.query === 'current') {
      const evaluation = this.getLastEvaluation();
      if (!evaluation) {
        return 'No strategy evaluation available. Run an OODA cycle first.';
      }

      const signal = evaluation.recommended;
      return (
        `Current Strategy: ${signal.strategyName}\n` +
        `Type: ${signal.type}\n` +
        `Confidence: ${signal.confidence}/100\n` +
        `Expected APY: ${signal.expectedApy?.toFixed(1) ?? 'N/A'}%\n` +
        `Risk Score: ${signal.riskScore}/100\n` +
        `\n${signal.explanation}`
      );
    }

    if (intent.query === 'opportunities') {
      const evaluation = this.getLastEvaluation();
      if (!evaluation || evaluation.yieldOpportunities.length === 0) {
        return 'No yield opportunities available. Run an OODA cycle first.';
      }

      const lines = ['Yield Opportunities:'];
      for (const op of evaluation.yieldOpportunities) {
        lines.push(`  ${op.description}`);
      }
      return lines.join('\n');
    }

    if (intent.query === 'rebalance') {
      const portfolio = await this.getPortfolio();
      const rebalancer = this.strategyEngine.getRebalancer();
      const table = rebalancer.getAllocationTable(portfolio);

      if (table.length === 0) {
        return 'No allocation data available.';
      }

      const lines = ['Portfolio Allocation:'];
      for (const entry of table) {
        const target = entry.targetPct !== undefined ? ` (target: ${entry.targetPct}%)` : '';
        lines.push(
          `  ${entry.token.symbol}: ${entry.currentPct.toFixed(1)}%${target} — $${entry.usdValue.toFixed(2)}`
        );
      }

      const needsRebalance = rebalancer.needsRebalance(portfolio);
      lines.push('');
      lines.push(needsRebalance
        ? 'Rebalancing recommended. Run OODA cycle for specific actions.'
        : 'Portfolio is within target allocation. No rebalancing needed.'
      );

      return lines.join('\n');
    }

    return 'Unknown strategy query.';
  }

  private handleModeSwitch(
    intent: Extract<ParsedIntent, { type: 'mode' }>
  ): string {
    const currentMode = this.getMode();

    if (currentMode === intent.mode) {
      return `Already in ${intent.mode} mode.`;
    }

    this.setMode(intent.mode);

    if (intent.mode === 'auto') {
      return (
        `Switched to AUTO mode.\n` +
        `The agent will now execute approved actions automatically within your risk limits.\n` +
        `Current limits: max position ${this.config.riskLimits.maxPositionSizePct}%, ` +
        `max slippage ${this.config.riskLimits.maxSlippageBps}bps, ` +
        `max daily loss ${this.config.riskLimits.maxDailyLossPct}%.\n` +
        `To return to advisory mode: "switch to advisory mode"`
      );
    } else {
      return (
        `Switched to ADVISORY mode.\n` +
        `The agent will suggest actions but wait for your confirmation before executing.`
      );
    }
  }

  private handleHelp(): string {
    const examples = this.nlParser.getExamples();
    return (
      `Makora Agent Commands:\n\n` +
      examples.map((e) => `  ${e}`).join('\n') +
      `\n\nCurrent mode: ${this.getMode()}\n` +
      `OODA loop: ${this.isRunning() ? 'running' : 'stopped'}`
    );
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error(
        'Agent is not initialized. Call agent.initialize(registry) first.'
      );
    }
  }
}
```

### Task 8: Package Index

**File: `P:\solana-agent-hackathon\packages\agent-core\src\index.ts`**

```typescript
/**
 * @makora/agent-core - The intelligent agent core for Makora
 *
 * Ties the entire system together:
 *   data-feed -> strategy-engine -> risk-manager -> execution-engine -> protocol-router
 *
 * Components:
 * - MakoraAgent: top-level agent class (initialize, start, executeCommand)
 * - OODALoop: continuous decision cycle (observe -> orient -> decide -> act)
 * - NLParser: natural language command parser
 * - ActionExplainer: human-readable explanations for suggestions
 * - DecisionLog: audit trail of all agent decisions
 */

export { MakoraAgent } from './agent.js';
export { OODALoop } from './ooda-loop.js';
export { NLParser } from './nl-parser.js';
export { ActionExplainer } from './explainer.js';
export { DecisionLog } from './decision-log.js';
export {
  type AgentConfig,
  type ParsedIntent,
  type ConfirmationCallback,
  type DecisionLogEntry,
  DEFAULT_AGENT_CONFIG,
  AUTO_CONFIRM,
  ALWAYS_REJECT,
} from './types.js';
```

### Task 9: Install and Build

```bash
cd P:\solana-agent-hackathon
pnpm install
pnpm build
```

Build order:
1. `@makora/types` (leaf)
2. `@makora/data-feed` (depends on types)
3. `@makora/strategy-engine` (depends on types)
4. `@makora/risk-manager` (depends on types)
5. `@makora/execution-engine` (depends on types)
6. `@makora/protocol-router` (depends on types)
7. `@makora/agent-core` (depends on ALL of the above)

## Verification

1. **Package compiles** -- `packages/agent-core/dist/` contains compiled JavaScript and type declarations.
2. **NL parser: swap** -- `parser.parse("swap 10 SOL to USDC")` returns `{ type: 'swap', amount: 10, amountIsPercent: false, fromToken: 'SOL', toToken: 'USDC' }`.
3. **NL parser: stake percent** -- `parser.parse("stake 50% of my SOL")` returns `{ type: 'stake', amount: 50, amountIsPercent: true, token: 'SOL' }`.
4. **NL parser: portfolio** -- `parser.parse("show my portfolio")` returns `{ type: 'portfolio', query: 'status' }`.
5. **NL parser: unknown** -- `parser.parse("make me rich")` returns `{ type: 'unknown', rawInput: 'make me rich' }`.
6. **Advisory mode** -- Agent initialized in advisory mode with a ConfirmationCallback. After runSingleCycle, the callback is invoked with ValidatedAction[] and an explanation string containing "Stake idle SOL via Marinade".
7. **Auto mode** -- Agent initialized in auto mode. After runSingleCycle, execution results are returned in the DecisionCycleResult and the decision log records the rationale.
8. **OODA cycle time** -- A single runCycle() completes within 5 seconds (excluding network latency for the Observe phase which is mocked in tests).
9. **Decision log** -- After 3 cycles, `decisionLog.getRecent(3)` returns 3 entries each with `cycleId`, `phaseDurations`, `proposedActions`, and `rationale`.
10. **Event emission** -- Agent emits `cycle_started`, `action_proposed`, `action_approved`, `cycle_completed` events during a cycle.
11. **No TypeScript errors** -- `pnpm typecheck` passes for the package.

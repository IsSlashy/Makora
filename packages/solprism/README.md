# @makora/solprism

**SOLPRISM Verifiable Reasoning for Makora DeFi Agent**

## Why

Makora is an autonomous DeFi agent that manages real money. When an AI agent handles your portfolio, you need more than "trust me" — you need **cryptographic proof of correct reasoning**.

SOLPRISM adds a commit-reveal layer: before Makora executes a trade, it hashes the full reasoning trace (LLM analysis, risk checks, strategy signals) and commits it. This hash can be verified at any time against the original reasoning.

## Integration Points

| Makora Phase | SOLPRISM Trace | What's Captured |
|-------------|----------------|-----------------|
| **ORIENT** | `commitStrategy()` | LLM analysis, sentiment, allocation, Polymarket signals |
| **DECIDE** | `commitOODACycle()` | Full cycle: proposed → approved → rejected actions |
| **ACT** | `commitExecution()` | Trade result, signature, portfolio impact |
| **VETO** | `commitRiskVeto()` | Which checks failed, why action was blocked |

## Usage

```typescript
import { SolprismTracer } from '@makora/solprism';

const tracer = new SolprismTracer({ agentName: 'my-makora' });

// ORIENT phase — commit LLM analysis
tracer.commitStrategy({
  llmModel: 'claude-4-sonnet',
  sentiment: 'bullish',
  confidence: 72,
  allocation: { stake: 40, lend: 30, lp: 20, hold: 10 },
  reasoning: 'SOL showing strong momentum...',
  portfolioValueUsd: 5000,
});

// DECIDE phase — commit full OODA cycle
tracer.commitOODACycle({
  phase: 'decide',
  portfolioValueUsd: 5000,
  proposedActions: [swapAction, stakeAction],
  approvedActions: [swapAction],
  rejectedActions: [],
  llmReasoning: 'Bullish signals suggest...',
  mode: 'autonomous',
  cycleTimeMs: 1200,
});

// ACT phase — commit execution result
tracer.commitExecution({
  action: swapAction,
  result: { success: true, signature: 'abc123...' },
  prePortfolioValueUsd: 5000,
  postPortfolioValueUsd: 5050,
});

// Verify any commitment
const commitment = tracer.getRecent(1)[0];
const valid = tracer.verify(commitment.hash, commitment.trace);
console.log(valid); // true

// Audit trail
const stats = tracer.getStats();
console.log(stats);
// { totalCommitments: 3, byType: { analysis: 1, decision: 1, trade: 1 }, ... }
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Makora OODA Loop                   │
│                                                       │
│  OBSERVE     ORIENT        DECIDE        ACT         │
│  (data)   (LLM+signals)  (strategy)   (execute)     │
│               │              │             │          │
│               ▼              ▼             ▼          │
│         ┌──────────────────────────────────────┐     │
│         │          SolprismTracer               │     │
│         │  commitStrategy  commitOODA  commitEx │     │
│         │          ↓                            │     │
│         │    SHA-256 hash → stored              │     │
│         │    (verifiable forever)               │     │
│         └──────────────────────────────────────┘     │
│                                                       │
│  Risk Manager VETO ──→ commitRiskVeto()              │
└───────────────────────────────────────────────────────┘
```

## Links

- **SOLPRISM SDK**: [`@solprism/sdk@0.1.0`](https://github.com/basedmereum/axiom-protocol/tree/main/sdk)
- **SOLPRISM Program**: `CZcvoryaQNrtZ3qb3gC1h9opcYpzEP1D9Mu1RVwFQeBu` (Solana devnet)
- **Hackathon**: [Solana Agent Hackathon](https://colosseum.com/agent-hackathon)

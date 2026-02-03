# Makora

**The Adaptive DeFi Agent for Solana**

Makora is an autonomous portfolio management agent that observes, adapts, and executes DeFi strategies across Solana protocols — with built-in ZK privacy. Named after the adaptive shikigami from Jujutsu Kaisen, Makora continuously learns and adjusts to market conditions.

---

## What It Does

Makora manages your Solana DeFi portfolio autonomously:

- **Swaps** via Jupiter (best-route aggregation)
- **Staking** via Marinade (liquid staking, mSOL)
- **Liquidity** via Raydium (concentrated liquidity pools)
- **Vaults** via Kamino (automated vault strategies)
- **Privacy** via ZK proofs (stealth addresses + shielded transfers)

Two operating modes:
- **Advisory** — Makora suggests actions, you approve
- **Autonomous** — Makora executes within configurable risk limits

---

## Architecture

```
                    ┌─────────────────────────┐
                    │      Agent Core         │
                    │   OODA Loop + NL Parser │
                    └───────────┬─────────────┘
                                │
              ┌─────────────────┼─────────────────┐
              │                 │                  │
     ┌────────▼───────┐ ┌──────▼──────┐ ┌────────▼────────┐
     │ Strategy Engine │ │Risk Manager │ │ Execution Engine│
     │ Yield/Rebalance │ │Circuit Break│ │  Build/Sim/Send │
     └────────┬───────┘ └──────┬──────┘ └────────┬────────┘
              │                │                  │
              └────────────────┼──────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  Protocol Router    │
                    └──────────┬──────────┘
                               │
         ┌──────────┬──────────┼──────────┬──────────┐
         │          │          │          │          │
     Jupiter   Marinade    Raydium    Kamino    Privacy
      (swap)   (stake)     (LP)     (vaults)  (ZK/stealth)
```

### The OODA Loop

Makora runs a continuous **Observe → Orient → Decide → Act** cycle:

1. **Observe** — Fetch portfolio state, token prices, protocol yields
2. **Orient** — Analyze market conditions (volatility, trend, regime)
3. **Decide** — Run strategy engine, rank opportunities, check risk limits
4. **Act** — Execute via protocol adapters with simulation + retry

### Risk Management

The risk manager has **absolute VETO power** over all agent actions:

- Position size limits (max % per trade)
- Slippage protection
- Daily loss circuit breaker
- SOL reserve enforcement (always keep gas money)
- Per-protocol exposure caps

---

## Monorepo Structure

```
makora/
├── packages/
│   ├── types/              # Shared type definitions
│   ├── data-feed/          # Portfolio, prices, connections
│   ├── protocol-router/    # Multi-protocol routing
│   ├── execution-engine/   # Tx build → simulate → send → confirm
│   ├── risk-manager/       # VETO power + circuit breaker
│   ├── strategy-engine/    # Yield optimization + rebalancing
│   ├── agent-core/         # OODA loop + NL parser
│   ├── privacy/            # Stealth addresses + shielded transfers
│   └── adapters/
│       ├── jupiter/        # DEX aggregator
│       ├── marinade/       # Liquid staking
│       ├── raydium/        # AMM / CLMM
│       ├── kamino/         # Vault strategies
│       └── privacy/        # Shield / unshield
├── apps/
│   ├── cli/                # Terminal interface (7 commands)
│   └── dashboard/          # Next.js 15 web UI
├── programs/
│   ├── makora_vault/       # Anchor — portfolio vaults (427KB)
│   ├── makora_strategy/    # Anchor — strategy + audit trail (288KB)
│   └── makora_privacy/     # Anchor — stealth + shielded pool (292KB)
└── circuits/
    ├── transfer.circom     # Shielded transfer proof
    ├── merkle.circom       # Merkle inclusion proof
    └── poseidon.circom     # Poseidon hash (ZK-friendly)
```

**16 packages** · **3 Solana programs** · **3 ZK circuits** · **2 apps** · **~18,000 lines of code**

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Solana (1.18) |
| Smart Contracts | Anchor 0.30.1 / Rust |
| ZK Proofs | Circom / Groth16 / snarkjs |
| TypeScript | pnpm monorepo + Turborepo + tsup |
| CLI | Commander.js + chalk |
| Dashboard | Next.js 15 + Tailwind CSS |
| Wallet | Solana Wallet Adapter |
| Build | Rust 1.75 + SBF platform-tools |

---

## CLI Commands

```bash
makora status              # Portfolio overview + positions
makora swap SOL USDC 1.5   # Swap via Jupiter aggregator
makora stake 2.0           # Stake SOL → mSOL via Marinade
makora strategy            # View/set active strategy
makora auto                # Start autonomous mode
makora shield 1.0          # Shield SOL via ZK privacy pool
makora agent "rebalance"   # Natural language command
```

---

## Strategies

| Strategy | Risk | Approach |
|----------|------|----------|
| Conservative | Low | Heavy staking, minimal LP, wide stops |
| Balanced | Medium | Mix of staking + LP + vaults |
| Aggressive | High | Concentrated LP, yield farming, tight rebalancing |

Each strategy produces ranked signals that flow through the risk manager before any execution.

---

## Privacy Layer

Makora includes a zero-knowledge privacy layer with two mechanisms:

**Stealth Addresses** — Generate one-time addresses for receiving payments. The sender creates a fresh address from the recipient's public key; only the recipient can detect and claim it.

**Shielded Transfers** — Deposit SOL into a shielded pool using ZK proofs. Withdraw to any address without linking sender and receiver. Uses Poseidon hashing and Groth16 proofs for on-chain verification.

---

## Solana Programs

### makora_vault (427KB)
On-chain portfolio vault with deposit/withdraw and position tracking.

### makora_strategy (288KB)
Strategy configuration with on-chain audit trail (ring buffer pattern, 8 entries to fit SBF stack limits).

### makora_privacy (292KB)
Stealth payment registry + shielded pool with nullifier-based double-spend prevention.

---

## Quick Start

```bash
# Prerequisites: Node.js 20+, pnpm 8+, Rust 1.75, Anchor 0.30.1

# Clone
git clone https://github.com/IsSlashy/Makora.git
cd Makora

# Install
pnpm install

# Build all packages
pnpm build

# Run CLI
cd apps/cli && node dist/index.cjs status

# Build Solana programs (requires WSL on Windows)
anchor build
```

---

## How It Was Built

This entire project was built by an AI agent (Claude) as part of the [Solana Agent Hackathon](https://colosseum.com/agent-hackathon). The development followed a 7-phase plan executed over 10 days:

1. **Foundation** — Monorepo scaffold, types, data feed, Jupiter adapter, vault program, CLI
2. **Core DeFi Engine** — Marinade/Raydium/Kamino adapters, protocol router, execution engine, risk manager
3. **Agent Intelligence** — Strategy engine, OODA loop, NL parser, strategy program with audit trail
4. **Privacy Layer** — ZK circuits (Circom), stealth/shielded TypeScript SDK, privacy Anchor program
5. **CLI Interface** — 7 commands covering the full DeFi + privacy workflow
6. **Web Dashboard** — Next.js 15 with portfolio viz, strategy panel, risk controls
7. **Integration & Polish** — End-to-end testing, README, submission

Every line of code — TypeScript, Rust, Circom — was written by Claude.

---

## License

MIT

---

*Built for the [Solana Agent Hackathon](https://colosseum.com/agent-hackathon) by [Volta Team](https://github.com/IsSlashy)*

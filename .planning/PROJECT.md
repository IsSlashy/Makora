# MAHORAGA — The Adaptive DeFi Agent for Solana

## What This Is

Mahoraga is an autonomous, adaptive DeFi agent for Solana that manages portfolio strategies across multiple protocols while preserving user privacy through zero-knowledge proofs. Named after the "Master of Adaptation" from Jujutsu Kaisen, the agent continuously adapts its strategies to market conditions — just as Mahoraga adapts to overcome any attack.

## Core Value

**The ONE thing that must work:** An agent that autonomously manages DeFi positions on Solana, adapting to market conditions in real-time, while keeping the user's activity private through ZK-powered stealth operations.

## Problem

DeFi on Solana is complex: users must manually monitor positions across multiple protocols (Jupiter, Raydium, Marinade, Kamino), react to market changes, rebalance portfolios, and chase yields — all while their wallet activity is publicly visible on-chain. This creates two problems:
1. **Complexity barrier** — managing multi-protocol DeFi positions requires constant attention and expertise
2. **Privacy exposure** — every transaction, position, and strategy is visible to competitors, MEV bots, and observers

## Solution

Mahoraga solves both by combining:
1. **Adaptive DeFi Agent** — autonomous portfolio management that adapts strategies to market conditions
2. **Privacy Layer** — stealth addresses and shielded transfers inherited from P01 (our production privacy protocol for Solana)

## How It Works

### The Adaptation Cycle (The Wheel)
Like Mahoraga's wheel that turns with each adaptation:
1. **Observe** — Monitor market conditions (volatility, liquidity depth, yield rates, token prices)
2. **Analyze** — Evaluate current positions against market state
3. **Adapt** — Adjust strategy (rebalance, exit, enter, shift yield sources)
4. **Execute** — Perform transactions via privacy layer (stealth addresses + shielded transfers)
5. **Learn** — Track performance of adaptations, refine future decisions

Each cycle turns the wheel — visible on the dashboard as a real-time adaptation indicator.

### Operating Modes
- **Advisory Mode** (default) — Agent analyzes and suggests strategies, user approves before execution
- **Auto Mode** (opt-in) — Agent executes autonomously within user-defined risk parameters and limits

### Privacy Features (from P01)
- **Stealth Addresses** — DeFi positions opened via stealth addresses, invisible to on-chain observers
- **Shielded Transfers** — ZK-proof transactions that mask amounts and destinations
- Users can operate in DeFi without revealing their wallet, strategy, or position sizes

### Supported Protocols (V1)
- **Jupiter** — DEX aggregation, swap routing, limit orders
- **Raydium** — AMM liquidity provision, concentrated liquidity
- **Marinade** — Liquid staking (mSOL), stake management
- **Kamino** — Automated vaults, leveraged yield strategies

## Target Users

1. **DeFi power users** — want automated portfolio management with privacy
2. **Privacy-conscious traders** — want to operate without revealing strategies
3. **Passive yield seekers** — want set-and-forget DeFi with risk controls

## Technical Foundation

### Stack
- **Blockchain**: Solana (Anchor framework)
- **Programs**: Rust (Anchor) for on-chain logic
- **ZK**: Circom circuits + snarkjs (from P01)
- **Agent Core**: TypeScript/Node.js
- **Frontend**: Next.js dashboard + CLI tool
- **Data**: On-chain data via Solana RPC + protocol SDKs

### Inherited from P01
- Stealth address implementation (tested, production-ready)
- Shielded transfer circuits (Circom ZK proofs)
- Relayer pattern for private transactions
- Auth flow and wallet integration

### New for Mahoraga
- Adaptive strategy engine
- Multi-protocol DeFi integrations (Jupiter, Raydium, Marinade, Kamino)
- Portfolio risk management system
- Real-time market analysis
- CLI interface for power users
- Dashboard with Mahoraga branding (The Wheel visualization)

## Branding

**Theme**: Mahoraga from Jujutsu Kaisen — the Eight-Handled Sword Divergent Sila Divine General
- **Visual Identity**: Dark, powerful aesthetic. The Wheel as central visual element.
- **Tagline**: "Master of Adaptation" / "Adapt. Shield. Yield."
- **The Wheel**: Dashboard centerpiece showing adaptation cycles, strategy shifts, portfolio health
- **Color Palette**: Deep purples, dark grays, electric accents (inspired by Mahoraga's design)

## Constraints

- **Deadline**: February 12, 2026 (10 days from kickoff)
- **Rule**: All code must be written by AI agent (Claude)
- **Platform**: Must integrate with Solana mainnet/devnet
- **Security**: Must have risk limits, circuit breakers, and position caps
- **Scope**: V1 must be complete and polished — quality over quantity

## What Success Looks Like

1. Working agent that manages real DeFi positions on Solana devnet
2. Privacy layer demonstrably hiding wallet activity
3. Dashboard that impresses visually (The Wheel, adaptation cycles, portfolio view)
4. CLI for power users showing deep technical capability
5. Clean architecture that shows future potential (V2: more protocols, cross-chain, social features)

## Competition Context

- **Hackathon**: Solana Agent Hackathon (Colosseum + Solana Foundation)
- **Prize**: $50,000 USDC (1st place)
- **Differentiators**: ZK privacy (unique in the field), adaptive strategies (not just a trading bot), Mahoraga branding (memorable)
- **Targeting**: 1st place + "Most Agentic" ($5,000 bonus)

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Adaptive DeFi agent that manages multi-protocol positions
- [ ] Advisory mode with strategy suggestions
- [ ] Auto mode with risk-bounded execution
- [ ] Stealth address integration for private positions
- [ ] Shielded transfers via ZK proofs
- [ ] Jupiter integration (swaps, routing)
- [ ] Raydium integration (liquidity provision)
- [ ] Marinade integration (liquid staking)
- [ ] Kamino integration (automated vaults)
- [ ] Portfolio risk management (limits, circuit breakers)
- [ ] Real-time market analysis
- [ ] CLI interface
- [ ] Web dashboard with Mahoraga branding
- [ ] The Wheel visualization

### Out of Scope

- Mobile app — V2
- Cross-chain operations — V2
- Social/community features — V2
- Mainnet deployment with real funds — post-audit
- Token launch — not relevant

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Mahoraga branding (JJK) | Memorable, maps perfectly to adaptive DeFi, strong visual identity | Confirmed |
| Advisory + Auto modes | Lowers barrier (advisory) while showcasing autonomy (auto) | Confirmed |
| Both stealth + shielded | Maximum differentiation, leverages full P01 expertise | Confirmed |
| Multi-protocol (4 protocols) | Shows breadth, more strategies possible, impressive for judges | Confirmed |
| CLI + Dashboard | CLI shows depth, dashboard impresses visually, covers both audiences | Confirmed |
| TypeScript + Anchor/Rust | Matches P01 stack, proven, fast development | Confirmed |

---
*Last updated: 2026-02-02 after initialization*

# MAKORA — The First LLM-Powered Privacy-Preserving DeFi Agent on Solana

## What This Is

Makora is an autonomous, LLM-powered DeFi agent for Solana that uses real AI reasoning (Anthropic/OpenAI/Qwen) over live market data — including Polymarket prediction markets — to manage portfolio strategies across multiple protocols while preserving user privacy through zero-knowledge proofs. Named after the "Master of Adaptation" from Jujutsu Kaisen, the agent continuously adapts its strategies to market conditions using genuine intelligence, not hardcoded rules.

## Core Value

**The ONE thing that must work:** An LLM-powered agent that autonomously reasons about DeFi positions on Solana using real market intelligence (Polymarket + on-chain data), executes strategies through privacy-preserving stealth sessions, and lets users bring their own API key (BYOK).

## Problem

DeFi on Solana is complex: users must manually monitor positions across multiple protocols (Jupiter, Raydium, Marinade, Kamino), react to market changes, rebalance portfolios, and chase yields — all while their wallet activity is publicly visible on-chain. Existing "DeFi agents" are just rule-based bots with hardcoded strategies. This creates three problems:
1. **Complexity barrier** — managing multi-protocol DeFi positions requires constant attention and expertise
2. **Privacy exposure** — every transaction, position, and strategy is visible to competitors, MEV bots, and observers
3. **No real intelligence** — existing tools use static rules, not genuine reasoning about market conditions

## Solution

Makora solves all three by combining:
1. **LLM-Powered Intelligence** — real AI reasoning via user's own API key (Anthropic Claude, OpenAI GPT-4o, Qwen) analyzing portfolio state, yield opportunities, and Polymarket prediction markets
2. **Adaptive DeFi Agent** — autonomous portfolio management through the OODA loop (Observe-Orient-Decide-Act), where the ORIENT phase uses LLM reasoning instead of hardcoded heuristics
3. **Privacy Layer** — stealth addresses and shielded transfers inherited from P01 (our production privacy protocol for Solana)

## How It Works

### The Adaptation Cycle (The Wheel)
Like Makora's wheel that turns with each adaptation:
1. **Observe** — Monitor on-chain portfolio, market conditions, yield rates, token prices
2. **Orient** — LLM analyzes all data (portfolio + yields + Polymarket signals) and produces structured allocation recommendations with reasoning
3. **Decide** — Risk manager validates LLM recommendations against user-defined limits
4. **Act** — Execute transactions via privacy layer (stealth addresses + shielded transfers)

Each cycle turns the wheel — visible on the dashboard as a real-time adaptation indicator with live LLM reasoning output.

### Operating Modes
- **Advisory Mode** (default) — LLM analyzes and suggests strategies with full reasoning, user approves before execution
- **Auto Mode** (opt-in) — Agent executes LLM recommendations autonomously within user-defined risk parameters

### LLM Intelligence (BYOK)
- **Bring Your Own Key** — Users provide their own Anthropic, OpenAI, or Qwen API key
- **Structured Analysis** — LLM outputs JSON with sentiment, allocation recommendations, risk assessment, and reasoning chain
- **Polymarket Integration** — Real-time prediction market data as forward-looking sentiment signals
- **Provider Agnostic** — Zero SDK dependencies, raw fetch to all three providers

### Privacy Features (from P01)
- **Stealth Addresses** — DeFi positions opened via stealth addresses, invisible to on-chain observers
- **Shielded Transfers** — ZK-proof transactions that mask amounts and destinations
- Users can operate in DeFi without revealing their wallet, strategy, or position sizes

### Supported Protocols (V1)
- **Jupiter** — DEX aggregation, swap routing, limit orders
- **Raydium** — AMM liquidity provision, concentrated liquidity
- **Marinade** — Liquid staking (mSOL), stake management
- **Kamino** — Automated vaults, leveraged yield strategies

### Backend Worker
- Headless Node.js process for 24/7 autonomous operation
- Same OODA loop + LLM reasoning as the dashboard
- Reads config from environment variables
- Health + status endpoints for monitoring
- Deploy on Railway, Render, or local with pm2

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
- **LLM**: Anthropic Claude / OpenAI GPT-4o / Qwen (via raw fetch, zero SDK deps)
- **Market Intelligence**: Polymarket Gamma API (prediction markets)
- **Frontend**: Next.js 15 dashboard + CLI tool
- **Backend**: Headless Node.js worker for 24/7 operation
- **Data**: On-chain data via Solana RPC + protocol SDKs + Polymarket

### Inherited from P01
- Stealth address implementation (tested, production-ready)
- Shielded transfer circuits (Circom ZK proofs)
- Relayer pattern for private transactions
- Auth flow and wallet integration

### New for Makora
- **LLM Provider Layer** — multi-provider support (Anthropic, OpenAI, Qwen) via raw fetch
- **Polymarket Intelligence Feed** — real-time crypto prediction market data
- **LLM-Powered OODA Loop** — ORIENT phase uses LLM reasoning over all data sources
- **BYOK Settings Panel** — provider selector, API key input, model picker, temperature control
- **LLM Reasoning Panel** — live display of LLM analysis, allocation table, reasoning chain
- **Polymarket Panel** — prediction market dashboard with sentiment indicators
- **Backend Worker** — headless 24/7 autonomous agent process
- Multi-protocol DeFi integrations (Jupiter, Raydium, Marinade, Kamino)
- Portfolio risk management system
- CLI interface for power users
- Dashboard with Makora branding (The Wheel visualization)

## Branding

**Theme**: Makora from Jujutsu Kaisen — the Eight-Handled Sword Divergent Sila Divine General
- **Visual Identity**: Dark, powerful aesthetic. The Wheel as central visual element.
- **Tagline**: "Master of Adaptation" / "Adapt. Shield. Yield."
- **The Wheel**: Dashboard centerpiece showing adaptation cycles, strategy shifts, portfolio health
- **Color Palette**: Deep purples, dark grays, electric accents (inspired by Makora's design)

## Constraints

- **Deadline**: February 12, 2026 (10 days from kickoff)
- **Rule**: All code must be written by AI agent (Claude)
- **Platform**: Must integrate with Solana mainnet/devnet
- **Security**: Must have risk limits, circuit breakers, and position caps
- **Scope**: V1 must be complete and polished — quality over quantity

## What Success Looks Like

1. Working LLM-powered agent that reasons about real DeFi positions on Solana devnet
2. Live Polymarket intelligence feeding into LLM analysis
3. Privacy layer demonstrably hiding wallet activity
4. Dashboard with LLM reasoning visible in real-time (analysis, allocations, risk)
5. BYOK settings that work with all three providers
6. Backend worker running 24/7 autonomous OODA cycles
7. CLI for power users showing deep technical capability
8. Clean architecture that shows future potential (V2: more protocols, cross-chain, social features)

## Competition Context

- **Hackathon**: Solana Agent Hackathon (Colosseum + Solana Foundation)
- **Prize**: $50,000 USDC (1st place)
- **Differentiators**: LLM intelligence (not a rule-based bot), Polymarket data (unique signal), ZK privacy (unique in the field), BYOK model (user owns their key), Makora branding (memorable)
- **Targeting**: 1st place + "Most Agentic" ($5,000 bonus)

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [x] Adaptive DeFi agent that manages multi-protocol positions
- [x] Advisory mode with LLM-powered strategy suggestions
- [x] Auto mode with risk-bounded execution
- [x] Stealth address integration for private positions
- [x] Shielded transfers via ZK proofs
- [x] Jupiter integration (swaps, routing)
- [x] Raydium integration (liquidity provision)
- [x] Marinade integration (liquid staking)
- [x] Kamino integration (automated vaults)
- [x] Portfolio risk management (limits, circuit breakers)
- [x] Real-time market analysis
- [x] CLI interface
- [x] Web dashboard with Makora branding
- [x] The Wheel visualization
- [x] LLM Provider Layer (Anthropic, OpenAI, Qwen)
- [x] BYOK Settings Panel
- [x] LLM Reasoning Panel (live analysis display)
- [x] Polymarket Intelligence Feed
- [x] Polymarket Dashboard Panel
- [x] LLM-Powered OODA Loop (ORIENT phase)
- [x] Backend Worker (24/7 autonomous agent)
- [x] API routes for LLM proxy (analyze, ping, stream)

### Out of Scope

- Mobile app — V2
- Cross-chain operations — V2
- Social/community features — V2
- Mainnet deployment with real funds — post-audit
- Token launch — not relevant

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Makora branding (JJK) | Memorable, maps perfectly to adaptive DeFi, strong visual identity | Confirmed |
| Advisory + Auto modes | Lowers barrier (advisory) while showcasing autonomy (auto) | Confirmed |
| Both stealth + shielded | Maximum differentiation, leverages full P01 expertise | Confirmed |
| Multi-protocol (4 protocols) | Shows breadth, more strategies possible, impressive for judges | Confirmed |
| CLI + Dashboard | CLI shows depth, dashboard impresses visually, covers both audiences | Confirmed |
| TypeScript + Anchor/Rust | Matches P01 stack, proven, fast development | Confirmed |
| BYOK (Bring Your Own Key) | User controls costs, no vendor lock-in, privacy-respecting | Confirmed |
| LLM-Powered ORIENT | Real intelligence vs hardcoded rules, major differentiator | Confirmed |
| Polymarket as signal | Unique data source, prediction markets as forward-looking sentiment | Confirmed |
| Raw fetch (zero SDK deps) | Smaller bundle, no version conflicts, full control | Confirmed |
| Backend Worker | 24/7 autonomous operation, true "agent" behavior | Confirmed |

---
*Last updated: 2026-02-03 after LLM intelligence implementation*

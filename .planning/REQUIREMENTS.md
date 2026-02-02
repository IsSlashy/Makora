# MAHORAGA — Requirements

> v1 scope for Solana Agent Hackathon (deadline: Feb 12, 2026)

---

## v1 Requirements

### Agent Core (AGENT)
- [ ] **AGENT-01**: Agent operates in advisory mode by default — analyzes positions and suggests strategies, user confirms before execution
- [ ] **AGENT-02**: Agent operates in auto mode (opt-in) — executes autonomously within user-defined risk parameters (max position size, max slippage, daily loss limit)
- [ ] **AGENT-03**: Agent accepts natural language commands — "swap 10 SOL to USDC", "stake 50% of my SOL", "show my portfolio"
- [ ] **AGENT-04**: Agent runs an OODA decision loop (Observe → Orient → Decide → Act) that continuously monitors positions and market conditions
- [ ] **AGENT-05**: Agent provides clear explanations for every suggestion — what action, why, expected outcome, risks

### DeFi Protocols (DEFI)
- [ ] **DEFI-01**: Execute token swaps via Jupiter aggregator with optimal routing
- [ ] **DEFI-02**: Stake/unstake SOL via Marinade (SOL → mSOL and reverse)
- [ ] **DEFI-03**: Provide/remove liquidity on Raydium AMM pools
- [ ] **DEFI-04**: Deposit/withdraw from Kamino automated vaults
- [ ] **DEFI-05**: Agent can orchestrate multi-step DeFi operations in a single command (e.g., "move 30% of portfolio to yield" → swap + stake + deposit)

### Strategy Engine (STRAT)
- [ ] **STRAT-01**: Adaptive strategy engine evaluates market conditions (volatility, yields, liquidity) and selects optimal allocation
- [ ] **STRAT-02**: Strategy engine supports yield optimization — finds highest risk-adjusted yield across protocols
- [ ] **STRAT-03**: Strategy engine supports portfolio rebalancing — maintains target allocation ratios
- [ ] **STRAT-04**: The Wheel visualization — shows current adaptation cycle state (observe/orient/decide/act) and strategy evolution history

### Risk Management (RISK)
- [ ] **RISK-01**: Risk manager has VETO power over all actions — enforces hard limits before any transaction executes
- [ ] **RISK-02**: Configurable risk parameters: max position size (%), max slippage (%), daily loss limit (SOL/USD), min remaining balance
- [ ] **RISK-03**: Circuit breaker — auto-pauses agent execution if loss exceeds threshold or market conditions are extreme
- [ ] **RISK-04**: Every transaction shows risk assessment before execution (in advisory mode) or logs it (in auto mode)

### Privacy Layer (PRIV)
- [ ] **PRIV-01**: Stealth address generation — user can generate stealth meta-addresses for receiving private payments
- [ ] **PRIV-02**: Stealth address sending — agent can send tokens to stealth addresses (recipient identity hidden from chain observers)
- [ ] **PRIV-03**: Shielded transfers — ZK-proof transactions that hide transfer amounts and destinations (Groth16 proofs)
- [ ] **PRIV-04**: Two-phase commit — ZK proof verification (TX1) separated from DeFi execution (TX2) to respect Solana CU/size limits
- [ ] **PRIV-05**: Privacy is additive — core DeFi agent functions fully without privacy layer enabled

### Solana Programs (PROG)
- [ ] **PROG-01**: Vault program — on-chain escrow/treasury for agent-managed funds with deposit/withdraw instructions
- [ ] **PROG-02**: Strategy program — stores strategy parameters, agent permissions, and audit trail on-chain
- [ ] **PROG-03**: Privacy program — ZK shielded pool with shield/transfer/unshield instructions (ported from P01)
- [ ] **PROG-04**: All programs use Anchor constraints (`has_one`, `seeds`, `bump`, `constraint`) on every account

### CLI Interface (CLI)
- [ ] **CLI-01**: `mahoraga status` — shows wallet balance, active positions, portfolio allocation
- [ ] **CLI-02**: `mahoraga swap <amount> <from> <to>` — executes or suggests swap
- [ ] **CLI-03**: `mahoraga stake <amount>` — stakes SOL via Marinade
- [ ] **CLI-04**: `mahoraga strategy` — shows current strategy, adaptation state, yield opportunities
- [ ] **CLI-05**: `mahoraga auto [on|off]` — toggles auto mode with risk parameter configuration
- [ ] **CLI-06**: `mahoraga shield <amount>` — executes shielded transfer via privacy layer
- [ ] **CLI-07**: `mahoraga agent "natural language command"` — freeform natural language interface

### Web Dashboard (DASH)
- [ ] **DASH-01**: Portfolio overview — total value, allocation pie chart, per-token balances with USD values
- [ ] **DASH-02**: The Wheel — central visualization showing OODA cycle state, adaptation history, strategy evolution
- [ ] **DASH-03**: Strategy panel — active strategy details, suggested actions, performance history
- [ ] **DASH-04**: Transaction history — human-readable log of all agent actions with timestamps and outcomes
- [ ] **DASH-05**: Wallet connection — Phantom, Solflare, Backpack via @solana/wallet-adapter
- [ ] **DASH-06**: Mahoraga branding — dark theme, deep purples, electric accents, Mahoraga-inspired visual identity
- [ ] **DASH-07**: Risk controls panel — configure risk parameters, view circuit breaker status, override controls

### Infrastructure (INFRA)
- [ ] **INFRA-01**: Monorepo with pnpm workspaces + Turborepo — clean package boundaries
- [ ] **INFRA-02**: Toolchain locked: Anchor 0.30.1, Solana 1.18.17, Rust 1.75, Node 20+, TypeScript 5.3+
- [ ] **INFRA-03**: Devnet deployment — all programs deployed and functional on Solana devnet
- [ ] **INFRA-04**: Helius RPC as primary provider with fallback
- [ ] **INFRA-05**: CI-ready test suite — unit tests (Vitest), program tests (bankrun), e2e tests (ts-mocha)

### Submission (SUB)
- [ ] **SUB-01**: README with project description, architecture diagram, screenshots, setup instructions
- [ ] **SUB-02**: Pitch video (under 3 minutes) — demo of working agent + privacy features
- [ ] **SUB-03**: Technical demo video — architecture walkthrough, code highlights
- [ ] **SUB-04**: Live demo on devnet — judges can interact with the deployed agent

---

## v2 Requirements (Post-Hackathon)

- Kamino leveraged yield strategies (advanced)
- Cross-chain DeFi operations
- Mobile app (Expo/React Native)
- Social features — agent performance sharing
- Strategy marketplace — agents share/sell strategies
- Governance token
- Advanced backtesting engine
- Private DeFi receipts (ZK proof receipts)
- Whale/smart money tracking
- Browser extension

---

## Out of Scope

- **Token launch / tokenomics** — zero technical merit for a hackathon
- **Fully autonomous trading without guardrails** — live losses kill demos
- **Multi-chain** — Solana-only for depth
- **NFT features** — dilutes narrative
- **Twitter/social bot** — contradicts privacy story
- **Mainnet deployment with real funds** — post-audit only
- **MEV protection** — Jupiter handles this natively

---

## Traceability

> Mapped from ROADMAP.md -- every v1 requirement assigned to exactly one phase.

| REQ-ID | Requirement | Phase | Days |
|--------|-------------|-------|------|
| INFRA-01 | Monorepo (pnpm + Turborepo) | Phase 1: Foundation | 1-2 |
| INFRA-02 | Toolchain locked | Phase 1: Foundation | 1-2 |
| INFRA-04 | Helius RPC with fallback | Phase 1: Foundation | 1-2 |
| DEFI-01 | Jupiter swaps with optimal routing | Phase 1: Foundation | 1-2 |
| CLI-01 | `mahoraga status` | Phase 1: Foundation | 1-2 |
| PROG-01 | Vault program | Phase 1: Foundation | 1-2 |
| DEFI-02 | Marinade staking (SOL/mSOL) | Phase 2: Core DeFi | 3-4 |
| DEFI-03 | Raydium LP management | Phase 2: Core DeFi | 3-4 |
| DEFI-04 | Kamino vault deposits | Phase 2: Core DeFi | 3-4 |
| DEFI-05 | Multi-step DeFi orchestration | Phase 2: Core DeFi | 3-4 |
| RISK-01 | Risk manager VETO power | Phase 2: Core DeFi | 3-4 |
| RISK-02 | Configurable risk parameters | Phase 2: Core DeFi | 3-4 |
| RISK-03 | Circuit breaker | Phase 2: Core DeFi | 3-4 |
| RISK-04 | Risk assessment display | Phase 2: Core DeFi | 3-4 |
| PROG-04 | Anchor constraints on all accounts | Phase 2: Core DeFi | 3-4 |
| AGENT-01 | Advisory mode (suggest + confirm) | Phase 3: Agent Intelligence | 4-5 |
| AGENT-02 | Auto mode (risk-bounded execution) | Phase 3: Agent Intelligence | 4-5 |
| AGENT-03 | Natural language commands | Phase 3: Agent Intelligence | 4-5 |
| AGENT-04 | OODA decision loop | Phase 3: Agent Intelligence | 4-5 |
| AGENT-05 | Clear explanations for suggestions | Phase 3: Agent Intelligence | 4-5 |
| STRAT-01 | Adaptive strategy engine | Phase 3: Agent Intelligence | 4-5 |
| STRAT-02 | Yield optimization | Phase 3: Agent Intelligence | 4-5 |
| STRAT-03 | Portfolio rebalancing | Phase 3: Agent Intelligence | 4-5 |
| PROG-02 | Strategy program | Phase 3: Agent Intelligence | 4-5 |
| PRIV-01 | Stealth address generation | Phase 4: Privacy Layer | 5-7 |
| PRIV-02 | Stealth address sending | Phase 4: Privacy Layer | 5-7 |
| PRIV-03 | Shielded transfers (Groth16) | Phase 4: Privacy Layer | 5-7 |
| PRIV-04 | Two-phase commit (ZK + DeFi) | Phase 4: Privacy Layer | 5-7 |
| PRIV-05 | Privacy is additive | Phase 4: Privacy Layer | 5-7 |
| PROG-03 | Privacy program (ZK pool) | Phase 4: Privacy Layer | 5-7 |
| CLI-02 | `mahoraga swap` | Phase 5: CLI Interface | 6-7 |
| CLI-03 | `mahoraga stake` | Phase 5: CLI Interface | 6-7 |
| CLI-04 | `mahoraga strategy` | Phase 5: CLI Interface | 6-7 |
| CLI-05 | `mahoraga auto` | Phase 5: CLI Interface | 6-7 |
| CLI-06 | `mahoraga shield` | Phase 5: CLI Interface | 6-7 |
| CLI-07 | `mahoraga agent` (NL interface) | Phase 5: CLI Interface | 6-7 |
| DASH-01 | Portfolio overview | Phase 6: Dashboard | 7-8 |
| DASH-02 | The Wheel visualization | Phase 6: Dashboard | 7-8 |
| DASH-03 | Strategy panel | Phase 6: Dashboard | 7-8 |
| DASH-04 | Transaction history | Phase 6: Dashboard | 7-8 |
| DASH-05 | Wallet connection | Phase 6: Dashboard | 7-8 |
| DASH-06 | Mahoraga branding | Phase 6: Dashboard | 7-8 |
| DASH-07 | Risk controls panel | Phase 6: Dashboard | 7-8 |
| STRAT-04 | The Wheel visualization | Phase 6: Dashboard | 7-8 |
| INFRA-03 | Devnet deployment | Phase 7: Submission | 9-10 |
| INFRA-05 | CI-ready test suite | Phase 7: Submission | 9-10 |
| SUB-01 | README with screenshots | Phase 7: Submission | 9-10 |
| SUB-02 | Pitch video (under 3 min) | Phase 7: Submission | 9-10 |
| SUB-03 | Technical demo video | Phase 7: Submission | 9-10 |
| SUB-04 | Live demo on devnet | Phase 7: Submission | 9-10 |

### Phase Distribution

| Phase | Requirement Count | Categories |
|-------|------------------|------------|
| Phase 1: Foundation | 6 | INFRA, DEFI, CLI, PROG |
| Phase 2: Core DeFi | 9 | DEFI, RISK, PROG |
| Phase 3: Agent Intelligence | 9 | AGENT, STRAT, PROG |
| Phase 4: Privacy Layer | 6 | PRIV, PROG |
| Phase 5: CLI Interface | 6 | CLI |
| Phase 6: Dashboard | 8 | DASH, STRAT |
| Phase 7: Submission | 6 | INFRA, SUB |
| **Total** | **50 mappings (40 unique reqs)** | **9 categories** |

---

*40 requirements across 9 categories. 7 phases. Deadline: Feb 12, 2026.*

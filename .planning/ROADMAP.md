# MAHORAGA -- Roadmap

## Overview

7 phases | 40 requirements | Deadline: Feb 12, 2026

**Timeline**: 10 days (Feb 2 - Feb 12, 2026)
**Critical path**: Types -> Adapters -> Router -> Execution -> Strategy -> Agent Core -> UI
**Privacy**: Parallel track merging at Execution Engine (Phase 4)
**Days 9-10**: Polish and submission ONLY -- no new features

---

## Phase 1: Foundation
**Days**: 1-2 (Feb 2-3)
**Branch**: `gsd/phase-1-foundation`
**Goal**: Establish monorepo, shared types, Solana connection, toolchain, and first DeFi adapter (Jupiter) with a minimal CLI proving end-to-end connectivity.

**Requirements**: INFRA-01, INFRA-02, INFRA-04, DEFI-01, CLI-01, PROG-01

**Deliverables**:
| Task | Package | Output |
|------|---------|--------|
| Monorepo scaffolding | root | pnpm workspaces + Turborepo config, all packages compile |
| Shared types package | `@mahoraga/types` | All TypeScript interfaces: `ProtocolAdapter`, `Strategy`, `RiskParams`, `AgentAction`, `Portfolio`, `StealthAddress` |
| Solana connection + data feed | `@mahoraga/data-feed` | Connect to Helius RPC, read wallet balances, token prices |
| Jupiter adapter (swaps) | `@mahoraga/adapters/jupiter` | Execute a token swap on devnet via `@jup-ag/api` |
| Vault program stub | `programs/mahoraga_vault` | Anchor program skeleton: deposit/withdraw instructions, builds and deploys to localnet |
| CLI skeleton | `apps/cli` | `mahoraga status` shows wallet balance and token holdings |
| Toolchain lockdown | root | `rust-toolchain.toml`, `.nvmrc`, pinned versions in `package.json`, `Cargo.toml` overflow-checks |

**Success Criteria**:
1. `pnpm build` compiles all packages without errors from the monorepo root
2. `mahoraga status` connects to Helius devnet RPC and prints wallet SOL balance + token balances with USD values
3. Jupiter adapter executes a SOL->USDC swap on devnet and returns a confirmed transaction signature
4. Vault program builds with `anchor build` and deploys to localnet via `anchor deploy`
5. All toolchain versions are locked: Rust 1.75 (`rust-toolchain.toml`), Solana 1.18.17, Anchor 0.30.1, Node 20+ (`.nvmrc`), TypeScript 5.3+

---

## Phase 2: Core DeFi Engine
**Days**: 3-4 (Feb 4-5)
**Branch**: `gsd/phase-2-core-defi`
**Goal**: Build the Marinade adapter, protocol router, execution engine, and risk manager -- enabling multi-protocol DeFi operations with safety guarantees.

**Requirements**: DEFI-02, DEFI-03, DEFI-04, DEFI-05, RISK-01, RISK-02, RISK-03, RISK-04, PROG-04

**Deliverables**:
| Task | Package | Output |
|------|---------|--------|
| Marinade adapter (stake/unstake) | `@mahoraga/adapters/marinade` | SOL -> mSOL and reverse via Marinade SDK |
| Raydium adapter (LP) | `@mahoraga/adapters/raydium` | Provide/remove liquidity on Raydium AMM |
| Kamino adapter (vaults) | `@mahoraga/adapters/kamino` | Deposit/withdraw from Kamino vaults |
| Protocol router | `@mahoraga/protocol-router` | Routes `AgentAction` to correct adapter based on action type + protocol |
| Execution engine | `@mahoraga/execution-engine` | Builds versioned transactions, handles retries, confirms on-chain |
| Risk manager | `@mahoraga/risk-manager` | Validates all actions against risk parameters, VETO power enforced |
| Anchor constraints audit | `programs/*` | All accounts use `has_one`, `seeds`, `bump`, `constraint` |

**Success Criteria**:
1. Marinade adapter stakes SOL and returns mSOL balance increase on devnet
2. Protocol router correctly dispatches a swap action to Jupiter and a stake action to Marinade without the caller knowing which adapter handles it
3. Risk manager rejects a transaction that exceeds max position size (e.g., 100% of portfolio) and returns a human-readable rejection reason
4. Circuit breaker triggers and halts execution when a simulated loss exceeds the configured daily loss limit
5. Execution engine builds a versioned transaction with compute unit budget, submits it, and returns confirmed status within 30 seconds

---

## Phase 3: Agent Intelligence
**Days**: 4-5 (Feb 5-6)
**Branch**: `gsd/phase-3-agent-intelligence`
**Goal**: Build the strategy engine, agent core OODA loop, and advisory mode -- making Mahoraga an intelligent agent that observes, decides, and suggests DeFi actions.

**Requirements**: AGENT-01, AGENT-02, AGENT-03, AGENT-04, AGENT-05, STRAT-01, STRAT-02, STRAT-03, PROG-02

**Deliverables**:
| Task | Package | Output |
|------|---------|--------|
| Strategy engine | `@mahoraga/strategy-engine` | Evaluates market conditions, selects optimal allocation |
| Yield optimizer | `@mahoraga/strategy-engine` | Finds highest risk-adjusted yield across Jupiter, Marinade, Raydium, Kamino |
| Rebalancing logic | `@mahoraga/strategy-engine` | Computes rebalancing actions to match target allocation ratios |
| Agent core (OODA loop) | `@mahoraga/agent-core` | Continuous Observe -> Orient -> Decide -> Act cycle |
| Advisory mode | `@mahoraga/agent-core` | Agent suggests actions with explanations, waits for user confirmation |
| Auto mode | `@mahoraga/agent-core` | Agent executes within risk parameters, logs all decisions |
| Natural language parser | `@mahoraga/agent-core` | Parses "swap 10 SOL to USDC", "stake 50% of my SOL", "show my portfolio" |
| Strategy program | `programs/mahoraga_strategy` | Stores strategy params, agent permissions, audit trail on-chain |

**Success Criteria**:
1. Strategy engine evaluates a portfolio and returns a ranked list of suggested actions with expected yield and risk scores
2. Agent in advisory mode suggests "Stake idle SOL via Marinade for 7.2% APY" with a clear explanation of why, expected outcome, and risks -- then waits for user confirmation before executing
3. Agent in auto mode executes a rebalancing action autonomously and logs the full decision rationale (observed state, analysis, decision, action taken)
4. Natural language parser correctly interprets "swap 10 SOL to USDC" into a structured `AgentAction` with amount=10, fromToken=SOL, toToken=USDC, protocol=Jupiter
5. OODA loop completes a full cycle (observe market -> orient portfolio -> decide action -> act or suggest) within 5 seconds

---

## Phase 4: Privacy Layer
**Days**: 5-7 (Feb 6-8)
**Branch**: `gsd/phase-4-privacy`
**Goal**: Port P01's ZK circuits and privacy program to Mahoraga, integrate stealth addresses and shielded transfers into the execution engine via two-phase commit.

**Note**: This track can start in parallel from Day 3 (circuit porting), but merges with the execution engine here.

**Requirements**: PRIV-01, PRIV-02, PRIV-03, PRIV-04, PRIV-05, PROG-03

**Deliverables**:
| Task | Package | Output |
|------|---------|--------|
| Port Circom circuits from P01 | `circuits/` | Compiled WASM + zkey files for shielded transfer circuit |
| Stealth address module | `@mahoraga/privacy` | Generate stealth meta-addresses, derive one-time stealth addresses |
| Shielded transfer module | `@mahoraga/privacy` | Generate Groth16 proofs for shielded transfers (amount + destination hidden) |
| Privacy Anchor program | `programs/mahoraga_privacy` | On-chain ZK verification: shield, transfer, unshield instructions |
| Privacy adapter | `@mahoraga/adapters/privacy` | Integrated into protocol router, uniform adapter interface |
| Two-phase commit pipeline | `@mahoraga/execution-engine` | TX1: verify ZK proof + store in PDA. TX2: DeFi operation referencing verified proof |
| Privacy additive check | `@mahoraga/agent-core` | Agent core functions fully with privacy disabled (feature flag) |

**Success Criteria**:
1. Stealth address generation produces a valid stealth meta-address, and a sender can derive a one-time address that only the recipient can detect and spend from
2. Shielded transfer generates a valid Groth16 proof in under 10 seconds (circuit < 10k constraints), and the proof verifies on-chain in under 200k CU
3. Two-phase commit pipeline executes TX1 (proof verification + PDA storage) and TX2 (DeFi operation referencing verified proof) as separate confirmed transactions on devnet
4. Core DeFi agent (swap, stake, strategy) functions correctly when privacy module is disabled via feature flag -- zero runtime errors
5. Privacy Anchor program passes negative tests: rejects invalid proofs, rejects replayed proofs (nullifier check), rejects unauthorized unshield attempts

---

## Phase 5: CLI Interface
**Days**: 6-7 (Feb 7-8)
**Branch**: `gsd/phase-5-cli`
**Goal**: Complete the CLI with all commands, connecting every agent capability to a usable terminal interface.

**Note**: CLI skeleton exists from Phase 1. This phase adds all remaining commands and the natural language interface.

**Requirements**: CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, CLI-07

**Deliverables**:
| Task | Package | Output |
|------|---------|--------|
| `mahoraga swap <amount> <from> <to>` | `apps/cli` | Executes or suggests swap via Jupiter |
| `mahoraga stake <amount>` | `apps/cli` | Stakes SOL via Marinade |
| `mahoraga strategy` | `apps/cli` | Shows current strategy, adaptation state, yield opportunities |
| `mahoraga auto [on\|off]` | `apps/cli` | Toggles auto mode, prompts for risk parameter configuration |
| `mahoraga shield <amount>` | `apps/cli` | Executes shielded transfer via privacy layer |
| `mahoraga agent "..."` | `apps/cli` | Freeform natural language command interface |
| Output formatting | `apps/cli` | Colored output, tables, confirmation prompts, risk warnings |

**Success Criteria**:
1. `mahoraga swap 1 SOL USDC` triggers an advisory flow: shows quote (amount, route, slippage, price impact), asks for confirmation, executes swap, shows transaction signature and final balances
2. `mahoraga strategy` prints current portfolio allocation, active strategy name, OODA cycle state, and top 3 yield opportunities with APY and risk rating
3. `mahoraga auto on` prompts user to set risk parameters (max position %, max slippage %, daily loss limit), confirms configuration, and activates auto mode
4. `mahoraga shield 5` generates a ZK proof, executes two-phase commit, and confirms shielded transfer completion with transaction signatures for both phases
5. `mahoraga agent "move 30% of portfolio to yield"` parses the intent, breaks it into multi-step actions (swap + stake + deposit), shows the plan, and executes after confirmation

---

## Phase 6: Web Dashboard
**Days**: 7-8 (Feb 8-9)
**Branch**: `gsd/phase-6-dashboard`
**Goal**: Build the Next.js dashboard with Mahoraga branding -- portfolio view, The Wheel visualization, strategy panel, transaction history, and wallet connection.

**Requirements**: DASH-01, DASH-02, DASH-03, DASH-04, DASH-05, DASH-06, DASH-07, STRAT-04

**Deliverables**:
| Task | Package | Output |
|------|---------|--------|
| Next.js app scaffold | `apps/dashboard` | Next.js 15 + Tailwind + Radix UI, Mahoraga dark theme |
| Portfolio overview | `apps/dashboard` | Total value, allocation pie chart, per-token balances with USD values |
| The Wheel visualization | `apps/dashboard` | Central animation showing OODA cycle state, adaptation history, strategy evolution |
| Strategy panel | `apps/dashboard` | Active strategy details, suggested actions queue, performance history chart |
| Transaction history | `apps/dashboard` | Human-readable log of all agent actions with timestamps, outcomes, and TX links |
| Wallet connection | `apps/dashboard` | Phantom, Solflare, Backpack via `@solana/wallet-adapter` |
| Risk controls panel | `apps/dashboard` | Configure risk parameters, view circuit breaker status, emergency stop button |
| Mahoraga branding | `apps/dashboard` | Dark theme, deep purples (#1a0a2e, #2d1b4e), electric accents (#8b5cf6, #a78bfa), Mahoraga-inspired visual identity |

**Success Criteria**:
1. Dashboard loads at `localhost:3000`, connects a Phantom wallet, and displays the connected wallet's SOL balance and token holdings with USD values within 3 seconds
2. The Wheel animates through OODA cycle states (Observe -> Orient -> Decide -> Act) in real-time, and clicking it reveals adaptation history showing past strategy shifts
3. Strategy panel displays the active strategy name, current allocation vs. target allocation, and a list of pending suggested actions with approve/reject buttons
4. Transaction history shows at least 5 recent agent actions with human-readable descriptions (e.g., "Swapped 10 SOL for 245.30 USDC via Jupiter"), timestamps, and clickable Solscan links
5. Risk controls panel allows setting max position size, max slippage, and daily loss limit -- values persist across page reloads and are reflected in agent behavior

---

## Phase 7: Integration, Polish, and Submission
**Days**: 9-10 (Feb 10-12)
**Branch**: `gsd/phase-7-submission`
**Goal**: End-to-end integration testing, devnet deployment, bug fixes, demo preparation, and submission materials. NO new features.

**Requirements**: INFRA-03, INFRA-05, SUB-01, SUB-02, SUB-03, SUB-04

**Deliverables**:
| Task | Package | Output |
|------|---------|--------|
| E2E test suite | `tests/` | Full flow tests: agent -> strategy -> execution -> on-chain verification |
| Program tests (bankrun) | `tests/` | Unit tests for vault, strategy, privacy programs with negative test cases |
| Devnet deployment | all programs | All 3 Anchor programs deployed and functional on Solana devnet |
| Bug fixes + edge cases | all | Fix any failures discovered during integration testing |
| README | root | Project description, architecture diagram, screenshots, setup instructions |
| Pitch video | submission/ | Under 3 minutes: working agent demo + privacy features + The Wheel |
| Technical demo video | submission/ | 2-3 minutes: architecture walkthrough, code highlights, ZK explanation |
| Live demo preparation | devnet | Pre-funded devnet wallet, rehearsed demo flow, fallback scenarios |
| Backup demo recording | submission/ | Pre-recorded video of full demo flow in case live demo fails |

**Success Criteria**:
1. E2E test: agent receives "swap 10 SOL to USDC" -> strategy engine approves -> risk manager validates -> execution engine submits -> transaction confirmed on devnet -> portfolio updated -- all in one automated test
2. All 3 Anchor programs are deployed to Solana devnet with verified program IDs, and each accepts at least one instruction call without error
3. Pitch video is under 3 minutes, shows: (a) agent suggesting a strategy, (b) executing a swap, (c) shielded transfer with ZK proof, (d) The Wheel visualization, (e) portfolio dashboard
4. README includes: project description, architecture diagram, feature list, screenshots of dashboard and CLI, setup instructions that a judge can follow to run the project locally
5. Live demo rehearsed 5+ times with a pre-funded devnet wallet, and a backup video recording exists in case of RPC failure or devnet issues

---

## Requirement Traceability

| REQ-ID | Requirement | Phase | Priority |
|--------|-------------|-------|----------|
| AGENT-01 | Advisory mode (suggest + confirm) | Phase 3 | P0 |
| AGENT-02 | Auto mode (risk-bounded execution) | Phase 3 | P1 |
| AGENT-03 | Natural language commands | Phase 3 | P0 |
| AGENT-04 | OODA decision loop | Phase 3 | P1 |
| AGENT-05 | Clear explanations for suggestions | Phase 3 | P0 |
| DEFI-01 | Jupiter swaps with optimal routing | Phase 1 | P0 |
| DEFI-02 | Marinade staking (SOL/mSOL) | Phase 2 | P0 |
| DEFI-03 | Raydium LP management | Phase 2 | P1 |
| DEFI-04 | Kamino vault deposits | Phase 2 | P1 |
| DEFI-05 | Multi-step DeFi orchestration | Phase 2 | P1 |
| STRAT-01 | Adaptive strategy engine | Phase 3 | P1 |
| STRAT-02 | Yield optimization | Phase 3 | P1 |
| STRAT-03 | Portfolio rebalancing | Phase 3 | P1 |
| STRAT-04 | The Wheel visualization | Phase 6 | P1 |
| RISK-01 | Risk manager VETO power | Phase 2 | P0 |
| RISK-02 | Configurable risk parameters | Phase 2 | P0 |
| RISK-03 | Circuit breaker | Phase 2 | P1 |
| RISK-04 | Risk assessment display | Phase 2 | P0 |
| PRIV-01 | Stealth address generation | Phase 4 | P1 |
| PRIV-02 | Stealth address sending | Phase 4 | P1 |
| PRIV-03 | Shielded transfers (Groth16) | Phase 4 | P1 |
| PRIV-04 | Two-phase commit (ZK + DeFi) | Phase 4 | P1 |
| PRIV-05 | Privacy is additive | Phase 4 | P0 |
| PROG-01 | Vault program | Phase 1 | P0 |
| PROG-02 | Strategy program | Phase 3 | P1 |
| PROG-03 | Privacy program (ZK pool) | Phase 4 | P1 |
| PROG-04 | Anchor constraints on all accounts | Phase 2 | P0 |
| CLI-01 | `mahoraga status` | Phase 1 | P0 |
| CLI-02 | `mahoraga swap` | Phase 5 | P0 |
| CLI-03 | `mahoraga stake` | Phase 5 | P0 |
| CLI-04 | `mahoraga strategy` | Phase 5 | P1 |
| CLI-05 | `mahoraga auto` | Phase 5 | P1 |
| CLI-06 | `mahoraga shield` | Phase 5 | P1 |
| CLI-07 | `mahoraga agent` (NL interface) | Phase 5 | P0 |
| DASH-01 | Portfolio overview | Phase 6 | P0 |
| DASH-02 | The Wheel visualization | Phase 6 | P1 |
| DASH-03 | Strategy panel | Phase 6 | P1 |
| DASH-04 | Transaction history | Phase 6 | P0 |
| DASH-05 | Wallet connection | Phase 6 | P0 |
| DASH-06 | Mahoraga branding | Phase 6 | P0 |
| DASH-07 | Risk controls panel | Phase 6 | P1 |
| INFRA-01 | Monorepo (pnpm + Turborepo) | Phase 1 | P0 |
| INFRA-02 | Toolchain locked | Phase 1 | P0 |
| INFRA-03 | Devnet deployment | Phase 7 | P0 |
| INFRA-04 | Helius RPC with fallback | Phase 1 | P0 |
| INFRA-05 | CI-ready test suite | Phase 7 | P1 |
| SUB-01 | README with screenshots | Phase 7 | P0 |
| SUB-02 | Pitch video (under 3 min) | Phase 7 | P0 |
| SUB-03 | Technical demo video | Phase 7 | P1 |
| SUB-04 | Live demo on devnet | Phase 7 | P0 |

---

## Parallel Tracks

```
Day:    1    2    3    4    5    6    7    8    9    10
        |    |    |    |    |    |    |    |    |    |
Track A [== Phase 1 ==][== Phase 2 ==][Phase3]          DeFi Core
(DeFi)  Types,Jupiter   Marinade,Risk  Strategy,Agent
        Infra,CLI-skel   Router,Exec   OODA,NL

Track B                 [=== Phase 4 (Privacy) ===]     Privacy
(ZK)                    Circom port    ZK program        (parallel)
                        Stealth addr   2-phase commit
                        Shielded xfer  Privacy adapter

Track C [CLI-01]        [====== Phase 5 ======]         CLI
(CLI)   skeleton         All CLI commands                (incremental)

Track D                                [== Phase 6 ==]  Dashboard
(UI)                                   Next.js, Wheel
                                       Portfolio, Wallet

Track E                                          [Ph 7] Polish
(Ship)                                           Tests
                                                 Deploy
                                                 Videos
                                                 README
```

**Merge Points**:
- Track B (Privacy) merges with Track A (DeFi) at the Execution Engine in Phase 4 via the two-phase commit pipeline
- Track C (CLI) depends on Track A being operational (Phase 2 complete) for DeFi commands
- Track D (Dashboard) depends on all agent packages (Phases 1-3) being stable for data/actions
- Track E (Polish) depends on all features being code-complete

---

## Scope Cut Decision Points

These are hard decision points. If the criterion is met, execute the cut immediately -- do not negotiate.

| Day | Condition | Cut Action | Impact |
|-----|-----------|------------|--------|
| **Day 3** | SDK conflicts between Raydium/Kamino and Anchor are unresolved after 4 hours | Drop DEFI-03 (Raydium) and DEFI-04 (Kamino). Jupiter + Marinade only. | Lose LP and vault features. Jupiter already aggregates Raydium for swaps. DeFi agent still works with 2 protocols. |
| **Day 5** | Agent core is NOT working in advisory mode (AGENT-01 fails) | STOP all new features. All effort on stabilizing agent core + Jupiter + Marinade. No privacy, no dashboard until advisory mode works end-to-end. | Delays Phases 4-6. Privacy starts Day 6 instead of Day 3. Dashboard may become CLI-only. |
| **Day 6** | P01 Circom circuits do not compile or port within 8 hours | Switch to demo-only privacy: pre-computed proofs hardcoded for demo, no live proof generation. PRIV-03 becomes "simulated." | Privacy still demos well but is not production-ready. ZK verification on-chain still works with pre-computed proofs. |
| **Day 7** | Privacy program (PROG-03) fails on-chain verification | Drop on-chain ZK verification entirely. Privacy becomes client-side only (stealth addresses work, shielded transfers are off-chain). | Lose PRIV-03 and PRIV-04. Stealth addresses (PRIV-01, PRIV-02) still differentiate. |
| **Day 8** | Dashboard is not functional (no wallet connection, no portfolio view) | Ship CLI-only. Take screenshots of any partial dashboard for README. Invest remaining time in CLI polish and demo video quality. | Lose DASH-01 through DASH-07 and STRAT-04. CLI becomes the primary demo interface. |
| **Day 9** | Any feature requires a workaround or hack to demo | Cut that feature entirely. Only ship what works flawlessly with zero workarounds. | Better to demo 5 features perfectly than 8 features with bugs. |

### Priority Tiers for Cuts

**Never Cut (P0 core)**:
- Jupiter swaps (DEFI-01)
- Advisory mode (AGENT-01)
- Risk manager VETO (RISK-01)
- CLI status command (CLI-01)
- Pitch video (SUB-02)

**Cut Last (P0 supporting)**:
- Marinade staking (DEFI-02)
- Natural language (AGENT-03)
- Wallet connection (DASH-05)
- README (SUB-01)
- Devnet deployment (INFRA-03)

**Cut First if Behind (P1)**:
- Raydium LP (DEFI-03)
- Kamino vaults (DEFI-04)
- The Wheel visualization (STRAT-04, DASH-02)
- Risk controls panel (DASH-07)
- Technical demo video (SUB-03)
- CI-ready test suite (INFRA-05)

---

## Phase Summary

| Phase | Days | Requirements | Focus |
|-------|------|-------------|-------|
| 1. Foundation | 1-2 | 6 | Monorepo, types, Jupiter, CLI skeleton, vault program |
| 2. Core DeFi | 3-4 | 9 | Marinade, Raydium, Kamino, router, execution, risk manager |
| 3. Agent Intelligence | 4-5 | 9 | Strategy engine, OODA loop, advisory/auto modes, NL parser |
| 4. Privacy Layer | 5-7 | 6 | Circom port, stealth, shielded, privacy program, two-phase commit |
| 5. CLI Interface | 6-7 | 6 | All CLI commands, NL interface, formatted output |
| 6. Dashboard | 7-8 | 8 | Next.js, The Wheel, portfolio, strategy panel, wallet, branding |
| 7. Submission | 9-10 | 6 | E2E tests, devnet deploy, videos, README, demo prep |
| **Total** | **10** | **50 mappings (40 unique)** | |

---

*Created: 2026-02-02 | Feeds into STATE.md and phase branches*

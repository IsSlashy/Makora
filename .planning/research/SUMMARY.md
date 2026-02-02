# Research Summary

> Synthesized from STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md
> Project context: PROJECT.md (Mahoraga -- Adaptive DeFi Agent for Solana)
> Date: 2026-02-02

---

## Stack Recommendation

### Definitive Choices

| Layer | Package | Version | Notes |
|-------|---------|---------|-------|
| **Solana SDK** | `@solana/web3.js` | ^1.98.4 | v1 ONLY -- v2/@solana/kit breaks Anchor |
| **Anchor (TS)** | `@coral-xyz/anchor` | ^0.30.1 | Match Rust side |
| **Anchor (Rust)** | `anchor-lang` + `anchor-spl` | 0.30.1 | Battle-tested from P01, no migration risk |
| **Solana Program** | `solana-program` | 1.18.17 | Same as P01 |
| **Jupiter** | `@jup-ag/api` | ^6.0.48 | REST client, NOT @jup-ag/core (deprecated) |
| **Raydium** | `@raydium-io/raydium-sdk-v2` | ^0.2.32-alpha | Pin exact version (alpha) |
| **Marinade** | `@marinade.finance/marinade-ts-sdk` | ^5.0.15 | Stable, audited |
| **Kamino** | `@kamino-finance/klend-sdk` | ^7.1.6 | Watch for @solana/kit transitive dep conflict |
| **Agent Toolkit** | `solana-agent-kit` + plugins | latest | 60+ actions, Jupiter/Raydium/Marinade built-in |
| **ZK Proofs** | `snarkjs` | ^0.7.5 | Groth16 on bn128 curve (Solana-compatible) |
| **ZK On-Chain** | `groth16-solana` (Rust crate) | 0.2.0 | <200k CU verification. Negate proof.A y-coord! |
| **ZK Circuits** | Circom 2 | latest | Reuse P01 circuits + ptau files |
| **ZK Libs** | `circomlibjs` ^0.1.7, `poseidon-lite` ^0.2.0 | - | Match P01 |
| **Frontend** | Next.js | 15.x | NOT 16 -- too new for 10-day build |
| **Charts** | `lightweight-charts` | ^5.1.0 | 35kB, TradingView attribution required |
| **UI** | Tailwind CSS ^4.0 + Radix UI | - | Clean without heavy component libs |
| **Wallet** | `@solana/wallet-adapter-*` | latest | Phantom, Solflare, Backpack |
| **CLI** | `commander` | ^14.x | Standard Node.js CLI toolkit |
| **Tests (unit)** | Vitest | ^4.0.17 | Native ESM + TS, fastest runner |
| **Tests (chain)** | `solana-bankrun` + `anchor-bankrun` | 0.4.0 | 10x faster than test-validator |
| **Tests (e2e)** | `ts-mocha` + `chai` | latest | Matches P01 pattern |
| **Monorepo** | pnpm 8.x + Turborepo ^2.0 | - | Proven from P01 |
| **TypeScript** | ^5.3 | - | ES2022 target, NodeNext module |
| **RPC** | Helius (primary), QuickNode (fallback) | - | Free tier: 1M credits/month, 10 RPS |
| **Rust** | 1.75 | - | MSRV for Solana platform-tools |

### Do NOT Use

- `@solana/kit` / `@solana/web3.js@2` -- Anchor incompatible
- `@jup-ag/core` -- deprecated 2+ years
- `@raydium-io/raydium-sdk` v1 -- deprecated
- Anchor 0.32.x for Rust programs -- migration risk
- webpack 5 -- Anchor native module incompatibility
- Jest -- use Vitest instead
- PLONK/FFLONK -- Solana optimized for Groth16 only
- React Native / Expo -- 10 days, web + CLI is enough
- Next.js 16 -- too new, no clear ROI
- `lite-api.jup.ag` -- deprecated 2026-01-31

---

## Feature Priorities

### P0 -- Table Stakes (Must ship or project looks incomplete)

| Feature | Complexity | Notes |
|---------|-----------|-------|
| Token swaps via Jupiter | Low | Core DeFi capability |
| Portfolio view (balances + USD values) | Low | Real-time pricing |
| Marinade staking (SOL -> mSOL) | Low | Yield entry point |
| Natural language interface | Medium | "Swap 10 SOL to USDC" must work |
| Advisory mode (suggest + confirm) | Low | Human-in-the-loop |
| Risk warnings (slippage, liquidity) | Medium | Safety baseline |
| Transaction history | Low | Human-readable |
| Wallet connection | Low | Phantom/Solflare/Backpack |
| Clean web dashboard | Medium | Judges need to see and use it |
| Action confirmation dialogs | Low | Show what happens before executing |

### P1 -- Differentiators (What wins the hackathon)

| Feature | Complexity | Impact | Why It Matters |
|---------|-----------|--------|----------------|
| Privacy-shielded transfers (stealth addresses) | Medium | VERY HIGH | **Zero competition.** No other DeFi agent has privacy. |
| ZK-verified balances | Medium | HIGH | Proves ZK competence to judges |
| Dual mode: Advisory + Auto with guardrails | Medium | HIGH | Shows maturity (GLAM proved this works) |
| Adaptive strategy engine (The Wheel) | High | HIGH | **This IS the product.** The name demands it. |
| Multi-protocol orchestration | Medium | HIGH | Single command -> multi-step DeFi operations |
| Raydium LP management | Medium | Medium | Breadth of protocol coverage |
| Kamino vault deposits | Medium | Medium | Additional yield source |

### P2 -- Nice-to-Have (Build only if ahead of schedule)

- Yield comparison across protocols
- Position health monitoring / alerts
- Smart money (whale) tracking
- Private DeFi receipts (ZK proof receipts)
- Strategy backtesting

### Anti-Features (Do NOT Build)

- **Token / tokenomics** -- zero technical merit, screams meme project
- **Fully autonomous trading** -- AI agents are bad at trading crypto; live losses = lost hackathon
- **Multi-chain** -- this is a Solana hackathon, go deep not wide
- **NFT features** -- solved problem, dilutes narrative
- **Twitter bot** -- contradicts privacy story
- **Complex Bloomberg-style dashboard** -- half-baked clone will be compared unfavorably
- **MEV protection** -- Jupiter already handles this

---

## Architecture Blueprint

### Pattern: Modular Monolith

Single-process deployment with clean package boundaries. No microservices (over-engineered for 10 days). No monolith (too coupled). Mirrors P01 and Solana Agent Kit v2 plugin architecture.

### Component Map

```
Dashboard (Next.js) + CLI (Commander.js)
              |
        Agent Core (OODA decision loop)
              |
   +----------+----------+
   |          |          |
Strategy   Risk      Execution
Engine    Manager    Engine
   |          |          |
   +----------+----------+
              |
       Protocol Router
              |
   +----+----+----+----+
   |    |    |    |    |
  Jup  Ray  Mar  Kam  Privacy
  Adp  Adp  Adp  Adp  Adapter
```

### Key Decisions

1. **Adapter pattern** for all protocol integrations -- uniform `ProtocolAdapter` interface. Agent core never touches protocol SDKs directly.
2. **Risk Manager has VETO power** -- hard architectural constraint, not a soft check.
3. **Two-phase commit for ZK + DeFi** -- never combine ZK verification and DeFi execution in one transaction (CU and size limits make it impossible).
4. **Three Solana programs** -- `mahoraga_vault` (escrow/treasury), `mahoraga_strategy` (params/permissions/audit), `mahoraga_privacy` (ZK pool, stealth, ported from P01).
5. **Tiered data feed** -- WebSocket (Pyth/Helius) for real-time + polling (15s) for reliable baseline. No Geyser gRPC for hackathon.
6. **Privacy is additive** -- core DeFi agent works without privacy. Privacy layer can be cut if behind schedule without breaking the product.

### Package Dependency Chain

```
@mahoraga/types (leaf -- no deps)
  -> @mahoraga/data-feed
    -> @mahoraga/adapters/* (jupiter, raydium, marinade, kamino)
      -> @mahoraga/protocol-router
        -> @mahoraga/execution-engine
  -> @mahoraga/privacy (parallel track, depends only on types + circom artifacts)
  -> @mahoraga/risk-manager
  -> @mahoraga/strategy-engine
    -> @mahoraga/agent-core (top of tree)
      -> apps/cli, apps/dashboard
```

### Critical Path

```
Types -> DataFeed -> Jupiter Adapter -> Protocol Router -> Execution Engine
  -> Strategy Engine -> Agent Core -> CLI (advisory mode)
```

This path must complete by Day 6. Privacy is a parallel track that merges at the Execution Engine level.

---

## Critical Pitfalls to Avoid

### Top 10 (ranked by probability x impact)

| # | Pitfall | What Happens | Prevention |
|---|---------|-------------|------------|
| 1 | **Overscoping** (C3) | Day 7: multiple half-done features, nothing demo-ready | Define MVP for Day 5. Cut ruthlessly. Jupiter alone routes through Raydium/Orca -- 1 protocol deep > 4 shallow. |
| 2 | **TX size limit (1232 bytes)** (C1) | ZK proof + DeFi instructions do not fit in one transaction | Use Address Lookup Tables. ALWAYS split ZK verification and DeFi execution into separate transactions. Budget 600 bytes for proof, 600 for everything else. |
| 3 | **Compute unit exhaustion** (C2) | Groth16 verify = 200-400k CU, Jupiter swap = 100-300k CU. Combined = exceeds 1.4M max. | Two-phase commit: (1) verify proof + store result in PDA, (2) DeFi operation references verified proof. Set explicit CU limits with `SetComputeUnitLimit`. |
| 4 | **Account validation failures** (C4) | #1 Solana exploit vector. Wormhole lost $325M from this. | Use Anchor `has_one`, `seeds`, `bump`, `constraint` on EVERY account. Write negative tests with wrong/malicious accounts. |
| 5 | **SDK version conflicts** (D2) | Runtime borsh/Pubkey type mismatches between Jupiter, Raydium, Kamino SDKs | pnpm strict resolution. Isolate each protocol in its own workspace package. Test all imports Day 1. |
| 6 | **Demo day failure** (H1) | RPC down, devnet reset, proof generation too slow, blockhash expired | Record backup demo video (mandatory). Use private RPC. Pre-compute ZK proofs. Practice 5+ times. |
| 7 | **Toolchain version mismatch** (H3) | Cryptic build errors waste hours | Lock ALL versions Day 1: Rust 1.75, Solana CLI 1.18.x, Anchor CLI 0.30.1, Node 20+. Use `rust-toolchain.toml`. |
| 8 | **ZK proof generation too slow** (Z1) | Users wait 30+ seconds, browser tab unresponsive | Keep circuits under 10k constraints. Server-side proof generation. Show progress indicators. Reuse P01's proven circuits. |
| 9 | **Arithmetic overflow** (S4) | Silent wrap in Rust release mode -> catastrophic fund miscalculation | `overflow-checks = true` in Cargo.toml. Use `checked_*` arithmetic for ALL financial math. `u128` for intermediates. |
| 10 | **"All code by AI" rule** (H5) | Disqualification if commit history shows human-written code | All code via Claude/OpenClaw. Maintain clear commit history. Keep agent session logs. |

### Quick-Reference Prevention Checklist

- [ ] Separate ZK verification from DeFi execution (fixes C1 + C2 + Z2)
- [ ] Anchor constraints on every account (fixes C4 + S5)
- [ ] MVP defined, feature cuts by Day 5 (fixes C3 + H1)
- [ ] Private RPC endpoint configured (fixes SOL1 + D3 + H1)
- [ ] Backup demo video recorded (fixes H1)
- [ ] Toolchain versions locked Day 1 (fixes H3)
- [ ] `checked_*` arithmetic everywhere (fixes S4)
- [ ] ZK circuits under 10k constraints (fixes Z1 + Z4)
- [ ] Negative tests for every instruction (fixes C4 + T5)
- [ ] TX byte budget calculated before sending (fixes C1 + Z2)

---

## Key Insights for Mahoraga

### 1. The Real Differentiator is Privacy, Not DeFi

Every competitor has DeFi. GLAM, ai16z, Laura AI, SOLTRADE -- all do trading/portfolio management. **None have privacy.** The gap in the market is "AI agent + ZK privacy." This is what judges will remember. Do not sacrifice the privacy layer to add another DeFi protocol.

### 2. Jupiter Is Enough for DeFi Breadth

Jupiter already aggregates Raydium, Orca, Lifinity, Meteora, Phoenix, and OpenBook. For swaps, Jupiter alone provides multi-protocol coverage without needing separate SDK integrations. Direct Raydium/Kamino adapters are only needed for LP management and lending -- features that are P1, not P0.

### 3. Hackathon Winners Create Novel Primitives

Every Colosseum grand prize winner created something new: Ore (new mining), Reflect (new stablecoin), TAPEDRIVE (new storage), Unruggable (hardware wallet). Privacy-enabled AI agent is a new primitive. It needs to feel like a new category, not a wrapper.

### 4. The Demo Is More Important Than the Code

Judges watch the pitch video first. A 3-minute demo of a working agent shielding transactions and adapting strategies will beat a technically deeper project with a broken demo. Allocate 2 full days (Days 9-10) for demo preparation.

### 5. Overscoping Is the #1 Risk

4 protocol integrations + ZK privacy + adaptive strategies + dashboard + CLI in 10 days is extremely ambitious. The research consistently flags this. The mitigation is clear: P0 features must work by Day 5. Privacy layer (P1) by Day 8. Days 9-10 are demo/polish only.

### 6. P01 Is the Secret Weapon

The ZK circuits, stealth address implementation, and shielded transfer programs from P01 are production-tested. Porting them (not rewriting) saves 3-4 days of development. This is the single biggest advantage over competitors who must build ZK from scratch.

### 7. Two-Phase Commit for ZK Is Non-Negotiable

ZK verification and DeFi execution physically cannot coexist in one Solana transaction (size + compute limits). The architecture must support: TX1 = verify proof + store result in PDA, TX2 = DeFi operation referencing the verified proof. Design this on Day 1, not Day 7.

### 8. Advisory Mode Is Safer for Demos

Fully autonomous trading demos can lose money live, which kills the hackathon. Advisory mode (agent suggests, user confirms) is safer, more impressive, and avoids the "AI agents are bad at trading" narrative. Auto mode should exist but not be the demo default.

---

## Build Order Recommendation

### Day 1-2: Foundation + First Value

| Task | Package | Deliverable |
|------|---------|-------------|
| Monorepo scaffolding | root | pnpm + turbo + tsconfig compiles |
| Shared types | `@mahoraga/types` | All interfaces defined |
| Solana connection + wallet | `@mahoraga/data-feed` | Connect to Helius, read balances |
| Jupiter adapter (swap) | `@mahoraga/adapters/jupiter` | Execute a devnet swap |
| Anchor workspace + vault program stub | `programs/mahoraga_vault` | Builds, deploys to localnet |
| CLI skeleton | `apps/cli` | `mahoraga status` shows wallet balance |
| Lock all toolchain versions | root | README documents exact versions |

**Checkpoint Day 2**: Can swap tokens via CLI.

### Day 3-4: Core DeFi Agent

| Task | Package | Deliverable |
|------|---------|-------------|
| Marinade adapter (stake) | `@mahoraga/adapters/marinade` | Stake/unstake SOL |
| Protocol router | `@mahoraga/protocol-router` | Routes actions to correct adapter |
| Execution engine | `@mahoraga/execution-engine` | Builds + submits versioned TXs |
| Risk manager | `@mahoraga/risk-manager` | Validates actions, enforces limits |
| Strategy engine (yield optimizer) | `@mahoraga/strategy-engine` | Suggests rebalancing actions |
| Agent core (OODA loop) | `@mahoraga/agent-core` | Advisory mode working |
| CLI: advisory commands | `apps/cli` | Full advisory flow end-to-end |

**Checkpoint Day 4**: Agent suggests and executes multi-protocol strategies via CLI. Advisory mode works.

### Day 5-6: Privacy Layer (Parallel track can start Day 3)

| Task | Package | Deliverable |
|------|---------|-------------|
| Port Circom circuits from P01 | `circuits/` | Compiled WASM + zkey |
| Privacy module (stealth + shielded) | `@mahoraga/privacy` | Generate proofs, derive stealth addresses |
| Privacy Anchor program (port from P01) | `programs/mahoraga_privacy` | On-chain ZK verification |
| Privacy adapter | `@mahoraga/adapters/privacy` | Integrated into protocol router |
| Two-phase commit integration | `@mahoraga/execution-engine` | ZK verify TX -> DeFi TX pipeline |
| Auto mode with guardrails | `@mahoraga/agent-core` | Executes within risk limits |

**Checkpoint Day 6**: Privacy-shielded transfers work. Agent has both advisory and auto modes.

### Day 7-8: Dashboard + Integration

| Task | Package | Deliverable |
|------|---------|-------------|
| Dashboard: portfolio overview | `apps/dashboard` | Balances, positions, P&L |
| Dashboard: The Wheel visualization | `apps/dashboard` | Adaptation cycle indicator |
| Dashboard: strategy view + history | `apps/dashboard` | Active strategies, TX history |
| Dashboard: wallet connection | `apps/dashboard` | Phantom/Solflare connect |
| Raydium adapter (LP, if time) | `@mahoraga/adapters/raydium` | Optional P1 |
| Kamino adapter (vaults, if time) | `@mahoraga/adapters/kamino` | Optional P1 |
| Integration tests | `tests/` | E2E agent -> program -> verify |

**Checkpoint Day 8**: Dashboard is usable. Full flow works end-to-end. Demo-ready.

### Day 9-10: Polish + Submission

| Task | Deliverable |
|------|-------------|
| Bug fixes + edge cases | Stability |
| Negative tests (wrong accounts, overflow) | Security |
| Record backup demo video | Mandatory safety net |
| Record pitch video (under 3 min) | Most important submission artifact |
| Record technical demo (2-3 min) | Implementation walkthrough |
| README + screenshots | Clean repo for judges |
| Deploy to devnet | Live demo environment |
| Practice demo flow 5+ times | Smooth delivery |

**Checkpoint Day 10**: Submitted. Pitch video, technical demo, working prototype, clean repo.

### Parallel Tracks

```
Track A (DeFi):     Types -> Jupiter -> Marinade -> Router -> Execution -> Strategy -> Agent Core
Track B (Privacy):  Circom port -> Privacy module -> Privacy program -> Privacy adapter -> Execution
Track C (UI):       CLI skeleton (Day 1) -----> CLI commands (Day 3-4) -----> Dashboard (Day 7-8)
```

Track B can run independently until it merges with Track A at the Execution Engine (Day 5-6).
Track C starts early (CLI) and finishes late (Dashboard), with independent progress throughout.

### Scope Cut Decision Points

- **Day 3**: If SDK conflicts are unresolved, drop Raydium and Kamino. Jupiter + Marinade is sufficient.
- **Day 5**: If agent core is not working in advisory mode, stop all new features and stabilize.
- **Day 6**: If privacy circuits are not compiling, switch to demo-only privacy (pre-computed proofs, no live generation).
- **Day 8**: If dashboard is not functional, ship CLI-only with screenshots of dashboard WIP.
- **Day 9**: Cut any feature that requires a workaround to demo. Only ship what works flawlessly.

---

*This summary feeds directly into requirements spec and roadmap. No further research is needed -- build.*

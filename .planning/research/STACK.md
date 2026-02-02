# Stack Research — Mahoraga: Adaptive DeFi Agent for Solana

> Researched: 2026-02-02
> Confidence levels: HIGH (verified on npm/crates.io), MEDIUM (active but evolving), LOW (emerging/unverified)

---

## Table of Contents

1. [Recommended Stack Summary](#recommended-stack-summary)
2. [Solana Core Infrastructure](#solana-core-infrastructure)
3. [Solana DeFi Protocol SDKs](#solana-defi-protocol-sdks)
4. [Agent Framework](#agent-framework)
5. [ZK/Privacy Stack](#zkprivacy-stack)
6. [On-Chain Programs (Rust)](#on-chain-programs-rust)
7. [Frontend](#frontend)
8. [CLI](#cli)
9. [Testing](#testing)
10. [Monorepo & Build](#monorepo--build)
11. [RPC & Infrastructure](#rpc--infrastructure)
12. [What NOT to Use](#what-not-to-use)
13. [Build Order Implications](#build-order-implications)
14. [P01 Reference Versions](#p01-reference-versions)

---

## Recommended Stack Summary

| Layer | Technology | Version | Confidence |
|-------|-----------|---------|------------|
| **Solana JS SDK** | `@solana/web3.js` (v1.x) | ^1.98.x | HIGH |
| **Anchor TS Client** | `@coral-xyz/anchor` | ^0.30.1 | HIGH |
| **Anchor Rust** | `anchor-lang` | 0.30.1 | HIGH |
| **Jupiter** | `@jup-ag/api` | ^6.0.48 | HIGH |
| **Raydium** | `@raydium-io/raydium-sdk-v2` | ^0.2.32-alpha | MEDIUM |
| **Marinade** | `@marinade.finance/marinade-ts-sdk` | ^5.0.15 | HIGH |
| **Kamino Lend** | `@kamino-finance/klend-sdk` | ^7.1.6 | HIGH |
| **Kamino Liquidity** | `@kamino-finance/kliquidity-sdk` | ^8.5.5 | HIGH |
| **Agent Kit** | `solana-agent-kit` + plugins | latest | HIGH |
| **ZK Circuits** | Circom 2 + snarkjs | 0.7.5 | HIGH |
| **ZK On-Chain** | `groth16-solana` (Rust crate) | 0.2.0 | HIGH |
| **Frontend** | Next.js | 15.x (stable) | HIGH |
| **Charts** | `lightweight-charts` | ^5.1.0 | HIGH |
| **CLI** | Commander.js | ^14.x | HIGH |
| **Unit Tests** | Vitest | ^4.0.17 | HIGH |
| **On-Chain Tests** | solana-bankrun + anchor-bankrun | 0.4.0 / latest | HIGH |
| **Monorepo** | pnpm + Turborepo | pnpm 8.x, turbo ^2.0 | HIGH |
| **TypeScript** | TypeScript | ^5.3.x | HIGH |
| **RPC Provider** | Helius (primary) | - | HIGH |

---

## Solana Core Infrastructure

### @solana/web3.js v1.x (USE THIS)

```
npm install @solana/web3.js@^1.98.4
```

- **Version**: ^1.98.4 (latest 1.x line)
- **Confidence**: HIGH
- **Rationale**: Anchor (both `@coral-xyz/anchor` and `anchor-bankrun`) is ONLY compatible with web3.js v1. The v2 successor (@solana/kit v3.0.3) exists but Anchor does NOT support it yet. Since we rely heavily on Anchor for on-chain programs, we MUST stay on v1.
- **CRITICAL**: Do NOT install `@solana/kit` or `@solana/web3.js@2` — they are incompatible with Anchor's TypeScript client.

### @solana/kit v3.0.3 (DO NOT USE — yet)

- The successor to web3.js, formerly called web3.js v2
- Tree-shakable, modular, 10x faster crypto
- **Why not**: Anchor TypeScript client (`@coral-xyz/anchor`) is NOT compatible with it
- **Future**: Use Codama to generate kit-compatible clients when Anchor adds support

### @coral-xyz/anchor (TypeScript Client)

```
npm install @coral-xyz/anchor@^0.30.1
```

- **Version**: 0.30.1 (matches our Rust programs) or ^0.32.1 (latest)
- **Confidence**: HIGH
- **Rationale**: Standard Anchor TypeScript client. 1,411 projects use it, 301k weekly downloads.
- **Note**: Depends on Node.js native modules; webpack 5 may have issues.

### @solana/spl-token

```
npm install @solana/spl-token@^0.4.14
```

- **Version**: ^0.4.14
- **Confidence**: HIGH
- **Rationale**: Required for all SPL token operations (transfers, mints, account creation).

---

## Solana DeFi Protocol SDKs

### Jupiter Exchange — `@jup-ag/api`

```
npm install @jup-ag/api@^6.0.48
```

- **Version**: 6.0.48 (published ~21 days ago, actively maintained)
- **Confidence**: HIGH
- **API Pattern**: REST-based via `createJupiterApiClient()`
- **Features**: Token swaps, route optimization, quote fetching
- **Note**: `@jup-ag/core` is DEPRECATED (last update 2+ years ago). Use ONLY `@jup-ag/api`.
- **WARNING**: `lite-api.jup.ag` was deprecated on 2026-01-31. Use the standard API endpoint.
- **Usage**:
  ```typescript
  import { createJupiterApiClient } from '@jup-ag/api';
  const jupiterApi = createJupiterApiClient();
  const quote = await jupiterApi.quoteGet({ inputMint, outputMint, amount });
  const swap = await jupiterApi.swapPost({ swapRequest: { quoteResponse: quote, userPublicKey } });
  ```

### Raydium — `@raydium-io/raydium-sdk-v2`

```
npm install @raydium-io/raydium-sdk-v2@^0.2.32-alpha
```

- **Version**: 0.2.32-alpha (published ~13 days ago)
- **Confidence**: MEDIUM (still alpha, but actively maintained)
- **Features**: AMM V4, CLMM (concentrated liquidity), CPMM pools, LP management
- **Note**: V1 SDK (`@raydium-io/raydium-sdk`) is DEPRECATED (2 years stale). Use V2 only.
- **Consideration**: Alpha status means potential breaking changes. Pin exact version in lockfile.

### Marinade Finance — `@marinade.finance/marinade-ts-sdk`

```
npm install @marinade.finance/marinade-ts-sdk@^5.0.15
```

- **Version**: 5.0.15
- **Confidence**: HIGH
- **Features**: Liquid staking (mSOL), native staking, stake management, validator delegation
- **Additional SDK**: `@marinade.finance/native-staking-sdk` for native staking operations
- **Usage**: Wrap SOL -> mSOL for yield generation, manage stake accounts
- **Note**: Audited by 5 security firms, SOC 2 certified infrastructure

### Kamino Finance — Multiple SDKs

```
npm install @kamino-finance/klend-sdk@^7.1.6
npm install @kamino-finance/kliquidity-sdk@^8.5.5
npm install @kamino-finance/farms-sdk
npm install @kamino-finance/scope-sdk
```

| Package | Version | Purpose |
|---------|---------|---------|
| `@kamino-finance/klend-sdk` | 7.1.6 | Lending/borrowing (largest lending protocol on Solana) |
| `@kamino-finance/kliquidity-sdk` | 8.5.5 | Concentrated liquidity strategies, auto-compounding |
| `@kamino-finance/farms-sdk` | latest | Yield farming |
| `@kamino-finance/scope-sdk` | latest | Oracle price feeds |

- **Confidence**: HIGH (klend published 3 days ago)
- **Dependencies**: kliquidity-sdk depends on `@solana/kit` (!) and `@raydium-io/raydium-sdk-v2`
- **IMPORTANT**: May need to handle `@solana/kit` as a transitive dependency carefully to avoid conflicts with web3.js v1

---

## Agent Framework

### Primary: Solana Agent Kit (`solana-agent-kit`)

```
npm install solana-agent-kit
npm install @solana-agent-kit/plugin-defi
npm install @solana-agent-kit/plugin-token
npm install @solana-agent-kit/plugin-misc
```

- **Confidence**: HIGH
- **Rationale**: Purpose-built for exactly what we need — AI agents interacting with Solana DeFi protocols
- **Features**:
  - 60+ autonomous Solana actions out of the box
  - Pre-built Jupiter, Raydium, Marinade integrations
  - Plugin architecture: `plugin-defi`, `plugin-token`, `plugin-nft`, `plugin-misc`, `plugin-blinks`
  - Compatible with LangChain, Vercel AI SDK, Claude, OpenAI
  - MCP (Model Context Protocol) support
- **DeFi Plugin capabilities**:
  - Jupiter swaps (V2 API), limit orders, DCA orders
  - Raydium pool creation (CPMM, CLMM, AMMv4)
  - Staking, lending, borrowing across protocols
  - Token security checks via Jupiter Shield
  - Wallet holdings with USD values

### Secondary: LangChain.js (if needed for orchestration)

```
npm install langchain @langchain/core
```

- **Confidence**: MEDIUM
- **Rationale**: Only if we need complex multi-step reasoning chains, memory management, or tool orchestration beyond what solana-agent-kit provides
- **Features**: State management, checkpointing, human-in-the-loop, tool chaining
- **LangGraph**: For complex finite state machine agent logic (branching, parallel execution)

### Recommendation

Use **solana-agent-kit as the primary agent layer** for all DeFi interactions. It already has Jupiter, Raydium, and other protocol integrations built in. Layer LangChain.js on top ONLY if we need advanced reasoning chains or conversation management. For a 10-day hackathon, solana-agent-kit alone should be sufficient.

---

## ZK/Privacy Stack

### Circuit Compilation: Circom 2

```
# Install Circom compiler (Rust-based, system-level)
# Pre-built binaries or cargo install circom
```

- **Version**: Latest Circom 2 (written in Rust)
- **Confidence**: HIGH
- **Compilation flags**: `--r1cs --wasm --sym` (standard for Groth16 workflow)
- **Optimization**: Use `--O1` (new default) for production circuits
- **Note**: Circom outputs R1CS constraints + WASM witness generator

### Proof Generation: snarkjs

```
npm install snarkjs@^0.7.5
```

- **Version**: 0.7.5 (latest stable)
- **Confidence**: HIGH
- **Proving systems supported**: Groth16, PLONK, FFLONK (beta)
- **Curves**: bn128 (required for Solana's alt_bn128 syscalls), bls12-381
- **IMPORTANT**: Use bn128 curve for Solana compatibility
- **Security**: Do NOT use versions before 0.7.x (security bugs in older versions)
- **Workflow**:
  1. Compile circuit with Circom -> R1CS + WASM
  2. Powers of Tau ceremony (use existing `pot20_final.ptau` from P01)
  3. Circuit-specific setup -> zkey
  4. Generate proof -> proof.json + public.json
  5. Verify on-chain with groth16-solana

### Supporting Libraries

```
npm install circomlibjs@^0.1.7    # Circom standard library (JS bindings)
npm install circomlib@^2.0.5       # Circom circuit library (Poseidon, MiMC, etc.)
npm install poseidon-lite@^0.2.0   # Lightweight Poseidon hash
npm install ffjavascript@^0.3.0    # Finite field arithmetic
npm install @types/snarkjs@^0.7.8  # TypeScript types for snarkjs
```

### On-Chain ZK Verification: groth16-solana (Rust Crate)

```toml
# In Cargo.toml
[dependencies]
groth16-solana = "0.2.0"
```

- **Version**: 0.2.0 (latest, published ~1 month ago)
- **Confidence**: HIGH
- **Publisher**: Light Protocol (audited during Light v3 audit)
- **Performance**: Verification takes < 200,000 compute units
- **Requirements**: Solana 1.18.x+ (alt_bn128 syscalls must be active)
- **CRITICAL**: Proof.A y-coordinate must be negated before passing to the verifier. The library expects `-A` (not `A`).
- **Integration**: Generate verifying key from snarkjs `verificationkey.json`, use JS script to convert to Rust format

### Arkworks Libraries (Rust, for on-chain)

```toml
# In Cargo.toml (already proven in P01)
ark-bn254 = "0.4.0"
ark-groth16 = "0.4.0"
ark-serialize = "0.4.0"
ark-ff = "0.4.0"
ark-ec = "0.4.0"
ark-std = "0.4.0"
```

- **Confidence**: HIGH (identical to P01 production setup)
- **Note**: These are only needed if we do custom verification logic beyond groth16-solana

### Light Protocol (ZK Compression) — Optional Enhancement

```
npm install @lightprotocol/stateless.js
npm install @lightprotocol/compressed-token
```

- **Confidence**: MEDIUM
- **Use case**: If we want to add compressed accounts/tokens for cost reduction (5000x cheaper storage)
- **Benefit**: Rent-free token accounts, compressed PDAs
- **Risk**: Adds complexity; may not be needed for MVP
- **Recommendation**: Consider for V2, not MVP

### Privacy Circuit Architecture (Based on P01 Experience)

For Mahoraga's privacy layer, the proven pattern from P01:

1. **Stealth Addresses**: ECDH key exchange for one-time addresses
2. **Shielded Transfers**: Merkle tree + nullifier + Poseidon hash in Circom circuit
3. **Proof of concept**: P01's `circuits/transfer.circom` and `programs/zk_shielded` serve as direct templates
4. **WASM witness generation**: Fastest path for Node.js integration

---

## On-Chain Programs (Rust)

### Anchor Framework

```toml
# In Cargo.toml
[dependencies]
anchor-lang = "0.30.1"
anchor-spl = "0.30.1"
```

- **Version**: 0.30.1 (same as P01, proven stable)
- **Latest available**: 0.32.1 (but 0.30.1 is battle-tested with our Solana version)
- **Confidence**: HIGH
- **Solana compatibility**: Solana 1.18.x
- **Note**: Anchor 0.32.x has newer features but may introduce migration risks in a 10-day window

### Solana Program Dependencies

```toml
[dependencies]
solana-program = "1.18.17"

[dev-dependencies]
solana-sdk = "1.18.17"
```

- **Version**: 1.18.17 (same as P01)
- **Confidence**: HIGH

### Serialization

```toml
[dependencies]
borsh = "1.5"
```

### Build Toolchain

- **Rust version**: 1.75 (MSRV for Solana platform-tools compatibility)
- **Solana CLI**: 1.18.x
- **Anchor CLI**: 0.30.1 (install via AVM)

---

## Frontend

### Next.js

```
npx create-next-app@15
```

- **Version**: 15.x (stable, with App Router)
- **Confidence**: HIGH
- **Note**: Next.js 16 was released October 2025 with React 19.2, but 15.x is more battle-tested for a 10-day build
- **Features to use**: App Router, Server Components, Turbopack (dev mode)
- **Why not v16**: Newer features (Cache Components, View Transitions) add complexity without clear benefit for our use case in 10 days

### Charting: TradingView Lightweight Charts

```
npm install lightweight-charts@^5.1.0
```

- **Version**: 5.1.0 (published ~1 month ago)
- **Confidence**: HIGH
- **Size**: ~35kB (after v5.0 tree-shaking improvements)
- **Features**: Candlestick, area, line, baseline charts; multi-pane support; custom plugins
- **License**: Apache 2.0 (requires TradingView attribution)
- **Integration**: Works with Next.js via dynamic import (client-side only, uses HTML5 canvas)
- **Real-time**: Feed WebSocket data directly to chart series via `update()` method

### UI Components

```
npm install tailwindcss@^4.0
npm install @radix-ui/react-*        # Headless UI primitives
npm install class-variance-authority  # For component variants
npm install clsx                      # Conditional classnames
```

- **Confidence**: HIGH
- **Rationale**: Tailwind + Radix gives professional UI without heavy component libraries
- **Alternative**: shadcn/ui (copies components into your project, Tailwind + Radix based)

### Wallet Integration

```
npm install @solana/wallet-adapter-base
npm install @solana/wallet-adapter-react
npm install @solana/wallet-adapter-react-ui
npm install @solana/wallet-adapter-wallets
```

- **Confidence**: HIGH
- **Supports**: Phantom, Solflare, Backpack, and 20+ wallets

### Real-Time Data

- **Helius WebSockets**: For on-chain event streaming (account changes, transaction confirmations)
- **Helius DAS API**: For token balances, NFT metadata
- **Jupiter Price API**: For real-time token prices
- **Socket.io or native WebSocket**: For agent status updates from backend to frontend

---

## CLI

### Commander.js

```
npm install commander@^14.0.0
```

- **Version**: 14.x (latest major, requires Node 20+)
- **Confidence**: HIGH
- **Rationale**: De facto standard for Node.js CLIs. 25M+ weekly downloads. Used by Vue CLI, Create React App.
- **Features**: Command chaining, subcommands, variadic arguments, automatic help generation

### Supporting CLI Libraries

```
npm install chalk@^5.0.0          # Terminal colors (ESM)
npm install ora@^8.0.0            # Spinners for async operations
npm install inquirer@^12.0.0      # Interactive prompts
npm install cli-table3@^0.6.0     # Table formatting
```

### CLI Architecture

```
mahoraga-cli/
  commands/
    portfolio.ts    # View portfolio, positions
    swap.ts         # Execute swaps via Jupiter
    stake.ts        # Stake/unstake via Marinade
    lend.ts         # Lend/borrow via Kamino
    agent.ts        # Start/stop/configure the agent
    privacy.ts      # Stealth address, shielded transfer
  utils/
    config.ts       # Wallet, RPC, agent config
    display.ts      # Table formatting, colors
```

---

## Testing

### Unit Tests: Vitest

```
npm install --save-dev vitest@^4.0.17
```

- **Version**: 4.0.17 (published 6 days ago)
- **Confidence**: HIGH
- **Rationale**: Native ESM + TypeScript support via Oxc, Jest-compatible API, fastest test runner in 2026
- **Features**: Watch mode (HMR-like), built-in coverage (v8/istanbul), built-in mocking (Tinyspy)
- **Config**: Reuses `vite.config.ts` or standalone `vitest.config.ts`

### On-Chain Tests: solana-bankrun + anchor-bankrun

```
npm install --save-dev solana-bankrun@^0.4.0
npm install --save-dev anchor-bankrun
```

- **Version**: solana-bankrun 0.4.0, anchor-bankrun latest
- **Confidence**: HIGH
- **Rationale**: 10x faster than solana-test-validator. Can manipulate time, set arbitrary account data.
- **Features**: `startAnchor()` for one-line Anchor program testing
- **IMPORTANT**: anchor-bankrun uses Anchor v0.30 IDL format. Compatible with our 0.30.1 programs.
- **LIMITATION**: `BankrunProvider.connection` is empty. Libraries requiring a valid `Connection` (e.g., `@solana/spl-token`) need `spl-token-bankrun` wrapper.
- **Peer dependency**: `@solana/web3.js >=1.78.4 <1.92.0` — verify compatibility with our pinned version

### Integration Tests

```
npm install --save-dev ts-mocha@^11.1.0   # For Anchor integration tests (matches P01 pattern)
npm install --save-dev chai@^6.2.2
npm install --save-dev @types/mocha@^10.0.10
npm install --save-dev @types/chai@^5.2.3
```

- **Rationale**: P01 uses ts-mocha for e2e Solana tests. Keep same pattern for consistency.
- **Use Vitest for**: SDK unit tests, frontend tests, agent logic tests
- **Use ts-mocha for**: On-chain program integration tests (Anchor standard)

### Test Strategy

| Layer | Framework | Speed | Purpose |
|-------|-----------|-------|---------|
| SDK unit tests | Vitest | Fast | Pure logic, no chain |
| Agent logic | Vitest | Fast | Decision engine, strategy tests |
| Frontend components | Vitest | Fast | React component tests |
| Solana programs | anchor-bankrun + Vitest | Medium | On-chain logic |
| E2E integration | ts-mocha + local validator | Slow | Full flow: agent -> program -> verify |
| ZK circuits | snarkjs + Vitest | Medium | Circuit constraint validation |

---

## Monorepo & Build

### pnpm Workspaces + Turborepo

```json
// package.json (root)
{
  "packageManager": "pnpm@8.15.0",
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.3.0"
  }
}
```

```yaml
# pnpm-workspace.yaml
packages:
  - "apps/*"
  - "packages/*"
  - "programs/*"
```

### Recommended Repository Structure

```
P:\solana-agent-hackathon\
  .planning/                    # Planning docs (this file)
  apps/
    web/                        # Next.js 15 dashboard
    cli/                        # Commander.js CLI
  packages/
    agent-core/                 # Agent decision engine + strategies
    defi-sdk/                   # Wrapper around Jupiter, Raydium, Marinade, Kamino
    zk-sdk/                     # ZK proof generation + stealth addresses
    privacy-sdk/                # Privacy layer (shielded transfers)
    shared/                     # Shared types, utilities, constants
    ui/                         # Shared React UI components
    tsconfig/                   # Shared TypeScript configs
  programs/
    mahoraga-vault/             # Main vault program (Anchor/Rust)
    mahoraga-privacy/           # Privacy program with ZK verification
  circuits/
    stealth/                    # Stealth address circuit
    shielded/                   # Shielded transfer circuit
  tests/
    e2e/                        # End-to-end integration tests
  turbo.json
  pnpm-workspace.yaml
  package.json
  Cargo.toml
  Anchor.toml
```

### Turborepo Configuration

```json
// turbo.json
{
  "$schema": "https://turbo.build/schema.json",
  "globalDependencies": ["**/.env.*local"],
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "target/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {}
  }
}
```

### TypeScript Configuration

- **Target**: ES2022 (for top-level await, modern features)
- **Module**: NodeNext (for ESM compatibility)
- **Strict mode**: ON
- **Shared base config**: `packages/tsconfig/base.json`

---

## RPC & Infrastructure

### Primary: Helius

- **Free tier**: 1M credits/month, 10 RPS (no credit card)
- **Features**: DAS API, Enhanced WebSockets, Priority Fee API, Transaction parsing
- **Solana-native**: Staked validator nodes, higher priority during congestion
- **Latency**: ~140ms average
- **Endpoints**: HTTP + WebSocket
- **Free plan sufficient for**: Development, testing, demo
- **URL pattern**: `https://mainnet.helius-rpc.com/?api-key=YOUR_KEY`

### Fallback: QuickNode

- **Free tier**: 10M credits, 15 RPS
- **Multi-chain**: Good fallback if Helius has issues
- **Features**: WebSockets, archive nodes

### For Development: Local Validator

```bash
solana-test-validator          # Full local validator
# OR
# Use bankrun for fast tests (no validator needed)
```

### Devnet for Staging

- Public devnet RPC: `https://api.devnet.solana.com`
- Helius devnet endpoint (free tier covers it)

---

## What NOT to Use

### DO NOT: @solana/web3.js v2 / @solana/kit

- **Why**: Anchor TypeScript client is NOT compatible. Would break all program interactions.
- **When to reconsider**: When Anchor releases v1.0 with kit support.

### DO NOT: @jup-ag/core

- **Why**: Deprecated, last published 2+ years ago. Use `@jup-ag/api` instead.

### DO NOT: @raydium-io/raydium-sdk (V1)

- **Why**: Deprecated, 2 years stale. Use `@raydium-io/raydium-sdk-v2` instead.

### DO NOT: Anchor 0.32.x for on-chain programs

- **Why**: Migration risk in a 10-day hackathon. P01 is proven stable on 0.30.1. The TypeScript client 0.32.1 is fine, but Rust programs should stay on 0.30.1.
- **Exception**: If a 0.32.x feature is critically needed, but verify Cargo.toml compatibility.

### DO NOT: webpack 5

- **Why**: @coral-xyz/anchor depends on Node.js native modules incompatible with webpack 5.
- **Use instead**: Vite (for packages) or Next.js built-in bundler (Turbopack).

### DO NOT: Jest (for new tests)

- **Why**: Vitest is faster, has native ESM/TypeScript support, and is the 2026 standard.
- **Exception**: ts-mocha for Anchor integration tests (established pattern from P01).

### DO NOT: PLONK/FFLONK for on-chain verification

- **Why**: Solana's alt_bn128 syscalls are optimized for Groth16 pairings. groth16-solana only supports Groth16. PLONK would require a custom verifier and significantly more compute units.
- **Use**: Groth16 (3 pairings, < 200k CU).

### DO NOT: React Native / Expo for this hackathon

- **Why**: 10-day timeline. Web + CLI is sufficient for demo. Mobile adds massive scope.

### DO NOT: Custom LLM orchestration from scratch

- **Why**: solana-agent-kit already handles Solana protocol integrations. Don't reinvent.

### DO NOT: Next.js 16

- **Why**: Too new (October 2025). Next.js 15.x is more stable and battle-tested. The new features (Cache Components, View Transitions) add complexity without clear ROI for a hackathon.

### DO NOT: lite-api.jup.ag

- **Why**: Deprecated as of 2026-01-31. Use the standard Jupiter API endpoint.

---

## Build Order Implications

Based on dependency analysis, the build order must be:

### Phase 1 (Days 1-2): Foundation

```
1. Monorepo scaffolding (pnpm + turbo + tsconfig)
2. Shared types/constants package (packages/shared)
3. Anchor program stubs (programs/)
4. Circom circuit compilation (circuits/)
```

**Why first**: Everything depends on shared types and program IDLs.

### Phase 2 (Days 3-4): Core SDKs

```
5. ZK SDK (packages/zk-sdk) — wraps snarkjs, Poseidon, Merkle
6. DeFi SDK (packages/defi-sdk) — wraps Jupiter, Raydium, Marinade, Kamino
7. Privacy SDK (packages/privacy-sdk) — stealth addresses, shielded transfers
```

**Why second**: Agent core and frontend depend on these SDKs. DeFi SDK can be built independently of ZK SDK.

**Parallel opportunity**: ZK SDK and DeFi SDK can be built simultaneously.

### Phase 3 (Days 5-6): Agent Engine

```
8. Agent core (packages/agent-core) — strategy engine, decision logic
   - Uses solana-agent-kit for protocol interactions
   - Uses DeFi SDK for position management
   - Uses ZK SDK for privacy features
```

**Why third**: Depends on DeFi SDK and ZK SDK being at least partially functional.

### Phase 4 (Days 6-8): Interfaces

```
9. CLI (apps/cli) — Commander.js commands wrapping agent-core
10. Web dashboard (apps/web) — Next.js 15 with charts + wallet
```

**Why fourth**: Both consume agent-core and SDKs. Can be built in parallel.

**Parallel opportunity**: CLI and Web can be built simultaneously.

### Phase 5 (Days 8-9): Integration & Testing

```
11. E2E tests (agent -> program -> verify -> display)
12. Bankrun tests for on-chain programs
13. ZK proof generation + verification integration test
```

### Phase 6 (Days 9-10): Polish & Demo

```
14. Demo flow preparation
15. README + screenshots
16. Bug fixes + edge cases
17. Deployment to devnet
```

### Critical Path

```
Monorepo -> Shared Types -> Anchor Programs -> DeFi SDK -> Agent Core -> CLI/Web
                                            -> ZK SDK -> Privacy SDK ----^
```

The ZK/Privacy track can run in parallel with the DeFi track until they merge at the Agent Core level.

---

## P01 Reference Versions

For reference, these are the exact versions used in the production P01 project. We should match or exceed these:

### JavaScript/TypeScript (from P01 package.json)

| Package | P01 Version | Mahoraga Recommendation |
|---------|-------------|------------------------|
| `@coral-xyz/anchor` | ^0.32.1 (dev) | ^0.30.1 (match Rust) |
| `@solana/web3.js` | ^1.98.4 | ^1.98.4 (same) |
| `@solana/spl-token` | ^0.4.14 | ^0.4.14 (same) |
| `snarkjs` | ^0.7.4 | ^0.7.5 (latest) |
| `circomlib` | ^2.0.5 | ^2.0.5 (same) |
| `circomlibjs` | ^0.1.7 | ^0.1.7 (same) |
| `poseidon-lite` | ^0.2.0 | ^0.2.0 (same) |
| `typescript` | ^5.3.0 | ^5.3.0 (same) |
| `turbo` | ^2.0.0 | ^2.0.0 (same) |
| `pnpm` | 8.15.0 | 8.15.0 (same) |

### Rust (from P01 Cargo.toml)

| Crate | P01 Version | Mahoraga Recommendation |
|-------|-------------|------------------------|
| `anchor-lang` | 0.30.1 | 0.30.1 (same) |
| `anchor-spl` | 0.30.1 | 0.30.1 (same) |
| `solana-program` | 1.18.17 | 1.18.17 (same) |
| `ark-bn254` | 0.4.0 | 0.4.0 (same) |
| `ark-groth16` | 0.4.0 | 0.4.0 (same) |
| `groth16-solana` | (not in P01) | 0.2.0 (NEW — replaces custom verifier) |

### ZK SDK (from P01 packages/zk-sdk)

| Package | P01 Version | Notes |
|---------|-------------|-------|
| `@noble/hashes` | ^1.3.3 | For crypto hashing |
| `bn.js` | ^5.2.1 | Big number arithmetic |
| `bs58` | ^5.0.0 | Base58 encoding |
| `ffjavascript` | ^0.3.0 | Finite field ops |
| `tsup` | ^8.0.1 | SDK bundling |

---

## Version Lock Summary

For the `package.json` root dependencies, the recommended exact setup:

```json
{
  "devDependencies": {
    "@coral-xyz/anchor": "^0.30.1",
    "@solana/spl-token": "^0.4.14",
    "@solana/web3.js": "^1.98.4",
    "snarkjs": "^0.7.5",
    "circomlib": "^2.0.5",
    "circomlibjs": "^0.1.7",
    "poseidon-lite": "^0.2.0",
    "turbo": "^2.0.0",
    "typescript": "^5.3.0",
    "vitest": "^4.0.17"
  },
  "packageManager": "pnpm@8.15.0",
  "engines": {
    "node": ">=20"
  }
}
```

---

## Sources

- [Jupiter @jup-ag/api on npm](https://www.npmjs.com/package/@jup-ag/api)
- [Raydium SDK V2 on npm](https://www.npmjs.com/package/@raydium-io/raydium-sdk-v2)
- [Marinade TS SDK on npm](https://www.npmjs.com/package/@marinade.finance/marinade-ts-sdk)
- [Kamino klend-sdk on npm](https://www.npmjs.com/package/@kamino-finance/klend-sdk)
- [Kamino kliquidity-sdk on npm](https://www.npmjs.com/package/@kamino-finance/kliquidity-sdk)
- [@solana/web3.js on npm](https://www.npmjs.com/package/@solana/web3.js)
- [@solana/kit on npm](https://www.npmjs.com/package/@solana/kit)
- [Anchor Framework on GitHub](https://github.com/solana-foundation/anchor)
- [@coral-xyz/anchor on npm](https://www.npmjs.com/package/@coral-xyz/anchor)
- [anchor-bankrun on GitHub](https://github.com/kevinheavey/anchor-bankrun)
- [solana-bankrun on npm](https://www.npmjs.com/package/solana-bankrun)
- [groth16-solana on crates.io](https://crates.io/crates/groth16-solana)
- [Light Protocol ZK Compression](https://www.zkcompression.com/introduction/intro-to-development)
- [snarkjs on npm](https://www.npmjs.com/package/snarkjs)
- [Circom 2 Documentation](https://docs.circom.io/)
- [Solana Agent Kit on GitHub](https://github.com/sendaifun/solana-agent-kit)
- [Solana Agent Kit Docs](https://docs.sendai.fun/docs/v2/integrations/defi-integration/raydium_pools)
- [TradingView Lightweight Charts on npm](https://www.npmjs.com/package/lightweight-charts)
- [Next.js 15 Blog Post](https://nextjs.org/blog/next-15)
- [Next.js 16 Blog Post](https://nextjs.org/blog/next-16)
- [Vitest on npm](https://www.npmjs.com/package/vitest)
- [Commander.js on npm](https://www.npmjs.com/package/commander)
- [Helius RPC Provider Overview](https://chainstack.com/helius-rpc-provider-a-practical-overview/)
- [Solana RPC Providers Comparison 2026](https://chainstack.com/best-solana-rpc-providers-in-2026/)
- [Helius Pricing](https://www.helius.dev/pricing)
- [Zero-Knowledge Proofs on Solana (Helius Blog)](https://www.helius.dev/blog/zero-knowledge-proofs-its-applications-on-solana)
- [Intro to @solana/kit (Triton One)](https://blog.triton.one/intro-to-the-new-solana-kit-formerly-web3-js-2/)
- [Solana Web3.js 2.0 Release (Anza)](https://www.anza.xyz/blog/solana-web3-js-2-release)

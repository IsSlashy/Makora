# Features Research — Mahoraga DeFi Agent

> Research conducted 2026-02-02. Based on web research of current DeFi agent products,
> Solana privacy ecosystem, hackathon winners, and competitive landscape.

---

## Competitive Landscape

### Direct Competitors (AI DeFi Agents on Solana)

| Project | What It Does | Strengths | Weaknesses |
|---------|-------------|-----------|------------|
| **GLAM Protocol** | AI agent vault management with permissioned access. Two-agent architecture (manager + trader) rebalancing SOL/USDC within strict guardrails. | Security-first design. Fine-grained permissions (only JupiterSwapFundAssets). Institutional-grade approach. | Limited to simple rebalancing. No privacy. No multi-protocol strategies. |
| **ai16z** | Decentralized AI trading fund on Solana. Hit $2.6B market cap by Jan 2025. | Massive community. Proven market traction. Autonomous trading decisions. | Opaque strategy. Token-focused rather than utility-focused. No privacy features. |
| **Laura AI Agent** | Fully autonomous trading agent. 6 specialized sub-models. Trained on 250+ profitable wallet datasets. | 12 months of backtesting. Scam/honeypot detection. Social sentiment analysis. | Closed-source. Trading-only (no yield, no lending). No privacy. |
| **SOLTRADE AI** | AI trading agent with automated market analysis and real-time execution. | Integrated risk mitigation. On-chain automation. | Narrow focus on trading. No portfolio management. |
| **Solana Agent Kit** | Open-source toolkit connecting AI agents to 60+ Solana actions across 30+ protocols. Plugin architecture. | Broadest protocol coverage. Jupiter, Raydium, Kamino, Marinade integrations. Framework-agnostic. | Toolkit, not a product. No UI. No privacy. Users must build on top. |
| **Agenti (MCP Server)** | 380+ tools for DeFi across 20+ blockchains. Works with Claude, ChatGPT, Cursor. | Multi-chain. Massive tool coverage. Agent-to-agent payments. | Too broad — jack of all trades. Not Solana-optimized. |

### Adjacent Competitors (DeFi Dashboards on Solana)

| Project | What It Does | Relevant Features |
|---------|-------------|-------------------|
| **Step Finance** | "Front page of Solana." Portfolio aggregation across 95% of Solana protocols. | Net worth view, LP tracking, in-app Jupiter swaps, dust cleanup, NFT floors, staking. Free tier. |
| **Sonar Watch** | Multichain DeFi dashboard. Portfolio overview + analytics. | Performance charts, IL calculator, APY tracking, Jupiter swaps, Marinade staking. Developer API. |
| **DefiLlama** | Cross-chain DeFi analytics. | TVL tracking, yield rankings, protocol comparisons. Industry standard for data. |

### Privacy Competitors on Solana

| Project | What It Does | Status |
|---------|-------------|--------|
| **Umbra (on Arcium)** | Shielded finance layer. Encrypted transfers + swaps via MPC. First app on Arcium's mainnet alpha. | Live (private mainnet, 100 users/week, $500 cap). $155M ICO. |
| **encrypt.trade** | Privacy-focused DeFi — private transfers and swaps. Colosseum hackathon winner. | Live. Backed by Alliance. |
| **Privacy Cash** | Private SOL transfers via ZK proofs. Privacy pool model. | Early stage. SOL only, no SPL tokens yet. |
| **GhostWareOS / GhostSwap** | Privacy-first cross-chain DEX and bridge. Stealth payments. | Roadmap stage. Token surged 60% on announcement. |
| **Hush Wallet** | Privacy-first Solana wallet with one-time addresses and ZEC bridge. | Development. |
| **Solana Confidential Balances** | Native ZK-powered token extensions. Encrypts balances, transfers, mint/burn amounts. Auditor keys for compliance. | Live on Token-2022. JS libraries in development. |

### Key Insight: The Gap

**No existing project combines AI-powered DeFi management WITH privacy features.** Every AI agent is fully transparent on-chain. Every privacy project lacks autonomous intelligence. Mahoraga sits at this intersection — and that is a genuine differentiator, not a gimmick.

---

## Table Stakes (Must Have)

These are features users and judges will expect. Without them, the project looks incomplete.

### Core Agent Capabilities

| Feature | Description | Complexity | Priority |
|---------|-------------|-----------|----------|
| **Token swaps via Jupiter** | Swap any SPL token with best route aggregation. Jupiter Ultra for optimal slippage/fees. | Low | P0 |
| **Portfolio view** | Show all token balances, SOL balance, total value in USD. Real-time pricing. | Low | P0 |
| **Yield/staking positions** | Display staked SOL (Marinade mSOL), LP positions (Raydium, Kamino), with APY info. | Medium | P0 |
| **Natural language interface** | User talks to agent in English. Agent interprets intent and executes. "Swap 10 SOL to USDC" must work. | Medium | P0 |
| **Transaction history** | Show recent transactions with human-readable descriptions. | Low | P0 |
| **Wallet connection** | Connect via keypair or embedded wallet. Display address, balance. | Low | P0 |
| **Advisory mode** | Agent suggests actions but waits for user approval. Human-in-the-loop. | Low | P0 |
| **Risk warnings** | Warn about high slippage, low liquidity, rug risk before executing. | Medium | P0 |

### DeFi Protocol Integrations

| Protocol | Actions | Complexity | Priority |
|----------|---------|-----------|----------|
| **Jupiter** | Swap, limit orders, DCA | Low (well-documented SDK) | P0 |
| **Marinade** | Stake SOL, unstake, view mSOL yield | Low | P0 |
| **Raydium** | Provide liquidity, view LP positions, claim fees | Medium | P1 |
| **Kamino** | Deposit to vaults, view positions, auto-compound | Medium | P1 |

### UX Essentials

| Feature | Why It Matters | Complexity |
|---------|---------------|-----------|
| **Clean web UI** | Judges need to see and use it. CLI-only will not win. | Medium |
| **Action confirmation** | Show what will happen before executing. "Swap 10 SOL -> ~189.5 USDC. Proceed?" | Low |
| **Error handling** | Graceful failures. "Insufficient balance" not a stack trace. | Low |
| **Loading states** | Show progress during transactions. Solana is fast but not instant. | Low |

---

## Differentiators (Competitive Advantage)

These are features that will make judges take notice. Ranked by impact-to-complexity ratio.

### Tier 1: High Impact, Achievable (BUILD THESE)

| Feature | Description | Complexity | Impact | Why It Differentiates |
|---------|-------------|-----------|--------|----------------------|
| **Privacy-shielded transfers** | Send SOL/SPL tokens via stealth addresses. Recipient address hidden on-chain. Leverages P01 stealth address infrastructure. | Medium (we built this already) | VERY HIGH | No other DeFi agent has this. Period. Zero competition. |
| **ZK-verified balances** | Show user their private balance using ZK proofs. Prove solvency without revealing amounts. | Medium (Circom circuits from P01) | HIGH | Unique technical depth. Judges will recognize ZK competence. |
| **Dual mode: Advisory vs Auto** | Advisory mode suggests, user confirms. Auto mode executes within guardrails (max amounts, allowed tokens, daily limits). Like GLAM but with privacy. | Medium | HIGH | Shows maturity. GLAM proved this works. Adding privacy makes it ours. |
| **Adaptive strategy engine** | Agent monitors positions and market conditions. Suggests rebalancing, yield optimization, risk reduction. Adapts to user's risk profile. | High | HIGH | "Adaptive" is the project name (Mahoraga). This IS the product. |
| **Multi-protocol orchestration** | Single command triggers multi-step operations: "Move my SOL to the best yield" = unstake from Marinade -> swap portion -> deposit to Kamino vault. | Medium | HIGH | Most agents do single actions. Multi-step orchestration is rare. |

### Tier 2: Medium Impact, Worth Building If Time Allows

| Feature | Description | Complexity | Impact |
|---------|-------------|-----------|--------|
| **Smart money tracking** | Monitor whale wallets. "What are the top 10 SOL wallets doing today?" | Medium | Medium |
| **Yield comparison** | Compare yields across Marinade, Kamino, Raydium for same asset. Show best option. | Low | Medium |
| **Position health monitoring** | Alert when LP positions have high IL, or when yield drops below threshold. | Medium | Medium |
| **Private DeFi receipts** | After a shielded transfer, generate a ZK proof receipt that proves the transfer happened without revealing details. Shareable. | Medium | Medium |
| **Strategy backtesting** | "If I had followed this rebalancing strategy for 30 days, what would my returns be?" | High | Medium |

### Tier 3: Cool But Low Priority

| Feature | Description | Complexity | Impact |
|---------|-------------|-----------|--------|
| **Agent personality** | Mahoraga has a distinct voice. References to the Eight-Handled Sword Divergent Sila (Jujutsu Kaisen). | Low | Low-Medium |
| **Social sharing** | "Share my portfolio performance" with ZK privacy (prove gains without showing holdings). | High | Low |
| **Multi-wallet** | Manage multiple wallets from one agent session. | Medium | Low |

---

## Anti-Features (Don't Build)

Things that seem attractive but will hurt the project if built.

### 1. Token Launch / Tokenomics
**Why it seems good:** Every AI agent project has a token. Community, governance, incentives.
**Why it hurts:** The hackathon judges are Solana Foundation + Colosseum. They have seen 10,000 token launches. A token adds zero technical merit and screams "meme project." GLAM won hackathon recognition without a token. Unruggable (Cypherpunk grand prize) was about hardware wallets, not tokens. Focus on utility.

### 2. Fully Autonomous Trading Bot
**Why it seems good:** "Set it and forget it" trading. Impressive demo.
**Why it hurts:** AI agents are terrible at trading crypto (DL News, 2025). Over-reliance on historical data fails in volatile markets. Agents go "off the rails" — trading wrong assets, misinterpreting inputs (Allora Labs CEO). Regulatory risk. More importantly: if the demo loses money live, you lose the hackathon. Advisory mode is safer and more impressive.

### 3. Multi-Chain Support
**Why it seems good:** Broader market. "Works everywhere."
**Why it hurts:** This is a SOLANA hackathon. Judges want to see deep Solana integration, not shallow multi-chain wrappers. Step Finance is Solana-only and thrives. Go deep, not wide. Every hour spent on EVM bridges is an hour not spent on ZK privacy — our actual differentiator.

### 4. NFT Trading Features
**Why it seems good:** NFTs are popular. Another "feature."
**Why it hurts:** NFT trading is a solved problem (Tensor, Magic Eden). Adding it dilutes the DeFi + Privacy narrative. Judges want focus, not feature sprawl.

### 5. Social Media Integration (Twitter Bot)
**Why it seems good:** "Post my trades." Community engagement.
**Why it hurts:** Privacy-focused product that posts on Twitter is contradictory. Also, social features are a distraction from core DeFi functionality. Every AI agent has a Twitter bot. It is not differentiating.

### 6. Overcomplicated UI / Dashboard
**Why it seems good:** Beautiful charts, lots of data, looks professional.
**Why it hurts:** We have 10 days. A mediocre dashboard is worse than a clean, minimal interface that works perfectly. Step Finance and Sonar Watch took months/years to build their dashboards. A half-baked clone will be compared unfavorably. Better to have a clean chat interface + simple portfolio view than a broken Bloomberg terminal.

### 7. MEV / Sandwich Attack Protection
**Why it seems good:** Important real-world DeFi problem.
**Why it hurts:** Extremely complex. Jupiter already handles this with their routing. Duplicating it adds complexity without differentiating. Use Jupiter's existing protections.

---

## Privacy in DeFi — State of the Art

### What Exists Today (February 2026)

**Native Solana Infrastructure:**
- **Confidential Balances (Token-2022):** ZK-powered extensions that encrypt balances, transfer amounts, mint/burn amounts. Uses Twisted ElGamal Encryption + Sigma Protocol ZK proofs. Has auditor keys for compliance. Native on-chain ZK program (`ZkE1Gama1Proof11111111111111111111111111111`). JS libraries in development.
- **Performance benchmarks:** 0.8s proof generation, 20-level Merkle trees (1M+ commitments), $0.00001 transaction costs.

**Third-Party Privacy Layers:**
- **Arcium + Umbra:** MPC-based encrypted computation. Shielded transfers + encrypted swaps. Dual-mode privacy (confidential + selectively auditable). Early access only (100 users/week).
- **encrypt.trade:** Private transfers and swaps. Hackathon winner, Alliance-backed.
- **GhostSwap:** Cross-chain privacy DEX. Roadmap stage.

**What Is Missing:**
1. **No AI agent uses privacy.** Every DeFi agent operates with fully transparent transactions. Your strategy, your positions, your rebalancing — all visible to competitors, front-runners, and onlookers.
2. **No privacy-aware portfolio management.** Existing dashboards show everything publicly. No option to shield your holdings while still getting intelligent DeFi advice.
3. **No stealth address DeFi.** Stealth addresses exist (Hush, P01) but nobody has connected them to DeFi protocol interactions.
4. **No ZK-verified advisory.** No agent can prove "I am giving you good advice" without revealing its full reasoning or your full portfolio.

### Our Opportunity

Mahoraga can be the first DeFi agent that:
- Executes transfers through **stealth addresses** (P01 tech, already built)
- Shows portfolio to the agent privately via **ZK proofs** (P01 Circom circuits)
- Integrates with **Solana Confidential Balances** for native token privacy
- Offers **"privacy mode"** that shields DeFi operations from public observation
- Provides **ZK proof receipts** for private transactions

This is not theoretical — we built the core ZK and stealth address infrastructure in P01. The innovation is connecting it to DeFi agent operations.

### Privacy Narrative Alignment

The timing is exceptional:
- Solana launched **Privacy Hack 2026** hackathon (January 2026) focused on ZK, private payments, privacy tooling
- **Arcium mainnet alpha** just launched (January 2026)
- **Confidential Balances** are live on Token-2022
- Solana Foundation explicitly recognizes 12 privacy projects
- The ecosystem is hungry for privacy solutions

Building a privacy-enabled DeFi agent aligns perfectly with where the Solana ecosystem is headed.

---

## Hackathon Winners Analysis

### What Grand Prize Winners Did Right

| Hackathon | Winner | Prize | What They Did | Why They Won |
|-----------|--------|-------|--------------|-------------|
| **Renaissance** (2024) | Ore | $50K | Novel proof-of-work mining on Solana | Technically innovative. New primitive. Functional demo. |
| **Radar** (2024) | Reflect | $50K | Decentralized currency exchange via hedge-backed stablecoins | Novel financial mechanism. Real DeFi innovation. Clean execution. |
| **Cypherpunk** (2025) | Unruggable | Grand Prize | Hardware wallet + app designed for Solana | Solved real security problem. Physical + digital product. Bold vision. |
| **Breakout** (2025) | TAPEDRIVE | Grand Prize | On-chain data storage solving Solana's data cost problem | Addressed core ecosystem problem. Infrastructure-level impact. |

### Patterns in Winners

1. **Novel primitives, not wrappers.** Winners create something new — a new mining algorithm (Ore), a new stablecoin mechanism (Reflect), a new storage model (TAPEDRIVE). They do not just wrap existing protocols with a UI.

2. **Solana-native innovation.** Winners leverage what makes Solana unique — speed, low cost, Token-2022, validator network. They build things that could ONLY work on Solana (or work significantly better on Solana).

3. **Functional demo.** Every winner had a working prototype. Not mockups. Not "coming soon." Judges test the product.

4. **Clear problem statement.** Each winner solved a problem you could explain in one sentence: "Mining is centralized" (Ore). "Stablecoins are not truly decentralized" (Reflect). "Storing data on-chain is too expensive" (TAPEDRIVE).

5. **Startup potential.** Colosseum explicitly states they look for teams that will continue building. Winners showed viable business models, not hackathon-and-abandon projects.

### What Judges Actually Evaluate

From Colosseum's official criteria:
- **Functionality** — Does it work? Is the code clean?
- **Potential Impact** — Market size? Ecosystem impact?
- **Novelty** — Is this new? Or a copy?
- **Design/UX** — Does it use Solana's performance for seamless UX?
- **Composability/Open-Source** — Can others build on it?
- **Business Plan** — Could this be a real startup?

### Critical Submission Elements

1. **Pitch video (under 3 minutes):** Most important element. First thing judges watch. Must include: team background, product description, market potential, traction, demo.
2. **Technical demo (2-3 minutes):** Separate from pitch. Walk through core features, explain tech stack, show Solana integration depth.
3. **Working prototype:** Not slides. Not Figma. Working code that judges can try.
4. **Post-hackathon plan:** Judges ask "will you keep building?" Show roadmap.

### Applying This to Mahoraga

**Our one-sentence pitch:** "Mahoraga is the first DeFi agent that protects your privacy — shielded transfers, private portfolio management, and ZK-verified operations, all powered by AI on Solana."

**Novel primitive:** Privacy-enabled AI agent. Nobody has this.
**Solana-native:** Uses Confidential Balances (Token-2022), Anchor programs, Jupiter/Raydium/Kamino/Marinade.
**Why Solana:** Only chain fast enough ($0.00001 per ZK verification) and cheap enough for real-time AI agent + ZK operations.
**Startup potential:** Privacy in DeFi is a growing market. Institutional demand. Regulatory tailwinds.

---

## Feature Dependencies

```
LAYER 0: Infrastructure (build first)
  |
  +-- Wallet management (keypair, connection, balances)
  +-- Solana RPC connection
  +-- Agent runtime (Claude integration, natural language parsing)
  |
  v
LAYER 1: Core DeFi (build second)
  |
  +-- Jupiter swaps (depends on: wallet, RPC)
  +-- Marinade staking (depends on: wallet, RPC)
  +-- Portfolio view (depends on: wallet, RPC, price feeds)
  +-- Transaction history (depends on: wallet, RPC)
  |
  v
LAYER 2: Advanced DeFi (build third)
  |
  +-- Raydium LP (depends on: Layer 1 + LP math)
  +-- Kamino vaults (depends on: Layer 1)
  +-- Multi-protocol orchestration (depends on: all Layer 1 + Layer 2 protocols)
  +-- Advisory engine (depends on: portfolio view + price feeds + yield data)
  |
  v
LAYER 3: Privacy (build in parallel with Layer 2)
  |
  +-- Stealth addresses (depends on: wallet, P01 ZK circuits)
  +-- Shielded transfers (depends on: stealth addresses, Anchor programs)
  +-- ZK proof generation (depends on: Circom circuits from P01)
  +-- Privacy mode toggle (depends on: shielded transfers + UI)
  |
  v
LAYER 4: Intelligence (build last)
  |
  +-- Adaptive strategy suggestions (depends on: all Layers 1-3 + historical data)
  +-- Risk profiling (depends on: portfolio analysis + user history)
  +-- Auto mode with guardrails (depends on: advisory engine + permissions system)
  +-- Position health monitoring (depends on: Layer 2 positions + price feeds)
```

### Critical Path

```
Day 1-2:  Layer 0 (infrastructure) + Layer 1 start (Jupiter swaps)
Day 3-4:  Layer 1 complete + Layer 2 start (Raydium, Kamino)
Day 5-6:  Layer 3 (privacy features — stealth addresses, shielded transfers)
Day 7-8:  Layer 2 complete + Layer 4 start (advisory engine, strategy)
Day 9:    Integration testing + UI polish
Day 10:   Pitch video + technical demo + submission
```

### Parallelization Opportunities

- **Layer 3 (privacy)** can be developed in parallel with Layer 2, since it depends on Layer 0/1 but not Layer 2.
- **UI development** can happen in parallel with backend protocol integrations.
- **P01 code adaptation** (stealth addresses, ZK circuits) can start on Day 1 since it is porting existing code.

---

## Summary: What to Build

### Must Build (P0)
1. Natural language DeFi agent (chat interface)
2. Jupiter swaps
3. Marinade staking
4. Portfolio view with real-time pricing
5. Advisory mode with confirmations
6. Clean web UI

### Should Build (P1) — The Differentiators
7. Stealth address transfers (from P01)
8. ZK-shielded portfolio verification
9. Dual mode (advisory + auto with guardrails)
10. Multi-protocol orchestration (single-command multi-step)
11. Raydium LP management
12. Kamino vault deposits

### Nice to Have (P2)
13. Yield comparison across protocols
14. Position health monitoring
15. Strategy suggestions based on risk profile
16. ZK proof receipts for private transfers

### Do Not Build
- Token / tokenomics
- Fully autonomous trading
- Multi-chain support
- NFT features
- Twitter bot
- Complex dashboard (keep it clean)
- MEV protection (use Jupiter's)

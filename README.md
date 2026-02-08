# Makora

**Autonomous Privacy-First DeFi Agent for Solana**

[![Anonmesh](https://img.shields.io/badge/by-Anonmesh-0d1117?style=flat-square&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHBhdGggZD0iTTEyIDJMMiAyMmgyMEwxMiAyeiIgZmlsbD0iIzE0RjE5NSIvPjwvc3ZnPg==)](https://www.anonme.sh)
[![Solana](https://img.shields.io/badge/Solana-Native-14F195?style=flat-square)](https://solana.com)
[![ZK Privacy](https://img.shields.io/badge/ZK-Groth16-orange?style=flat-square)](https://en.wikipedia.org/wiki/Zero-knowledge_proof)
[![Arcium MPC](https://img.shields.io/badge/Arcium-MPC-8b5cf6?style=flat-square)](https://arcium.com)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)

> Built by **Anonmesh** -- an AI agent collective building privacy infrastructure for Solana. All code in this repository was written autonomously by AI for the [Solana Agent Hackathon](https://colosseum.com/agent-hackathon).

---

## The Problem

DeFi on Solana is fast, cheap, and open -- but **completely transparent**. Every swap, every position, every wallet balance is public. MEV bots front-run your trades. On-chain analytics firms track your portfolio. There's no privacy layer that actually works.

**Makora fixes this.**

---

## What Is Makora

Makora is an **autonomous DeFi agent** that combines LLM intelligence, zero-knowledge proofs, and Arcium's MPC network to give you private, intelligent trading on Solana.

```
You: "shield 5 SOL and long SOL 10x"

Makora:
  1. OBSERVE  - Reads portfolio, prices, vault state, open positions
  2. ORIENT   - LLM analyzes 7 market signals + prediction markets
               -> "Bullish momentum, 72% confidence. Shield first, then enter."
  3. DECIDE   - Risk manager validates (5 checks, VETO power)
  4. ACT      - Shields 5 SOL into ZK vault -> opens leveraged position

  Result: Vault +5 SOL | SOL-PERP LONG 10x opened @ $148.32
```

---

## Core Features

| Feature | Description |
|---------|-------------|
| **ZK Shielded Vaults** | Shield SOL into privacy-preserving vaults using Groth16 proofs |
| **Arcium MPC Swaps** | MEV-protected token swaps through multi-party computation |
| **LLM Intelligence** | Anthropic/OpenAI/Qwen-powered OODA decision loop |
| **7-Signal Sentiment** | Fear & Greed, RSI, momentum, Polymarket, TVL, DEX volume, news |
| **Leveraged Perps** | SOL/ETH/BTC perpetuals with auto TP/SL |
| **Jupiter Aggregation** | Best-price routing across all Solana DEXs |
| **Telegram Native** | Full trading interface inside Telegram |
| **TWA Dashboard** | Embedded mini-app with portfolio, charts, and agent status |
| **BYOK** | Bring Your Own Key -- your LLM API key, zero lock-in |
| **Natural Language** | "swap 2 SOL to USDC", "long BTC 5x", "check my vault" |

---

## Architecture

```
                    Telegram
                       |
                   OpenClaw Gateway
                       |
                   LLM (gpt-4o)
                       |
              +--------+--------+
              |                 |
         SKILL.md          IDENTITY.md
              |                 |
         makora-cli.mjs --------+
              |
    +---------+---------+---------+---------+
    |         |         |         |         |
  prices   sentiment   trade    vault     swap
  scan     news        perps    shield    Jupiter
  portfolio positions  close    unshield  quotes
```

### The OODA Loop

Makora's decision engine runs a continuous **Observe-Orient-Decide-Act** loop:

```
     +-----------+
     |  OBSERVE  |  Fetch portfolio, prices, positions, vault state
     +-----------+
     |  ORIENT   |  LLM analysis + 7 signals + Polymarket + news
     +-----------+
     |  DECIDE   |  Risk validation (5 checks, absolute VETO)
     +-----------+
     |    ACT    |  Execute trades + shield/unshield + auto TP/SL
     +-----------+
         PERPS: 3s cycle | INVEST: 5min cycle
```

### Signal Analysis

| Signal | Weight | Source |
|--------|--------|--------|
| Fear & Greed Index | 20% | alternative.me (contrarian) |
| RSI | 20% | Calculated from SOL price |
| Price Momentum | 20% | 30-min SOL trend |
| Polymarket | 10% | Crypto prediction markets |
| Solana TVL | 10% | DeFiLlama |
| DEX Volume | 10% | Solana DEX aggregate |
| News Sentiment | 10% | CryptoPanic + CoinGecko headlines |

Composite score from **-100** (extreme bearish) to **+100** (extreme bullish).

---

## Privacy Stack

### ZK Shielded Vaults

Deposit SOL into a shielded vault using zero-knowledge proofs. Funds are invisible on-chain until you unshield them.

```
Shield:   commitment = Poseidon(secret, amount)
          Merkle tree insert -> on-chain vault deposit
Unshield: Generate Groth16 proof of commitment knowledge
          Verify on-chain -> withdraw without linkage
```

### Arcium Confidential Swaps

Token swaps routed through Arcium's MPC network. Your trade intent is split across multiple computation nodes -- no single party (including Makora) can see the full trade before execution.

- **MEV protection** -- front-runners can't see your swap
- **Price discovery** -- Jupiter quotes, Arcium execution
- **Supported pairs** -- SOL, USDC, mSOL, BONK, JitoSOL, RAY, WBTC, WETH

### Stealth Trading Sessions

Autonomous trades rotate through ephemeral wallets, breaking the on-chain link between your main wallet and trading activity.

---

## Telegram Interface

Makora lives natively in Telegram. No app downloads, no browser extensions.

```
/start      - Welcome + setup
/scan       - Full market scan with recommendations
/status     - Portfolio overview
/sentiment  - 7-signal market sentiment
/news       - Crypto headlines with scoring
/positions  - Open perp positions & P&L
/strategy   - AI strategy evaluation
/auto       - OODA autonomous trading loop
/swap       - Token swap via Jupiter
/app        - Open the TWA dashboard

Natural language works too:
  "shield 1 SOL"
  "long SOL 5x"
  "swap 2 SOL to USDC"
  "how's the market?"
  "check my vault"
```

### TWA Dashboard

Tap the **Dashboard** button in Telegram to open the embedded mini-app:

- Wallet connection via Privy (email login, auto-creates Solana wallet)
- Portfolio balance and positions P&L
- Agent status (OODA phase visualization)
- Real-time market data
- Tap-to-copy wallet address

---

## Trading

### Perpetual Futures

| Market | Leverage | Auto TP | Auto SL |
|--------|----------|---------|---------|
| SOL-PERP | 1-50x | +2% | -5% |
| ETH-PERP | 1-50x | +2% | -5% |
| BTC-PERP | 1-50x | +2% | -5% |

- Default: 5x leverage, $100 collateral
- Auto TP/SL is **deterministic** -- fires even if LLM is down
- Uses real Jupiter prices for mark

### Token Swaps

Jupiter aggregator routes across Raydium, Orca, Lifinity, Meteora, Phoenix for best execution.

```
"swap 10 SOL to USDC"  ->  Jupiter quote + execution
"buy 100 BONK"         ->  Automatic routing
```

### Risk Management

The risk manager has **absolute VETO power** over every action:

| Control | Default |
|---------|---------|
| Max position size | 25% of portfolio |
| Max slippage | 1% (100 bps) |
| Max daily loss | 5% (circuit breaker) |
| Min SOL reserve | 0.05 SOL |
| Max protocol exposure | 50% per protocol |

---

## Quick Start

```bash
# Clone
git clone https://github.com/anonmesh/makora.git
cd makora

# Install
pnpm install

# Build
pnpm build

# Start dashboard
cd apps/dashboard && pnpm dev
# Open http://localhost:3000
```

### Environment Variables

```bash
SOLANA_NETWORK=devnet
SOLANA_RPC_URL=https://api.devnet.solana.com
WALLET_PATH=~/.config/solana/id.json
TELEGRAM_BOT_TOKEN=your_telegram_token
JUPITER_API_KEY=your_jupiter_key          # Optional
CRYPTOPANIC_API_KEY=your_cryptopanic_key  # Optional

# LLM (BYOK)
LLM_PROVIDER=anthropic    # anthropic | openai | qwen
LLM_API_KEY=your_key
LLM_MODEL=claude-sonnet-4-20250514
```

---

## Monorepo Structure

```
makora/
+-- packages/
|   +-- types/              # Shared TypeScript types
|   +-- data-feed/          # Jupiter prices, Polymarket, portfolio reader
|   +-- llm-provider/       # LLM abstraction (Anthropic/OpenAI/Qwen)
|   +-- protocol-router/    # Multi-protocol routing
|   +-- execution-engine/   # TX build -> simulate -> risk check -> send
|   +-- risk-manager/       # VETO power + circuit breaker
|   +-- strategy-engine/    # Market analyzer + yield optimizer
|   +-- agent-core/         # OODA loop + NL parser + decision log
|   +-- session-manager/    # Stealth trading sessions
|   +-- privacy/            # ZK proofs + stealth addresses
|   +-- adapters/
|       +-- jupiter/        # DEX aggregator
|       +-- marinade/       # Liquid staking
|       +-- raydium/        # AMM / CLMM
|       +-- kamino/         # Vault strategies
|       +-- privacy/        # Shield / unshield
+-- apps/
|   +-- dashboard/          # Next.js TWA + web dashboard
|   +-- telegram/           # Telegram bot interface
|   +-- cli/                # Terminal commands
|   +-- api/                # REST API (agent-to-agent)
|   +-- worker/             # Headless 24/7 OODA worker
+-- openclaw/               # OpenClaw gateway config + Makora skill
+-- programs/
|   +-- makora_vault/       # Anchor -- portfolio vaults
|   +-- makora_strategy/    # Anchor -- strategy + audit trail
|   +-- makora_privacy/     # Anchor -- stealth + shielded pool
+-- circuits/
|   +-- transfer.circom     # Shielded transfer proof
|   +-- merkle.circom       # Merkle inclusion proof
|   +-- poseidon.circom     # Poseidon hash (ZK-friendly)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Solana (devnet + mainnet-beta) |
| Smart Contracts | Anchor 0.30 / Rust |
| ZK Proofs | Circom / Groth16 / snarkjs |
| MPC Privacy | Arcium Network |
| LLM | Anthropic Claude / OpenAI / Qwen (BYOK) |
| DeFi Protocols | Jupiter, Marinade, Raydium, Kamino |
| Agent Framework | OpenClaw |
| Dashboard | Next.js 16 + React 19 + Tailwind CSS |
| Telegram | OpenClaw Telegram plugin |
| Auth | Privy (embedded Solana wallets) |
| Monorepo | pnpm workspaces + Turborepo + tsup |

---

## Solana Programs

| Program | ID | Purpose |
|---------|----|---------|
| `makora_vault` | `BTAd1ghiv4jKd4kREh14jCtHrVG6zDFNgLRNoF9pUgqw` | Portfolio vaults with deposit/withdraw |
| `makora_strategy` | `EH5sixTHAoLsdFox1bR3YUqgwf5VuX2BdXFew5wTE6dj` | Strategy config + on-chain audit trail |
| `makora_privacy` | `C1qXFsB6oJgZLQnXwRi9mwrm3QshKMU8kGGUZTAa9xcM` | Stealth registry + shielded pool + nullifiers |

---

## How It Was Built

Every line of code was written autonomously by AI agents running on OpenClaw.

**Development phases:**
1. Foundation -- monorepo, types, data feed, Jupiter adapter, vault program
2. Core DeFi -- protocol adapters, execution engine, risk manager
3. Agent Intelligence -- OODA loop, strategy engine, NL parser
4. Privacy Layer -- ZK circuits, stealth addresses, shielded transfers
5. Dashboard -- Next.js TWA with OODA wheel visualization
6. Telegram -- bot interface, OpenClaw skill, real-time notifications
7. LLM Intelligence -- BYOK provider layer, Polymarket, AI-powered ORIENT
8. PERPS Trading -- perpetuals, auto TP/SL, position charts
9. Arcium Integration -- MPC confidential swaps, MEV protection
10. Polish -- TWA bridge, agent status panel, wallet UX

---

## Team

**Anonmesh** -- Privacy infrastructure for Solana.

We build tools that make DeFi private by default. Makora is our first agent -- autonomous, intelligent, and invisible on-chain.

- Web: [anonme.sh](https://www.anonme.sh)
- Twitter: [@anon0mesh](https://x.com/anon0mesh)
- GitHub: [@anonmesh](https://github.com/anonmesh)
- Built for the [Solana Agent Hackathon](https://colosseum.com/agent-hackathon)

---

## License

MIT

---

*Makora -- DeFi that doesn't watch you back.*

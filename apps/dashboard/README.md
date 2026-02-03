# Makora Dashboard

The visual centerpiece of the Makora LLM-Powered DeFi Agent — a Next.js 15 web dashboard showcasing the OODA loop architecture with live LLM reasoning and Polymarket intelligence.

## Overview

This dashboard is the **primary interface for judges** in the Solana Agent Hackathon. It features:

- **TheWheel**: The signature OODA loop visualization showing Observe → Orient → Decide → Act phases
- **Portfolio Card**: Real-time portfolio value and asset allocation with animated progress bars
- **Strategy Panel**: Active strategy display with top yield opportunities
- **LLM Reasoning Panel**: Live display of LLM analysis — sentiment, allocation recommendations, risk assessment, reasoning chain
- **Polymarket Panel**: Real-time crypto prediction market data with sentiment indicators
- **Settings Panel**: BYOK configuration — provider selection (Anthropic/OpenAI/Qwen), API key, model, temperature
- **Activity Feed**: Live activity log of agent actions
- **Risk Controls**: Interactive sliders for position limits, slippage, and circuit breakers
- **Solana Wallet Integration**: Connect Phantom, Solflare, or Backpack wallets

## Tech Stack

- **Next.js 15** (App Router)
- **React 19**
- **TypeScript 5.3**
- **Tailwind CSS 3.4**
- **Solana Wallet Adapter** (React components)
- **@solana/web3.js**

## Design Theme

- Dark background: `#0a0a0f`
- Deep purples: `#1a0a2e`, `#2d1b4e`
- Electric violet: `#8b5cf6`, `#a78bfa`
- Glass morphism cards with subtle glows
- Smooth animations and transitions

## Project Structure

```
apps/dashboard/
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with Solana providers
│   │   ├── page.tsx                # Main dashboard page
│   │   ├── providers.tsx           # Wallet adapter configuration
│   │   ├── globals.css             # Tailwind imports + custom styles
│   │   └── api/
│   │       ├── llm/
│   │       │   ├── analyze/route.ts  # LLM analysis proxy
│   │       │   ├── ping/route.ts     # API key validation
│   │       │   └── stream/route.ts   # SSE streaming analysis
│   │       └── polymarket/route.ts   # Polymarket Gamma API proxy
│   ├── hooks/
│   │   ├── useOODALoop.ts          # OODA loop state machine (LLM-powered ORIENT)
│   │   ├── useLLMConfig.ts         # BYOK config (localStorage)
│   │   └── usePolymarket.ts        # Polymarket intelligence feed
│   └── components/
│       ├── Header.tsx              # Logo, LLM badge, sentiment dot, wallet button
│       ├── TheWheel.tsx            # OODA loop visualization
│       ├── PortfolioCard.tsx       # Portfolio value & allocation
│       ├── StrategyPanel.tsx       # Active strategy & opportunities
│       ├── LLMReasoningPanel.tsx   # Live LLM reasoning display
│       ├── PolymarketPanel.tsx     # Prediction market dashboard
│       ├── SettingsPanel.tsx       # BYOK settings drawer
│       ├── ActivityFeed.tsx        # Live activity log
│       ├── RiskControls.tsx        # Risk parameter controls
│       └── WalletButton.tsx        # Wallet connection button
├── next.config.js
├── tailwind.config.js
├── postcss.config.js
├── tsconfig.json
└── package.json
```

## Installation

From the monorepo root:

```bash
# Install all dependencies
pnpm install

# Or install just the dashboard
pnpm install --filter "@makora/dashboard"
```

## Development

```bash
# From the dashboard directory
cd apps/dashboard
pnpm dev

# Or from monorepo root
pnpm --filter "@makora/dashboard" dev
```

The dashboard will be available at `http://localhost:3000`

## Build

```bash
# From the dashboard directory
pnpm build

# Or from monorepo root
pnpm --filter "@makora/dashboard" build
```

## Features

### TheWheel (OODA Loop Visualization)

The signature component that shows the agent's decision-making cycle:

- **Rotating outer ring** with gradient glow
- **4 OODA phases** positioned around the wheel
- **Active phase highlighting** with color-coded badges
- **Center hub** displaying:
  - Makora logo with gradient text
  - Current strategy name
  - Adaptation count (total cycles completed)
  - Confidence score from LLM analysis
- **Smooth animations** cycling every 2 seconds

### LLM Reasoning Panel

Live display of the LLM's analysis during the ORIENT phase:

- **Provider badge** showing active model (e.g., Claude Sonnet 4, GPT-4o)
- **Sentiment indicator** — bullish/neutral/bearish with color coding
- **Reasoning text** — the LLM's chain of thought
- **Key factors** — tags showing what the LLM identified as important
- **Allocation table** — recommended positions with protocol, action, token, percentage, rationale
- **Risk warnings** — highlighted risk assessment items
- **Thinking animation** during active analysis

### Polymarket Panel

Real-time crypto prediction market intelligence:

- **Market list** — top crypto prediction markets from Polymarket
- **Per-market data**: question, YES probability bar, 24h volume, price change
- **Relevance badges** — high/medium/low relevance to crypto
- **Sentiment summary** — overall bias, high conviction count, average probability
- **Auto-refresh** every 5 minutes

### Settings Panel (BYOK)

Bring Your Own Key configuration drawer:

- **Provider selector** — Anthropic / OpenAI / Qwen radio buttons
- **API key input** — password field with show/hide toggle
- **Model dropdown** — per-provider model options
- **Temperature slider** — 0.0 to 1.0
- **Polymarket toggle** — enable/disable Polymarket intelligence
- **Test Connection** — validates API key via /api/llm/ping
- **Save/Clear** — persists to localStorage

### Portfolio Card

Shows portfolio value and asset allocation:

- **Total value** in USD with 24h change indicator
- **Token balances** with colored progress bars
- **Live updates** simulating price changes
- **Percentage allocation** for each token

### Strategy Panel

Displays the active strategy and opportunities (fallback when LLM not configured):

- **Active strategy badge** (e.g., "Yield Optimizer")
- **Target allocation** showing rebalancing progress
- **Top yield opportunities** table
- **Action buttons** (Approve All / Review)

### Activity Feed

Real-time log of agent actions:

- **Status-coded entries** with timestamps
- **Scrollable feed** with custom scrollbar styling
- **Live indicator** showing feed is active
- **Auto-updates** with new activities every 15 seconds

### Risk Controls

Interactive risk management interface:

- **Max Position Size** slider (0-100%)
- **Max Slippage** slider (0-5%)
- **Daily Loss Limit** slider (0-20%)
- **Circuit Breaker** toggle switch
- **Emergency Stop** button (red, prominent)

### Wallet Integration

Full Solana wallet support:

- **Multi-wallet support**: Phantom, Solflare, Backpack
- **Auto-connect** on page load
- **Connection status** indicator in header
- **Wallet address** display (truncated)
- **Devnet configuration** (for hackathon)

## Mock Data

All components use realistic mock data for demonstration:

- Portfolio value: ~$12,450 with simulated price movements
- Token allocations: SOL 45%, mSOL 25%, USDC 25%, Shielded 5%
- APY rates: 7.2% - 15.6% across different protocols
- Risk score: 2.3/10 (Low)
- 1,247+ adaptations completed
- 94% confidence score

## Styling

Custom CSS features:

- **Glass morphism** cards with blur and transparency
- **Gradient text** for branding
- **Glow effects** on active elements
- **Custom animations**:
  - `spin-slow`: 8s rotation for outer ring
  - `pulse-glow`: Pulsing opacity for glows
  - `fade-in`: Smooth entry animation
- **Custom scrollbar** styling for activity feed
- **Responsive grid** layout for mobile/tablet/desktop

## Color Palette

```css
--bg-primary: #0a0a0f    /* Deep black background */
--bg-secondary: #1a0a2e  /* Dark purple accent */
--bg-card: #12121a       /* Card background */
--accent: #8b5cf6        /* Electric violet */
--accent-light: #a78bfa  /* Light violet */
--text-primary: #e2e8f0  /* Light gray text */
--text-secondary: #94a3b8 /* Muted gray text */
--success: #10b981       /* Green for success */
--danger: #ef4444        /* Red for danger */
--warning: #f59e0b       /* Orange for warnings */
```

## Performance

- **Client-side rendering** for interactive components
- **useEffect hooks** for animations and live updates
- **Optimized re-renders** with proper state management
- **Lightweight dependencies** (no heavy UI libraries)
- **CSS-only animations** (no JavaScript animation libraries)

## Browser Compatibility

- Chrome/Edge (recommended)
- Firefox
- Safari
- Brave

All modern browsers with ES2020 support.

## API Routes

### `/api/llm/analyze` (POST)
Proxies LLM analysis requests to the user's chosen provider. Accepts portfolio context, market data, and Polymarket intelligence. Returns structured `LLMAnalysis` JSON with sentiment, allocation, risk, and reasoning.

### `/api/llm/ping` (POST)
Lightweight API key validation. Sends a minimal request to verify credentials work.

### `/api/llm/stream` (POST)
SSE streaming variant of the analyze endpoint for real-time LLM output display.

### `/api/polymarket` (GET)
Proxy for Polymarket Gamma API (CORS safety). Returns crypto prediction markets with computed sentiment.

## Notes

- Dashboard connects to real Solana wallets on devnet via wallet adapter
- LLM calls are proxied through Next.js API routes (API keys never sent to client-side code)
- Polymarket data is fetched server-side and cached
- BYOK config is stored in localStorage (API keys stay on user's machine)
- Falls back to hardcoded strategy engine when no LLM key is configured

## License

Part of the Makora project for Solana Agent Hackathon 2026.

# Makora Dashboard

The visual centerpiece of the Makora Adaptive DeFi Agent - a stunning Next.js 15 web dashboard showcasing the OODA loop architecture.

## Overview

This dashboard is the **primary interface for judges** in the Solana Agent Hackathon. It features:

- **TheWheel**: The signature OODA loop visualization showing Observe → Orient → Decide → Act phases
- **Portfolio Card**: Real-time portfolio value and asset allocation with animated progress bars
- **Strategy Panel**: Active strategy display with top yield opportunities
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
│   │   ├── layout.tsx          # Root layout with Solana providers
│   │   ├── page.tsx            # Main dashboard page
│   │   ├── providers.tsx       # Wallet adapter configuration
│   │   └── globals.css         # Tailwind imports + custom styles
│   └── components/
│       ├── Header.tsx          # Logo, mode badge, wallet button
│       ├── TheWheel.tsx        # OODA loop visualization ⭐
│       ├── PortfolioCard.tsx   # Portfolio value & allocation
│       ├── StrategyPanel.tsx   # Active strategy & opportunities
│       ├── ActivityFeed.tsx    # Live activity log
│       ├── RiskControls.tsx    # Risk parameter controls
│       └── WalletButton.tsx    # Wallet connection button
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
  - Confidence score (92-98%)
- **Smooth animations** cycling every 2 seconds

### Portfolio Card

Shows portfolio value and asset allocation:

- **Total value** in USD with 24h change indicator
- **Token balances** with colored progress bars:
  - SOL (green)
  - mSOL (blue)
  - USDC (gray)
  - Shielded assets (purple)
- **Live updates** simulating price changes
- **Percentage allocation** for each token

### Strategy Panel

Displays the active strategy and opportunities:

- **Active strategy badge** (e.g., "Yield Optimizer")
- **Target allocation** showing rebalancing progress
- **Top yield opportunities** table:
  - Protocol name
  - APY percentage
  - TVL (Total Value Locked)
  - Risk level (Low/Medium/High)
- **Action buttons** (Approve All / Review)

### Activity Feed

Real-time log of agent actions:

- **Status-coded entries** (success ✓, info ⟳, warning ⚠)
- **Timestamps** for each action
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
- **Risk metrics** display:
  - Current risk score
  - Today's P&L
  - Largest position

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

## Notes

- This is a **frontend-only** dashboard using mock data
- Wallet adapter is configured but functional (connects to real Solana wallets on devnet)
- All visualizations are **client-side rendered**
- No backend API calls (fully self-contained)
- Designed to impress judges with visual appeal and UX

## Future Enhancements

When connected to the actual Makora agent backend:

- Replace mock data with live Solana RPC calls
- Real portfolio tracking from connected wallet
- Actual strategy execution triggers
- Historical performance charts
- Transaction signature links to Solana Explorer
- WebSocket connection for real-time updates

## License

Part of the Makora project for Solana Agent Hackathon 2026.

# Makora Dashboard - Quick Start Guide

## Get Running in 3 Steps

### 1. Install Dependencies

From the monorepo root:

```bash
cd P:\solana-agent-hackathon
pnpm install
```

This installs all dependencies for the dashboard and other packages in the workspace.

### 2. Start the Development Server

```bash
cd apps/dashboard
pnpm dev
```

The dashboard will start at `http://localhost:3000`

### 3. Open in Browser

Navigate to `http://localhost:3000` and you should see:

- The MAKORA header with wallet connect button
- The spinning OODA wheel in the center
- Portfolio value card on the right
- Strategy panel below that
- Activity feed and risk controls at the bottom

## What You Should See

### The OODA Wheel (Center)

A circular visualization with 4 phases rotating every 2 seconds:
- **OBSERVE** (green)
- **ORIENT** (blue)
- **DECIDE** (orange)
- **ACT** (purple)

The active phase glows and scales up. The center shows "MAKORA" with adaptation count and confidence.

### Portfolio Card (Top Right)

- Total value: ~$12,450
- 4 colored progress bars for SOL, mSOL, USDC, and Shielded assets
- 24h change indicator (+2.4%)

### Strategy Panel (Middle Right)

- Active strategy badge: "Yield Optimizer"
- Target allocation showing rebalancing
- 4 yield opportunities with APY rates

### Activity Feed (Bottom Left)

- Live scrolling feed of agent actions
- Color-coded status indicators
- Timestamps for each action

### Risk Controls (Bottom Right)

- 3 interactive sliders (position size, slippage, loss limit)
- Circuit breaker toggle
- Red emergency stop button
- Risk metrics display

## Connecting a Wallet (Optional)

Click "Select Wallet" in the top right to connect:

1. Choose Phantom, Solflare, or Backpack
2. Approve the connection
3. Your wallet address will appear in the header

Note: The dashboard is configured for Solana **devnet** (for the hackathon).

## Troubleshooting

### Port 3000 Already in Use

```bash
pnpm dev -- --port 3001
```

### Dependencies Not Installing

Make sure you're using Node.js 18+ and pnpm 8+:

```bash
node --version  # Should be 18.x or higher
pnpm --version  # Should be 8.x or higher
```

### TypeScript Errors

The dashboard is fully typed. If you see errors, try:

```bash
cd apps/dashboard
rm -rf .next
pnpm dev
```

### Wallet Not Connecting

Make sure you have:
1. A Solana wallet extension installed (Phantom recommended)
2. Selected **devnet** in your wallet settings
3. Some devnet SOL (get from https://faucet.solana.com)

## Building for Production

```bash
cd apps/dashboard
pnpm build
pnpm start
```

This creates an optimized production build and starts the server on port 3000.

## File Structure

```
apps/dashboard/
├── src/
│   ├── app/
│   │   ├── layout.tsx       # Root layout + providers
│   │   ├── page.tsx         # Main dashboard (grid layout)
│   │   ├── providers.tsx    # Solana wallet config
│   │   └── globals.css      # Tailwind + custom styles
│   └── components/
│       ├── TheWheel.tsx     # ⭐ OODA loop visualization
│       ├── PortfolioCard.tsx
│       ├── StrategyPanel.tsx
│       ├── ActivityFeed.tsx
│       ├── RiskControls.tsx
│       ├── Header.tsx
│       └── WalletButton.tsx
├── public/                  # Static assets (empty for now)
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

## Key Technologies

- **Next.js 15**: React framework with App Router
- **React 19**: Latest React with concurrent features
- **TypeScript 5.3**: Full type safety
- **Tailwind CSS 3.4**: Utility-first styling
- **Solana Wallet Adapter**: Multi-wallet support

## Development Tips

### Hot Reload

Next.js has built-in hot reload. Just save any file and the browser auto-refreshes.

### Adding New Components

1. Create a new file in `src/components/`
2. Use the `'use client'` directive if using hooks
3. Import and use in `src/app/page.tsx`

### Modifying Colors

Edit the color palette in:
- `tailwind.config.js` (for Tailwind utilities)
- `src/app/globals.css` (for CSS variables)

### Changing Mock Data

Each component has mock data at the top. Just modify the arrays/values:

- `PortfolioCard.tsx`: `tokens` array
- `StrategyPanel.tsx`: `opportunities` array
- `ActivityFeed.tsx`: `activities` array
- `TheWheel.tsx`: `phases` array

## Performance

The dashboard is lightweight and performant:

- **868 lines** of TypeScript/TSX/CSS
- **Zero external animation libraries** (CSS-only)
- **No heavy UI libraries** (just Tailwind + Wallet Adapter)
- **Client-side rendering** for interactivity
- **Optimized animations** using CSS transforms

## Next Steps

To connect this dashboard to a real Makora agent backend:

1. Create an API route in `src/app/api/`
2. Replace mock data with `fetch()` calls
3. Use `useEffect` hooks to poll for updates
4. Or implement WebSocket for real-time data

## Questions?

See the main [README.md](./README.md) for detailed documentation.

---

**Built for the Solana Agent Hackathon 2026**

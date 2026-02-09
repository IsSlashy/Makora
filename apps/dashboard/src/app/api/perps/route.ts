import { NextRequest, NextResponse } from 'next/server';

/**
 * Simulated Perp Positions API — syncs positions between Telegram bot and dashboard.
 *
 * GET    /api/perps?userId=X       → list open positions
 * POST   /api/perps                → open or close a position
 *   { action: "open", position: {...} }
 *   { action: "close", market: "SOL-PERP" }
 *   { action: "update-prices", prices: { SOL: 84.5, ETH: 2040, BTC: 69600 } }
 *   { action: "check-sl-tp", prices: { SOL: 84.5, ETH: 2040, BTC: 69600 } }
 */

interface PerpPosition {
  id: string;
  market: string;
  side: 'long' | 'short';
  leverage: number;
  collateralUsd: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  openedAt: number;
  stopLoss?: number;
  takeProfit?: number;
}

interface ClosedBySlTp {
  position: PerpPosition;
  reason: 'stop_loss' | 'take_profit';
  exitPrice: number;
  pnlUsd: number;
  pnlPct: number;
}

const PERPS_KEY = '__makora_perps_sync';

function getStore(): Record<string, PerpPosition[]> {
  if (!(globalThis as any)[PERPS_KEY]) {
    (globalThis as any)[PERPS_KEY] = {};
  }
  return (globalThis as any)[PERPS_KEY];
}

function computePnl(pos: PerpPosition, currentPrice: number): PerpPosition {
  const priceDiff = currentPrice - pos.entryPrice;
  const direction = pos.side === 'long' ? 1 : -1;
  const pnlPct = (priceDiff / pos.entryPrice) * pos.leverage * direction * 100;
  const pnlUsd = (pnlPct / 100) * pos.collateralUsd;
  return {
    ...pos,
    currentPrice,
    unrealizedPnl: Math.round(pnlUsd * 100) / 100,
    unrealizedPnlPct: Math.round(pnlPct * 100) / 100,
  };
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId') || 'default';
  const store = getStore();
  const positions = store[userId] || [];

  const totalCollateral = positions.reduce((s, p) => s + p.collateralUsd, 0);
  const totalExposure = positions.reduce((s, p) => s + p.collateralUsd * p.leverage, 0);
  const totalPnl = positions.reduce((s, p) => s + p.unrealizedPnl, 0);

  return NextResponse.json({
    positions,
    count: positions.length,
    summary: {
      totalCollateral: Math.round(totalCollateral * 100) / 100,
      totalExposure: Math.round(totalExposure * 100) / 100,
      totalUnrealizedPnl: Math.round(totalPnl * 100) / 100,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId = 'default', action } = body;

    const store = getStore();
    if (!store[userId]) store[userId] = [];

    if (action === 'open') {
      const pos: PerpPosition = {
        id: body.position?.id || `pos-${Date.now()}`,
        market: body.position?.market || 'SOL-PERP',
        side: body.position?.side || 'long',
        leverage: body.position?.leverage || 5,
        collateralUsd: body.position?.collateralUsd || 100,
        entryPrice: body.position?.entryPrice || 0,
        currentPrice: body.position?.entryPrice || 0,
        unrealizedPnl: 0,
        unrealizedPnlPct: 0,
        openedAt: body.position?.openedAt || Date.now(),
        stopLoss: body.position?.stopLoss ?? undefined,
        takeProfit: body.position?.takeProfit ?? undefined,
      };
      store[userId].push(pos);
      return NextResponse.json({ success: true, position: pos, count: store[userId].length });
    }

    if (action === 'close') {
      const market = body.market || 'SOL-PERP';
      const idx = store[userId].findIndex(p => p.market === market);
      if (idx === -1) {
        return NextResponse.json({ error: `No open position for ${market}` }, { status: 404 });
      }
      const closed = store[userId].splice(idx, 1)[0];
      // Update P&L with exit price if provided
      if (body.exitPrice) {
        const updated = computePnl(closed, body.exitPrice);
        return NextResponse.json({ success: true, closed: updated, remaining: store[userId].length });
      }
      return NextResponse.json({ success: true, closed, remaining: store[userId].length });
    }

    if (action === 'update-prices') {
      const prices = body.prices || {};
      for (const pos of store[userId]) {
        const token = pos.market.replace('-PERP', '');
        if (prices[token]) {
          const updated = computePnl(pos, prices[token]);
          Object.assign(pos, updated);
        }
      }
      return NextResponse.json({ success: true, positions: store[userId] });
    }

    if (action === 'check-sl-tp') {
      const prices: Record<string, number> = body.prices || {};
      const closedPositions: ClosedBySlTp[] = [];
      const remaining: PerpPosition[] = [];

      for (const pos of store[userId]) {
        const token = pos.market.replace('-PERP', '');
        const currentPrice = prices[token];

        if (!currentPrice) {
          remaining.push(pos);
          continue;
        }

        let closeReason: 'stop_loss' | 'take_profit' | null = null;

        // Check stop loss
        if (pos.stopLoss != null) {
          if (pos.side === 'long' && currentPrice <= pos.stopLoss) {
            closeReason = 'stop_loss';
          } else if (pos.side === 'short' && currentPrice >= pos.stopLoss) {
            closeReason = 'stop_loss';
          }
        }

        // Check take profit (only if not already stopped out)
        if (!closeReason && pos.takeProfit != null) {
          if (pos.side === 'long' && currentPrice >= pos.takeProfit) {
            closeReason = 'take_profit';
          } else if (pos.side === 'short' && currentPrice <= pos.takeProfit) {
            closeReason = 'take_profit';
          }
        }

        if (closeReason) {
          const updated = computePnl(pos, currentPrice);
          closedPositions.push({
            position: updated,
            reason: closeReason,
            exitPrice: currentPrice,
            pnlUsd: updated.unrealizedPnl,
            pnlPct: updated.unrealizedPnlPct,
          });
        } else {
          // Update price but keep position open
          const updated = computePnl(pos, currentPrice);
          Object.assign(pos, updated);
          remaining.push(pos);
        }
      }

      // Replace the user's positions with only the remaining open ones
      store[userId] = remaining;

      return NextResponse.json({
        success: true,
        closed: closedPositions,
        closedCount: closedPositions.length,
        remaining: remaining.length,
        positions: remaining,
      });
    }

    return NextResponse.json({ error: 'Invalid action. Use open, close, update-prices, or check-sl-tp.' }, { status: 400 });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

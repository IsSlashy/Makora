import { NextRequest, NextResponse } from 'next/server';

/**
 * Simulated ZK Vault API — syncs vault state between Telegram bot and dashboard.
 *
 * GET  /api/vault?userId=X  → returns vault state for user
 * POST /api/vault           → updates vault state (called by bot CLI after shield/unshield)
 *
 * Storage: globalThis (persists across warm Lambda invocations — good enough for demo)
 */

interface VaultEntry {
  balanceSol: number;
  totalShielded: number;
  totalUnshielded: number;
  history: Array<{ type: 'shield' | 'unshield'; amount: number; timestamp: number }>;
  updatedAt: number;
}

const VAULT_KEY = '__makora_vault_sync';

function getStore(): Record<string, VaultEntry> {
  if (!(globalThis as any)[VAULT_KEY]) {
    (globalThis as any)[VAULT_KEY] = {};
  }
  return (globalThis as any)[VAULT_KEY];
}

export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId') || 'default';
  const store = getStore();
  const vault = store[userId] || {
    balanceSol: 0,
    totalShielded: 0,
    totalUnshielded: 0,
    history: [],
    updatedAt: 0,
  };

  return NextResponse.json(vault);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId = 'default', action, amount } = body;

    if (!action || !amount || amount <= 0) {
      return NextResponse.json({ error: 'Missing action or amount' }, { status: 400 });
    }

    const store = getStore();
    if (!store[userId]) {
      store[userId] = { balanceSol: 0, totalShielded: 0, totalUnshielded: 0, history: [], updatedAt: 0 };
    }

    const vault = store[userId];

    if (action === 'shield') {
      vault.balanceSol += amount;
      vault.totalShielded += amount;
      vault.history.push({ type: 'shield', amount, timestamp: Date.now() });
    } else if (action === 'unshield') {
      if (amount > vault.balanceSol) {
        return NextResponse.json({ error: `Vault has only ${vault.balanceSol.toFixed(4)} SOL` }, { status: 400 });
      }
      vault.balanceSol -= amount;
      vault.totalUnshielded += amount;
      vault.history.push({ type: 'unshield', amount, timestamp: Date.now() });
    } else {
      return NextResponse.json({ error: 'Invalid action. Use shield or unshield.' }, { status: 400 });
    }

    vault.updatedAt = Date.now();

    return NextResponse.json({
      success: true,
      vault: {
        balanceSol: vault.balanceSol,
        totalShielded: vault.totalShielded,
        totalUnshielded: vault.totalUnshielded,
        updatedAt: vault.updatedAt,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

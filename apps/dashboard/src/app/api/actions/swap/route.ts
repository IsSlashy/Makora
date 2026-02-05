import { PublicKey } from '@solana/web3.js';
import { NextRequest } from 'next/server';

// ── CORS headers required by the Solana Actions / Blinks spec ────────────────
const ACTIONS_CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, Content-Encoding, Accept-Encoding',
  'Access-Control-Expose-Headers': 'X-Action-Version, X-Blockchain-Ids',
  'X-Action-Version': '2.2',
  'X-Blockchain-Ids': 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1',
};

// ── Token mint addresses ─────────────────────────────────────────────────────
const MINTS: Record<string, string> = {
  SOL: 'So11111111111111111111111111111111111111112',
  USDC: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  mSOL: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  MSOL: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  JLP: '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4',
  JUPSOL: 'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjkRE4',
  JITOSOL: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
};

const JUPITER_API = process.env.JUPITER_API_URL || 'https://api.jup.ag/swap/v1';
const JUPITER_API_KEY = process.env.JUPITER_API_KEY || '';

function jupiterHeaders(): Record<string, string> {
  const h: Record<string, string> = {};
  if (JUPITER_API_KEY) h['x-api-key'] = JUPITER_API_KEY;
  return h;
}

// ── OPTIONS (CORS preflight) ─────────────────────────────────────────────────

export async function OPTIONS() {
  return new Response(null, { headers: ACTIONS_CORS_HEADERS });
}

// ── GET — Action metadata (what the Blink renders) ──────────────────────────

export async function GET(_request: NextRequest) {
  const payload = {
    type: 'action',
    icon: 'https://raw.githubusercontent.com/IsSlashy/Makora/main/apps/dashboard/public/wheel.png',
    title: 'Makora \u2014 Swap via Jupiter',
    description:
      'Swap tokens on Solana via Jupiter aggregator, powered by Makora AI agent.',
    label: 'Swap',
    links: {
      actions: [
        {
          type: 'transaction',
          label: 'Swap SOL \u2192 USDC',
          href: '/api/actions/swap?from=SOL&to=USDC&amount={amount}',
          parameters: [
            {
              name: 'amount',
              label: 'Amount of SOL to swap',
              required: true,
              type: 'number',
            },
          ],
        },
        {
          type: 'transaction',
          label: 'Swap SOL \u2192 mSOL (Stake)',
          href: '/api/actions/swap?from=SOL&to=mSOL&amount={amount}',
          parameters: [
            {
              name: 'amount',
              label: 'Amount of SOL to stake',
              required: true,
              type: 'number',
            },
          ],
        },
        {
          type: 'transaction',
          label: 'Swap SOL \u2192 JLP',
          href: '/api/actions/swap?from=SOL&to=JLP&amount={amount}',
          parameters: [
            {
              name: 'amount',
              label: 'Amount of SOL for JLP',
              required: true,
              type: 'number',
            },
          ],
        },
      ],
    },
  };

  return Response.json(payload, { headers: ACTIONS_CORS_HEADERS });
}

// ── POST — Build the swap transaction for the user to sign ──────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate the account field (Solana Actions spec requires `account`)
    let account: PublicKey;
    try {
      account = new PublicKey(body.account);
    } catch {
      return Response.json(
        { message: 'Invalid or missing `account` public key' },
        { status: 400, headers: ACTIONS_CORS_HEADERS },
      );
    }

    const { searchParams } = new URL(request.url);
    const from = searchParams.get('from') || 'SOL';
    const to = searchParams.get('to') || 'USDC';
    const amount = parseFloat(searchParams.get('amount') || '0');

    if (amount <= 0 || !isFinite(amount)) {
      return Response.json(
        { message: 'Invalid amount \u2014 must be a positive number' },
        { status: 400, headers: ACTIONS_CORS_HEADERS },
      );
    }

    const inputMint = MINTS[from.toUpperCase()] || MINTS.SOL;
    const outputMint = MINTS[to.toUpperCase()] || MINTS.USDC;

    if (inputMint === outputMint) {
      return Response.json(
        { message: 'Input and output tokens must be different' },
        { status: 400, headers: ACTIONS_CORS_HEADERS },
      );
    }

    // Determine the amount in the smallest unit (lamports for SOL, 6 decimals for USDC, etc.)
    // For simplicity, we assume the input is always SOL (9 decimals) by default.
    const decimals = from.toUpperCase() === 'USDC' ? 6 : 9;
    const lamports = Math.round(amount * 10 ** decimals);

    // ── 1. Get Jupiter quote ──────────────────────────────────────────────────
    const quoteUrl = `${JUPITER_API}/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${lamports}&slippageBps=100`;
    const quoteRes = await fetch(quoteUrl, { headers: jupiterHeaders() });

    if (!quoteRes.ok) {
      const errText = await quoteRes.text().catch(() => '');
      return Response.json(
        { message: `Failed to get Jupiter quote: ${errText.slice(0, 200)}` },
        { status: 502, headers: ACTIONS_CORS_HEADERS },
      );
    }

    const quote = await quoteRes.json();

    // ── 2. Build the swap transaction ─────────────────────────────────────────
    const swapRes = await fetch(`${JUPITER_API}/swap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...jupiterHeaders() },
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: account.toString(),
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            priorityLevel: 'medium',
            maxLamports: 5_000_000,
          },
        },
      }),
    });

    if (!swapRes.ok) {
      const errText = await swapRes.text().catch(() => '');
      return Response.json(
        { message: `Failed to build swap transaction: ${errText.slice(0, 200)}` },
        { status: 502, headers: ACTIONS_CORS_HEADERS },
      );
    }

    const swapData = await swapRes.json();

    if (!swapData.swapTransaction) {
      return Response.json(
        { message: 'Jupiter returned an empty swap transaction' },
        { status: 502, headers: ACTIONS_CORS_HEADERS },
      );
    }

    // ── 3. Return the serialized transaction (base64) ─────────────────────────
    return Response.json(
      {
        type: 'transaction',
        transaction: swapData.swapTransaction,
        message: `Swap ${amount} ${from} \u2192 ${to} via Makora`,
      },
      { headers: ACTIONS_CORS_HEADERS },
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    return Response.json(
      { message },
      { status: 500, headers: ACTIONS_CORS_HEADERS },
    );
  }
}

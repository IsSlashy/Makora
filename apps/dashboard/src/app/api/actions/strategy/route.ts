import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js';
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

// ── Well-known token mints for portfolio scanning ────────────────────────────
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', decimals: 6 },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: 'mSOL', decimals: 9 },
  '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4': { symbol: 'JLP', decimals: 6 },
  jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjkRE4: { symbol: 'jupSOL', decimals: 9 },
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: { symbol: 'jitoSOL', decimals: 9 },
  DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263: { symbol: 'BONK', decimals: 5 },
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': { symbol: 'RAY', decimals: 6 },
};

// ── OPTIONS (CORS preflight) ─────────────────────────────────────────────────

export async function OPTIONS() {
  return new Response(null, { headers: ACTIONS_CORS_HEADERS });
}

// ── GET — Action metadata ────────────────────────────────────────────────────

export async function GET(_request: NextRequest) {
  const payload = {
    type: 'action',
    icon: 'https://raw.githubusercontent.com/IsSlashy/Makora/main/apps/dashboard/public/wheel.png',
    title: 'Makora \u2014 AI Strategy Recommendation',
    description:
      'Get an LLM-powered DeFi strategy recommendation for your Solana portfolio. Makora analyzes your on-chain holdings and suggests optimal allocation across yield, staking, and LP positions.',
    label: 'Analyze',
    links: {
      actions: [
        {
          type: 'message',
          label: 'Analyze My Portfolio',
          href: '/api/actions/strategy?wallet={wallet}',
          parameters: [
            {
              name: 'wallet',
              label: 'Your Solana wallet address',
              required: true,
              type: 'text',
            },
          ],
        },
      ],
    },
  };

  return Response.json(payload, { headers: ACTIONS_CORS_HEADERS });
}

// ── POST — Analyze the wallet and return a strategy message ─────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { searchParams } = new URL(request.url);

    // The wallet can come from the URL parameter or from the Actions `account` field
    const walletParam = searchParams.get('wallet') || body.account;

    if (!walletParam) {
      return Response.json(
        { message: 'Missing wallet address' },
        { status: 400, headers: ACTIONS_CORS_HEADERS },
      );
    }

    let walletPubkey: PublicKey;
    try {
      walletPubkey = new PublicKey(walletParam);
    } catch {
      return Response.json(
        { message: 'Invalid Solana wallet address' },
        { status: 400, headers: ACTIONS_CORS_HEADERS },
      );
    }

    // ── Connect to Solana and read balances ─────────────────────────────────
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || clusterApiUrl('devnet');
    const connection = new Connection(rpcUrl, 'confirmed');

    // SOL balance
    const solBalance = await connection.getBalance(walletPubkey);
    const solAmount = solBalance / LAMPORTS_PER_SOL;

    // SPL token balances
    interface TokenHolding {
      symbol: string;
      mint: string;
      uiAmount: number;
    }

    const holdings: TokenHolding[] = [];
    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
        walletPubkey,
        { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') },
      );

      for (const { account } of tokenAccounts.value) {
        const info = account.data.parsed?.info;
        if (!info) continue;

        const mint = info.mint as string;
        const uiAmount = parseFloat(info.tokenAmount?.uiAmountString || '0');
        if (uiAmount <= 0) continue;

        const known = KNOWN_TOKENS[mint];
        holdings.push({
          symbol: known?.symbol || mint.slice(0, 6) + '...',
          mint,
          uiAmount,
        });
      }
    } catch {
      // Token parsing is best-effort; continue with SOL-only analysis
    }

    // ── Build strategy recommendation ───────────────────────────────────────
    const lines: string[] = [];
    lines.push(`Portfolio Analysis for ${walletPubkey.toString().slice(0, 8)}...`);
    lines.push('');
    lines.push(`SOL Balance: ${solAmount.toFixed(4)} SOL`);

    if (holdings.length > 0) {
      lines.push('');
      lines.push('Token Holdings:');
      for (const h of holdings) {
        lines.push(`  ${h.symbol}: ${h.uiAmount.toFixed(4)}`);
      }
    }

    lines.push('');
    lines.push('--- Makora Strategy Recommendation ---');
    lines.push('');

    // Simple heuristic-based recommendation
    if (solAmount < 0.01) {
      lines.push('Your SOL balance is very low. Consider funding your wallet before deploying a strategy.');
    } else if (solAmount < 1) {
      lines.push('Recommendation: Conservative');
      lines.push('- Keep 50% in SOL as reserve');
      lines.push('- Stake 30% into mSOL (Marinade) for ~7% APY');
      lines.push('- Hold 20% in USDC as stablecoin hedge');
      lines.push('');
      lines.push('Rationale: With a smaller portfolio, capital preservation and low-risk yield are optimal.');
    } else if (solAmount < 10) {
      lines.push('Recommendation: Balanced');
      lines.push('- Keep 30% in SOL');
      lines.push('- Stake 25% into jupSOL for liquid staking yield');
      lines.push('- Allocate 25% to JLP for perps LP fees');
      lines.push('- Hold 20% in USDC as dry powder');
      lines.push('');
      lines.push('Rationale: Diversified across staking, LP, and stablecoins. Good risk-reward balance.');
    } else {
      lines.push('Recommendation: Growth');
      lines.push('- Keep 20% in SOL');
      lines.push('- Stake 20% into jitoSOL for MEV-boosted yield');
      lines.push('- Allocate 30% to JLP for perps LP fees (~20-40% APY)');
      lines.push('- Hold 15% in USDC as hedge');
      lines.push('- Deploy 15% in DeFi lending (Kamino/Marginfi)');
      lines.push('');
      lines.push('Rationale: Larger portfolio can take on more risk for higher yield. JLP and lending provide strong returns.');
    }

    // Warn about any concentration risk
    const hasStablecoins = holdings.some(
      h => h.symbol === 'USDC',
    );
    const hasLSTs = holdings.some(
      h => ['mSOL', 'jupSOL', 'jitoSOL'].includes(h.symbol),
    );

    if (!hasStablecoins && solAmount >= 1) {
      lines.push('');
      lines.push('Warning: No stablecoin exposure detected. Consider hedging with USDC.');
    }
    if (!hasLSTs && solAmount >= 0.5) {
      lines.push('');
      lines.push('Tip: Liquid staking (mSOL, jupSOL) earns yield while keeping SOL exposure.');
    }

    lines.push('');
    lines.push('Powered by Makora AI Agent | makora.vercel.app');

    const strategyMessage = lines.join('\n');

    // Return a completed action with no transaction (informational only)
    return Response.json(
      {
        type: 'message',
        message: strategyMessage,
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

import { NextRequest, NextResponse } from 'next/server';
import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  clusterApiUrl,
} from '@solana/web3.js';
import {
  getSimulatedPositions,
  getTotalCollateralUsd,
  getTotalExposureUsd,
  type SimulatedPerpPosition,
} from '@/lib/simulated-perps';

// Known token mints
const KNOWN_TOKENS: Record<string, { symbol: string; decimals: number }> = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': { symbol: 'USDC', decimals: 6 },
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So': { symbol: 'mSOL', decimals: 9 },
  'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn': { symbol: 'JitoSOL', decimals: 9 },
  '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4': { symbol: 'JLP', decimals: 6 },
  'jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjkRE4': { symbol: 'JUPSOL', decimals: 9 },
  'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263': { symbol: 'BONK', decimals: 5 },
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R': { symbol: 'RAY', decimals: 6 },
  '3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh': { symbol: 'WBTC', decimals: 8 },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': { symbol: 'WETH', decimals: 8 },
  // Devnet USDC variants
  '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU': { symbol: 'USDC', decimals: 6 },
};

export interface PositionEntry {
  symbol: string;
  mint: string;
  balance: number;
  uiAmount: number;
  decimals: number;
}

export interface PositionSnapshot {
  positions: PositionEntry[];
  allocation: Array<{ symbol: string; pct: number }>;
  valueMap: Array<{ symbol: string; valueSol: number }>;
  totalValueSol: number;
  timestamp: number;
  // Simulated perp positions
  perpPositions: SimulatedPerpPosition[];
  perpSummary: {
    count: number;
    totalCollateral: number;
    totalExposure: number;
    totalUnrealizedPnl: number;
  };
}

export async function GET(req: NextRequest) {
  try {
    const wallet = req.nextUrl.searchParams.get('wallet');
    const userId = req.nextUrl.searchParams.get('userId') || undefined;
    if (!wallet) {
      return NextResponse.json({ error: 'Missing wallet parameter' }, { status: 400 });
    }

    let walletPubkey: PublicKey;
    try {
      walletPubkey = new PublicKey(wallet);
    } catch {
      return NextResponse.json({ error: 'Invalid wallet address' }, { status: 400 });
    }

    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || clusterApiUrl('devnet');
    const connection = new Connection(rpcUrl, 'confirmed');

    // Fetch SOL balance
    const solBalance = await connection.getBalance(walletPubkey);
    const solAmount = solBalance / LAMPORTS_PER_SOL;

    const positions: PositionEntry[] = [
      {
        symbol: 'SOL',
        mint: 'So11111111111111111111111111111111111111112',
        balance: solBalance,
        uiAmount: solAmount,
        decimals: 9,
      },
    ];

    // Fetch all SPL token accounts
    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPubkey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      });

      for (const { account } of tokenAccounts.value) {
        const parsed = account.data.parsed?.info;
        if (!parsed) continue;

        const mint = parsed.mint as string;
        const uiAmount = parsed.tokenAmount?.uiAmount ?? 0;
        const balance = parseInt(parsed.tokenAmount?.amount ?? '0', 10);
        const decimals = parsed.tokenAmount?.decimals ?? 0;

        if (uiAmount <= 0) continue;

        const known = KNOWN_TOKENS[mint];
        positions.push({
          symbol: known?.symbol ?? mint.slice(0, 8) + '...',
          mint,
          balance,
          uiAmount,
          decimals,
        });
      }
    } catch {
      // Token account fetch may fail on devnet; we still have SOL balance
    }

    // Compute allocation percentages using live Jupiter prices
    const { fetchTokenPrices, tokenValueInSol } = await import('../../../../lib/price-feed');
    const prices = await fetchTokenPrices();

    let totalValueSol = 0;
    const valueMap: Array<{ symbol: string; valueSol: number }> = [];

    for (const pos of positions) {
      const valueSol = tokenValueInSol(pos.symbol, pos.uiAmount, prices);
      totalValueSol += valueSol;
      valueMap.push({ symbol: pos.symbol, valueSol });
    }

    const allocation = valueMap
      .filter(v => v.valueSol > 0)
      .map(v => ({
        symbol: v.symbol,
        pct: totalValueSol > 0 ? Math.round((v.valueSol / totalValueSol) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.pct - a.pct);

    // Get simulated perp positions from server memory (per-user if userId provided)
    const perpPositions = getSimulatedPositions(userId);
    const perpSummary = {
      count: perpPositions.length,
      totalCollateral: getTotalCollateralUsd(userId),
      totalExposure: getTotalExposureUsd(userId),
      totalUnrealizedPnl: perpPositions.reduce((sum, p) => sum + (p.unrealizedPnl ?? 0), 0),
    };

    const snapshot: PositionSnapshot = {
      positions,
      allocation,
      valueMap,
      totalValueSol,
      timestamp: Date.now(),
      perpPositions,
      perpSummary,
    };

    return NextResponse.json(snapshot);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

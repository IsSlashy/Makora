import { NextRequest, NextResponse } from 'next/server';
import { Connection, clusterApiUrl, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { addDepositCredits, MAKORA_DEPOSIT_ADDRESS, SOL_TO_CREDITS_RATE } from '@/lib/credits';

/**
 * POST /api/credits/deposit — Verify on-chain SOL deposit and add credits
 *
 * Body: { userId: string, signature: string, amountSol: number }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { userId, signature, amountSol } = body;

    if (!userId || !signature || !amountSol) {
      return NextResponse.json(
        { error: 'Missing required fields: userId, signature, amountSol' },
        { status: 400 },
      );
    }

    if (amountSol <= 0 || amountSol > 100) {
      return NextResponse.json(
        { error: 'Invalid amount. Must be between 0 and 100 SOL.' },
        { status: 400 },
      );
    }

    if (!MAKORA_DEPOSIT_ADDRESS) {
      return NextResponse.json(
        { error: 'Deposit address not configured' },
        { status: 503 },
      );
    }

    // Simulated deposit signatures start with "sim-" (demo mode)
    const isSimulated = signature.startsWith('sim-');

    if (isSimulated) {
      // Demo mode: accept simulated deposits without on-chain verification
      const creditsAdded = addDepositCredits(userId, amountSol, signature);
      return NextResponse.json({
        success: true,
        creditsAdded,
        amountSol,
        signature,
        rate: SOL_TO_CREDITS_RATE,
        demo: true,
      });
    }

    // Real deposit: verify the transaction on-chain
    const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || clusterApiUrl('devnet');
    const connection = new Connection(rpcUrl, 'confirmed');

    try {
      const tx = await connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx) {
        return NextResponse.json(
          { error: 'Transaction not found. It may not be confirmed yet. Try again in a few seconds.' },
          { status: 404 },
        );
      }

      if (tx.meta?.err) {
        return NextResponse.json(
          { error: 'Transaction failed on-chain' },
          { status: 400 },
        );
      }

      // Verify the transaction transfers SOL to our deposit address
      const accountKeys = tx.transaction.message.getAccountKeys();
      const depositIdx = accountKeys.staticAccountKeys.findIndex(
        (key) => key.toBase58() === MAKORA_DEPOSIT_ADDRESS,
      );

      if (depositIdx === -1) {
        return NextResponse.json(
          { error: 'Transaction does not involve our deposit address' },
          { status: 400 },
        );
      }

      // Check the actual amount transferred (post - pre balance for deposit address)
      const preBalance = tx.meta?.preBalances?.[depositIdx] ?? 0;
      const postBalance = tx.meta?.postBalances?.[depositIdx] ?? 0;
      const transferredLamports = postBalance - preBalance;
      const transferredSol = transferredLamports / LAMPORTS_PER_SOL;

      if (transferredSol < amountSol * 0.95) {
        return NextResponse.json(
          {
            error: `Amount mismatch. Expected ${amountSol} SOL, got ${transferredSol.toFixed(6)} SOL`,
          },
          { status: 400 },
        );
      }

      const creditsAdded = addDepositCredits(userId, transferredSol, signature);

      return NextResponse.json({
        success: true,
        creditsAdded,
        amountSol: transferredSol,
        signature,
        rate: SOL_TO_CREDITS_RATE,
      });
    } catch (err) {
      return NextResponse.json(
        { error: `Verification failed: ${err instanceof Error ? err.message : 'Unknown error'}` },
        { status: 500 },
      );
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Internal error' },
      { status: 500 },
    );
  }
}

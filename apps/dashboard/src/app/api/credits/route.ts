import { NextRequest, NextResponse } from 'next/server';
import { getUserCredits, MAKORA_DEPOSIT_ADDRESS, SOL_TO_CREDITS_RATE } from '@/lib/credits';

/**
 * GET /api/credits?userId=X — Returns current balance + history
 */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
  }

  const credits = getUserCredits(userId);

  return NextResponse.json({
    userId: credits.userId,
    balance: credits.balanceCredits,
    totalDeposited: credits.totalDeposited,
    totalUsed: credits.totalUsed,
    history: credits.history.slice(-20), // Last 20 transactions
    depositAddress: MAKORA_DEPOSIT_ADDRESS,
    rate: SOL_TO_CREDITS_RATE,
  });
}

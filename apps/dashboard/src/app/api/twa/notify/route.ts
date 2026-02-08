import { NextRequest, NextResponse } from 'next/server';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

export async function POST(req: NextRequest) {
  if (!TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ ok: false, error: 'Bot token not configured' }, { status: 503 });
  }

  let body: { telegramUserId: number; walletAddress: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const { telegramUserId, walletAddress } = body;
  if (!telegramUserId || !walletAddress) {
    return NextResponse.json({ ok: false, error: 'Missing telegramUserId or walletAddress' }, { status: 400 });
  }

  const short = `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;

  const text = [
    `*Wallet Connected* \u{1F517}`,
    '',
    `Your Solana wallet \`${short}\` is now linked to Makora.`,
    '',
    `You're ready to start trading \u2014 try:`,
    `\u2022 "Shield 1 SOL" \u2014 fund your ZK vault`,
    `\u2022 "Scan the market" \u2014 get live sentiment`,
    `\u2022 "Long SOL 5x" \u2014 open a leveraged position`,
  ].join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramUserId,
        text,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '\u{1F680} Start Trading', callback_data: 'start_trading' },
          ]],
        },
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      console.error('[twa/notify] Telegram API error:', data.description);
      return NextResponse.json({ ok: false, error: data.description }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[twa/notify] Failed to send message:', err);
    return NextResponse.json({ ok: false, error: 'Telegram API unreachable' }, { status: 502 });
  }
}

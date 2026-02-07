/**
 * Inline keyboard builders for the Telegram bot.
 */

import { InlineKeyboard, Keyboard } from 'grammy';

const DASHBOARD_URL = process.env.DASHBOARD_URL || 'https://solana-agent-hackathon-seven.vercel.app';

/**
 * Trade confirmation keyboard: Confirm / Cancel
 */
export function tradeConfirmKeyboard(actionId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Confirm \u2713', `confirm:${actionId}`)
    .text('Cancel \u2717', `cancel:${actionId}`);
}

/**
 * OODA cycle approval keyboard (advisory mode)
 */
export function oodaApproveKeyboard(cycleId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('Approve All', `ooda:approve:${cycleId}`)
    .text('Reject All', `ooda:reject:${cycleId}`);
}

/**
 * Strategy selection keyboard
 */
export function strategySelectKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Conservative', 'strategy:conservative')
    .text('Balanced', 'strategy:balanced')
    .text('Aggressive', 'strategy:aggressive');
}

/**
 * Session control keyboard
 */
export function sessionControlKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Pause', 'session:pause')
    .text('Stop', 'session:stop')
    .text('Status', 'session:status');
}

/**
 * Trading mode selection keyboard
 */
export function tradingModeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('Perps', 'mode:perps')
    .text('Invest', 'mode:invest');
}

/**
 * Alerts toggle keyboard
 */
export function alertsKeyboard(currentlyEnabled: boolean): InlineKeyboard {
  if (currentlyEnabled) {
    return new InlineKeyboard().text('Disable Alerts', 'alerts:off');
  }
  return new InlineKeyboard().text('Enable Alerts', 'alerts:on');
}

/**
 * Mini App (TWA) keyboard — opens dashboard inside Telegram
 */
export function miniAppKeyboard(walletPubkey: string, chatId: number): InlineKeyboard {
  const url = `${DASHBOARD_URL}/twa?wallet=${walletPubkey}&chatId=${chatId}`;
  return new InlineKeyboard().webApp('Open Dashboard', url);
}

/**
 * Persistent reply keyboard — always visible at the bottom of the chat.
 * Grouped by usage frequency. First row = most used actions.
 */
export function mainMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text('\u{1F4CA} Status').text('\u{1F4C8} Scan').text('\u{1F9E0} Sentiment').row()
    .text('\u{1F4BC} Positions').text('\u{1F916} Auto').text('\u{2699}\uFE0F Settings').row()
    .text('\u{1F3AF} Strategy').text('\u{1F4F0} News').text('\u{2764}\uFE0F Health')
    .resized()
    .persistent();
}

/**
 * Settings sub-menu inline keyboard
 */
export function settingsInlineKeyboard(alertsOn: boolean): InlineKeyboard {
  return new InlineKeyboard()
    .text(`Alerts: ${alertsOn ? 'ON' : 'OFF'}`, alertsOn ? 'alerts:off' : 'alerts:on')
    .text('Trading Mode', 'settings:mode').row()
    .text('Setup OpenAI', 'llm:openai')
    .text('Setup Anthropic', 'llm:anthropic').row()
    .text('Disable LLM', 'llm:off')
    .text('Wallet Info', 'settings:wallet');
}

/**
 * Auto mode inline keyboard
 */
export function autoModeKeyboard(isRunning: boolean): InlineKeyboard {
  if (isRunning) {
    return new InlineKeyboard()
      .text('Run Cycle', 'auto:cycle')
      .text('Stop', 'auto:off');
  }
  return new InlineKeyboard()
    .text('Start Auto', 'auto:on')
    .text('Run Cycle', 'auto:cycle');
}

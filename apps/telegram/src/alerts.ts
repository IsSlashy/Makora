/**
 * Proactive alert system: subscribes to MakoraAgent events
 * and sends Telegram notifications to registered users.
 */

import type { Bot } from 'grammy';
import type { MakoraAgent } from '@makora/agent-core';
import type { MakoraContext } from './session.js';
import { oodaApproveKeyboard } from './keyboards.js';

// ─── User Registry ────────────────────────────────────────────────────────────

// Map userId -> chatId for routing alerts
const userChatMap = new Map<number, number>();

// Track which users have alerts enabled
const alertsEnabledMap = new Map<number, boolean>();

export function registerUserChat(userId: number, chatId: number): void {
  userChatMap.set(userId, chatId);
}

export function setUserAlerts(userId: number, enabled: boolean): void {
  alertsEnabledMap.set(userId, enabled);
}

export function isUserAlertsEnabled(userId: number): boolean {
  return alertsEnabledMap.get(userId) ?? true; // default enabled
}

// ─── Throttling ───────────────────────────────────────────────────────────────

const THROTTLE_MS = 10_000; // 10 seconds per event type per user
const SENTIMENT_THROTTLE_MS = 4 * 60 * 1000; // 4 minutes for sentiment scans
const lastAlertTimes = new Map<string, number>();

function shouldThrottle(userId: number, eventType: string): boolean {
  const key = `${userId}:${eventType}`;
  const last = lastAlertTimes.get(key) ?? 0;
  const ttl = eventType === 'sentiment_scan' ? SENTIMENT_THROTTLE_MS : THROTTLE_MS;
  if (Date.now() - last < ttl) return true;
  lastAlertTimes.set(key, Date.now());
  return false;
}

export function shouldThrottleSentiment(userId: number): boolean {
  return shouldThrottle(userId, 'sentiment_scan');
}

// ─── OODA Resolver Registry ─────────────────────────────────────────────────

// Map cycleId -> resolve function for OODA approval
const pendingOODAResolvers = new Map<string, (approved: boolean) => void>();

export function registerOODAResolver(cycleId: string, resolve: (approved: boolean) => void): void {
  pendingOODAResolvers.set(cycleId, resolve);
  // Auto-reject after 60 seconds
  setTimeout(() => {
    const resolver = pendingOODAResolvers.get(cycleId);
    if (resolver) {
      resolver(false);
      pendingOODAResolvers.delete(cycleId);
    }
  }, 60_000);
}

export function resolveOODA(cycleId: string, approved: boolean): boolean {
  const resolver = pendingOODAResolvers.get(cycleId);
  if (resolver) {
    resolver(approved);
    pendingOODAResolvers.delete(cycleId);
    return true;
  }
  return false;
}

// ─── Alert Sender ────────────────────────────────────────────────────────────

export async function sendAlert(
  bot: Bot<MakoraContext>,
  message: string,
  options?: { keyboard?: any },
): Promise<void> {
  for (const [userId, chatId] of userChatMap) {
    if (!isUserAlertsEnabled(userId)) continue;

    try {
      await bot.api.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: options?.keyboard,
      });
    } catch (err) {
      console.error(`[Alerts] Failed to send to user ${userId}:`, err);
    }
  }
}

// ─── Event Registration ─────────────────────────────────────────────────────

export function registerAlertHandlers(
  bot: Bot<MakoraContext>,
  agent: MakoraAgent,
): void {
  // We set up a confirmation callback on the agent.
  // When the OODA loop proposes actions in advisory mode,
  // it will call this callback and wait for user approval via Telegram.
  agent.setConfirmationCallback(async (actions: any[], explanation: string) => {
    const cycleId = `ooda-${Date.now()}`;
    const actionList = actions
      .map((a: any) => `- ${a.type?.toUpperCase() ?? 'ACTION'}: ${a.description ?? JSON.stringify(a)}`)
      .join('\n');

    const msg =
      `*OODA Cycle - Actions Proposed*\n\n` +
      `${explanation}\n\n` +
      `*Proposed Actions:*\n${actionList}\n\n` +
      `_Reply within 60s or actions will be auto-rejected._`;

    // Send to all registered users with approval keyboard
    for (const [userId, chatId] of userChatMap) {
      if (!isUserAlertsEnabled(userId)) continue;
      if (shouldThrottle(userId, 'cycle_completed')) continue;

      try {
        await bot.api.sendMessage(chatId, msg, {
          parse_mode: 'Markdown',
          reply_markup: oodaApproveKeyboard(cycleId),
        });
      } catch (err) {
        console.error(`[Alerts] Failed to send OODA prompt to user ${userId}:`, err);
      }
    }

    // Wait for user approval
    return new Promise<boolean>((resolve) => {
      registerOODAResolver(cycleId, resolve);
    });
  });

  console.log('[Alerts] Event handlers registered on agent');
}

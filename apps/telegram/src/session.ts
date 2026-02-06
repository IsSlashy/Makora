/**
 * Grammy session data for per-user state management.
 */

import type { Context, SessionFlavor } from 'grammy';

export interface ActiveSession {
  startedAt: number;
  budgetSol: number;
  spentSol: number;
  strategy: 'conservative' | 'balanced' | 'aggressive';
  tradesExecuted: number;
}

export interface PendingAction {
  id: string;
  type: string;
  params: Record<string, unknown>;
  expiresAt: number;
}

export interface ChatHistoryEntry {
  role: 'user' | 'assistant';
  content: string;
}

export interface SessionData {
  chatHistory: ChatHistoryEntry[];
  autoMode: boolean;
  tradingMode: 'invest' | 'perps';
  lastCycleTime: number;
  activeSession: ActiveSession | null;
  pendingAction: PendingAction | null;
  alertsEnabled: boolean;
  autonomousScanEnabled: boolean;
  /** Set when user clicks "Setup OpenAI/Anthropic" — waiting for API key paste */
  pendingLLMProvider?: 'openai' | 'anthropic';
}

export type MakoraContext = Context & SessionFlavor<SessionData>;

export const MAX_CHAT_HISTORY = 10;

export function initialSession(): SessionData {
  return {
    chatHistory: [],
    autoMode: false,
    tradingMode: 'perps',
    lastCycleTime: 0,
    activeSession: null,
    pendingAction: null,
    alertsEnabled: true,
    autonomousScanEnabled: true,
  };
}

/**
 * Push a message to chat history, keeping only the last MAX_CHAT_HISTORY entries.
 */
export function pushChatHistory(
  session: SessionData,
  role: 'user' | 'assistant',
  content: string,
): void {
  session.chatHistory.push({ role, content });
  if (session.chatHistory.length > MAX_CHAT_HISTORY) {
    session.chatHistory = session.chatHistory.slice(-MAX_CHAT_HISTORY);
  }
}

/**
 * Credits System — Usage-based billing for LLM calls.
 *
 * Users deposit SOL, get credits. Each LLM call deducts credits.
 * Storage: globalThis (same pattern as simulated-perps).
 * New users get 10 free credits (free trial).
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreditTransaction {
  id: string;
  type: 'deposit' | 'usage' | 'bonus';
  amount: number;
  description: string;
  timestamp: number;
  /** Solana tx signature (for deposits) */
  signature?: string;
}

export interface UserCredits {
  userId: string;
  balanceCredits: number;
  totalDeposited: number;
  totalUsed: number;
  history: CreditTransaction[];
  createdAt: number;
}

// ─── Constants ──────────────────────────────────────────────────────────────

/** 1 SOL = 1000 credits */
export const SOL_TO_CREDITS_RATE = 1000;

/** Free trial credits for new users */
export const FREE_TRIAL_CREDITS = 10;

/** Cost formula per LLM call (credits) */
export const COST_PER_INPUT_TOKEN = 0.001;
export const COST_PER_OUTPUT_TOKEN = 0.003;

/** Deposit address — agent's wallet receives SOL top-ups */
export const MAKORA_DEPOSIT_ADDRESS = process.env.MAKORA_DEPOSIT_ADDRESS || process.env.NEXT_PUBLIC_DEPOSIT_ADDRESS || '';

// ─── Storage ────────────────────────────────────────────────────────────────

const CREDITS_KEY = '__MAKORA_USER_CREDITS__';

function getStore(): Record<string, UserCredits> {
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as any)[CREDITS_KEY]) {
      (globalThis as any)[CREDITS_KEY] = {};
    }
    return (globalThis as any)[CREDITS_KEY];
  }
  return {};
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Get or create user credits. New users automatically receive free trial credits.
 */
export function getUserCredits(userId: string): UserCredits {
  const store = getStore();

  if (!store[userId]) {
    const now = Date.now();
    store[userId] = {
      userId,
      balanceCredits: FREE_TRIAL_CREDITS,
      totalDeposited: 0,
      totalUsed: 0,
      history: [
        {
          id: `tx-${now}-bonus`,
          type: 'bonus',
          amount: FREE_TRIAL_CREDITS,
          description: 'Welcome bonus — free trial credits',
          timestamp: now,
        },
      ],
      createdAt: now,
    };
  }

  return store[userId];
}

/**
 * Check if user has enough credits for an estimated LLM call.
 */
export function hasCredits(userId: string, estimatedCost: number = 1): boolean {
  const credits = getUserCredits(userId);
  return credits.balanceCredits >= estimatedCost;
}

/**
 * Deduct credits after an LLM call based on token usage.
 * Returns the amount deducted (may be 0 if no tokens).
 */
export function deductCredits(
  userId: string,
  inputTokens: number,
  outputTokens: number,
  description: string = 'LLM call',
): number {
  const cost = (inputTokens * COST_PER_INPUT_TOKEN) + (outputTokens * COST_PER_OUTPUT_TOKEN);
  if (cost <= 0) return 0;

  const credits = getUserCredits(userId);
  const deducted = Math.min(cost, credits.balanceCredits);

  credits.balanceCredits -= deducted;
  credits.totalUsed += deducted;
  credits.history.push({
    id: `tx-${Date.now()}-usage`,
    type: 'usage',
    amount: -deducted,
    description: `${description} (${inputTokens} in / ${outputTokens} out)`,
    timestamp: Date.now(),
  });

  return deducted;
}

/**
 * Add credits from a SOL deposit (after on-chain verification).
 */
export function addDepositCredits(
  userId: string,
  amountSol: number,
  signature: string,
): number {
  const creditsToAdd = amountSol * SOL_TO_CREDITS_RATE;
  const credits = getUserCredits(userId);

  credits.balanceCredits += creditsToAdd;
  credits.totalDeposited += amountSol;
  credits.history.push({
    id: `tx-${Date.now()}-deposit`,
    type: 'deposit',
    amount: creditsToAdd,
    description: `Deposit ${amountSol} SOL → ${creditsToAdd} credits`,
    timestamp: Date.now(),
    signature,
  });

  return creditsToAdd;
}

/**
 * Estimate cost for an LLM call (rough estimate before actual call).
 * Based on average token counts.
 */
export function estimateCost(model: string = 'default'): number {
  // Average LLM call: ~500 input tokens, ~300 output tokens
  return (500 * COST_PER_INPUT_TOKEN) + (300 * COST_PER_OUTPUT_TOKEN);
}

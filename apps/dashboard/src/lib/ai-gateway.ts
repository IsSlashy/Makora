/**
 * AI Gateway — Thin abstraction layer for LLM model selection and per-user usage tracking.
 *
 * Routes calls through Vercel AI Gateway when AI_GATEWAY_API_KEY is set,
 * otherwise falls back to direct provider endpoints.
 */

// ─── Model Presets ──────────────────────────────────────────────────────────

const MODEL_PRESETS: Record<string, string> = {
  smart: 'openai/gpt-4o',
  fast: 'openai/gpt-4o-mini',
  claude: 'anthropic/claude-sonnet-4-20250514',
};

/**
 * Resolve a preset name to a concrete model ID.
 * Accepts 'smart', 'fast', 'claude', or a raw model string.
 */
export function getModel(preset: string): string {
  return MODEL_PRESETS[preset] ?? preset;
}

// ─── Gateway Config ─────────────────────────────────────────────────────────

const AI_GATEWAY_URL = process.env.AI_GATEWAY_URL || 'https://ai-gateway.vercel.sh/v1';
const AI_GATEWAY_API_KEY = process.env.AI_GATEWAY_API_KEY || '';

export function isGatewayEnabled(): boolean {
  return AI_GATEWAY_API_KEY.length > 0;
}

/**
 * Get the base URL for OpenAI-compatible calls.
 * If AI Gateway is configured, returns the gateway URL; otherwise the direct endpoint.
 */
export function getOpenAIBaseUrl(): string {
  if (isGatewayEnabled()) return AI_GATEWAY_URL;
  return 'https://api.openai.com/v1';
}

/**
 * Get the appropriate API key for OpenAI-compatible calls.
 */
export function getOpenAIApiKey(fallbackKey?: string): string {
  if (isGatewayEnabled()) return AI_GATEWAY_API_KEY;
  return fallbackKey || process.env.OPENAI_API_KEY || '';
}

// ─── Provider Endpoints (direct, non-gateway) ──────────────────────────────

export const DIRECT_ENDPOINTS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
  qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
};

/**
 * Get the endpoint URL for a provider.
 * For OpenAI, routes through AI Gateway if enabled.
 */
export function getProviderEndpoint(provider: string): string {
  if (provider === 'openai' && isGatewayEnabled()) {
    return `${AI_GATEWAY_URL}/chat/completions`;
  }
  return DIRECT_ENDPOINTS[provider] || DIRECT_ENDPOINTS.openai;
}

// ─── Per-User Usage Tracking (in-memory) ────────────────────────────────────

interface UsageEntry {
  inputTokens: number;
  outputTokens: number;
  calls: number;
  lastCallAt: number;
}

const USAGE_KEY = '__MAKORA_AI_USAGE__';

function getUsageStore(): Record<string, UsageEntry> {
  if (typeof globalThis !== 'undefined') {
    if (!(globalThis as any)[USAGE_KEY]) {
      (globalThis as any)[USAGE_KEY] = {};
    }
    return (globalThis as any)[USAGE_KEY];
  }
  return {};
}

/**
 * Track usage for a user after an LLM call.
 */
export function trackUsage(userId: string, inputTokens: number, outputTokens: number): void {
  const store = getUsageStore();
  if (!store[userId]) {
    store[userId] = { inputTokens: 0, outputTokens: 0, calls: 0, lastCallAt: 0 };
  }
  store[userId].inputTokens += inputTokens;
  store[userId].outputTokens += outputTokens;
  store[userId].calls += 1;
  store[userId].lastCallAt = Date.now();
}

/**
 * Get usage stats for a user.
 */
export function getUserUsage(userId: string): UsageEntry | null {
  const store = getUsageStore();
  return store[userId] || null;
}

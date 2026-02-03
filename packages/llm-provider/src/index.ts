/**
 * @makora/llm-provider - LLM provider layer for Makora
 *
 * Supports Anthropic, OpenAI, and Qwen via raw fetch (zero SDK dependencies).
 * Users bring their own API key (BYOK).
 */

export type { LLMProvider } from './provider.js';
export { AnthropicProvider } from './anthropic.js';
export { OpenAIProvider } from './openai.js';
export { QwenProvider } from './qwen.js';
export { createProvider } from './factory.js';
export {
  MARKET_ANALYSIS_SYSTEM_PROMPT,
  buildMarketContext,
  buildAnalysisMessages,
} from './prompts.js';
export {
  type LLMProviderId,
  type LLMProviderConfig,
  type LLMMessage,
  type LLMCompletionOptions,
  type LLMResponse,
  type LLMStreamChunk,
  type LLMAnalysis,
  PROVIDER_MODELS,
  DEFAULT_MODEL,
} from './types.js';

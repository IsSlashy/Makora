import type { LLMProviderConfig } from './types.js';
import type { LLMProvider } from './provider.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider } from './openai.js';
import { QwenProvider } from './qwen.js';

/**
 * Create an LLM provider from config.
 * Routes to the correct implementation based on providerId.
 */
export function createProvider(config: LLMProviderConfig): LLMProvider {
  switch (config.providerId) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'openai':
      return new OpenAIProvider(config);
    case 'qwen':
      return new QwenProvider(config);
    default:
      throw new Error(`Unknown LLM provider: ${config.providerId}`);
  }
}

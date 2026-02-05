import { describe, it, expect } from 'vitest';
import { createProvider } from '../factory';
import type { LLMProviderConfig } from '../types';

describe('createProvider', () => {
  const baseConfig = {
    apiKey: 'test-key-123',
    model: 'test-model',
  };

  it('creates an Anthropic provider', () => {
    const config: LLMProviderConfig = { ...baseConfig, providerId: 'anthropic' };
    const provider = createProvider(config);
    expect(provider.providerId).toBe('anthropic');
    expect(provider.model).toBe('test-model');
  });

  it('creates an OpenAI provider', () => {
    const config: LLMProviderConfig = { ...baseConfig, providerId: 'openai' };
    const provider = createProvider(config);
    expect(provider.providerId).toBe('openai');
  });

  it('creates a Qwen provider', () => {
    const config: LLMProviderConfig = { ...baseConfig, providerId: 'qwen' };
    const provider = createProvider(config);
    expect(provider.providerId).toBe('qwen');
  });

  it('throws on unknown provider', () => {
    const config = { ...baseConfig, providerId: 'unknown' as any };
    expect(() => createProvider(config)).toThrow('Unknown LLM provider');
  });
});

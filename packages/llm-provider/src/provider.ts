import type { LLMMessage, LLMCompletionOptions, LLMResponse } from './types.js';

/**
 * LLM Provider interface.
 * All implementations use raw fetch — no SDK dependencies.
 */
export interface LLMProvider {
  readonly providerId: string;
  readonly model: string;

  /** Send messages and get a complete response. */
  complete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions,
  ): Promise<LLMResponse>;

  /** Lightweight health check — validates the API key works. */
  ping(): Promise<{ ok: boolean; model: string; error?: string }>;
}

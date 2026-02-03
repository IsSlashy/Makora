import type { LLMProvider } from './provider.js';
import type {
  LLMProviderConfig,
  LLMMessage,
  LLMCompletionOptions,
  LLMResponse,
} from './types.js';

/**
 * OpenAI Chat Completions API provider.
 * POST https://api.openai.com/v1/chat/completions
 */
export class OpenAIProvider implements LLMProvider {
  readonly providerId = 'openai';
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private defaultMaxTokens: number;
  private defaultTemperature: number;

  constructor(config: LLMProviderConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.openai.com';
    this.defaultMaxTokens = config.maxTokens ?? 4096;
    this.defaultTemperature = config.temperature ?? 0.3;
  }

  async complete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions,
  ): Promise<LLMResponse> {
    const start = Date.now();

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options?.maxTokens ?? this.defaultMaxTokens,
      temperature: options?.temperature ?? this.defaultTemperature,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (options?.jsonMode) {
      body.response_format = { type: 'json_object' };
    }

    const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`OpenAI API error ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const latencyMs = Date.now() - start;

    const content = data.choices?.[0]?.message?.content ?? '';

    return {
      content,
      model: data.model ?? this.model,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      latencyMs,
    };
  }

  async ping(): Promise<{ ok: boolean; model: string; error?: string }> {
    try {
      const res = await this.complete(
        [{ role: 'user', content: 'Reply with just the word "ok".' }],
        { maxTokens: 8, temperature: 0 },
      );
      return { ok: true, model: res.model };
    } catch (err) {
      return {
        ok: false,
        model: this.model,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

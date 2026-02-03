import type { LLMProvider } from './provider.js';
import type {
  LLMProviderConfig,
  LLMMessage,
  LLMCompletionOptions,
  LLMResponse,
} from './types.js';

/**
 * Anthropic Messages API provider.
 * POST https://api.anthropic.com/v1/messages
 */
export class AnthropicProvider implements LLMProvider {
  readonly providerId = 'anthropic';
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private defaultMaxTokens: number;
  private defaultTemperature: number;

  constructor(config: LLMProviderConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl ?? 'https://api.anthropic.com';
    this.defaultMaxTokens = config.maxTokens ?? 4096;
    this.defaultTemperature = config.temperature ?? 0.3;
  }

  async complete(
    messages: LLMMessage[],
    options?: LLMCompletionOptions,
  ): Promise<LLMResponse> {
    const start = Date.now();

    // Separate system message from user/assistant messages
    const systemMessages = messages.filter((m) => m.role === 'system');
    const chatMessages = messages.filter((m) => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: options?.maxTokens ?? this.defaultMaxTokens,
      temperature: options?.temperature ?? this.defaultTemperature,
      messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (systemMessages.length > 0) {
      body.system = systemMessages.map((m) => m.content).join('\n\n');
    }

    const res = await fetch(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
    }

    const data = await res.json();
    const latencyMs = Date.now() - start;

    const content =
      data.content
        ?.map((block: { type: string; text?: string }) =>
          block.type === 'text' ? block.text : '',
        )
        .join('') ?? '';

    return {
      content,
      model: data.model ?? this.model,
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
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

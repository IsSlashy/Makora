/**
 * LLM Provider types for Makora.
 * Zero SDK dependencies — all providers use raw fetch.
 */

export type LLMProviderId = 'anthropic' | 'openai' | 'qwen';

export interface LLMProviderConfig {
  providerId: LLMProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMCompletionOptions {
  jsonMode?: boolean;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse {
  content: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface LLMStreamChunk {
  content: string;
  done: boolean;
}

export interface LLMAnalysis {
  marketAssessment: {
    sentiment: 'bullish' | 'neutral' | 'bearish';
    confidence: number;
    reasoning: string;
    keyFactors: string[];
  };
  allocation: Array<{
    protocol: string;
    action: string;
    token: string;
    percentOfPortfolio: number;
    rationale: string;
  }>;
  riskAssessment: {
    overallRisk: number;
    warnings: string[];
  };
  explanation: string;
}

export const PROVIDER_MODELS: Record<LLMProviderId, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  qwen: ['qwen-plus', 'qwen-turbo'],
};

export const DEFAULT_MODEL: Record<LLMProviderId, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o-mini',
  qwen: 'qwen-plus',
};

'use client';

import { useState, useCallback, useEffect } from 'react';

export type LLMProviderId = 'anthropic' | 'openai' | 'qwen';

export interface LLMConfig {
  providerId: LLMProviderId;
  apiKey: string;
  model: string;
  temperature: number;
  enablePolymarket: boolean;
}

const STORAGE_KEY = 'makora_llm_config';

const PROVIDER_MODELS: Record<LLMProviderId, string[]> = {
  anthropic: ['claude-sonnet-4-20250514', 'claude-haiku-4-20250414'],
  openai: ['gpt-4o', 'gpt-4o-mini'],
  qwen: ['qwen-plus', 'qwen-turbo'],
};

const DEFAULT_MODEL: Record<LLMProviderId, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o-mini',
  qwen: 'qwen-plus',
};

function loadConfig(): LLMConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.providerId || !parsed.apiKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function useLLMConfig() {
  const [config, setConfigState] = useState<LLMConfig | null>(null);

  useEffect(() => {
    setConfigState(loadConfig());
  }, []);

  const setConfig = useCallback((newConfig: LLMConfig) => {
    setConfigState(newConfig);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newConfig));
    } catch { /* storage full — ignore */ }
  }, []);

  const clearConfig = useCallback(() => {
    setConfigState(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch { /* ignore */ }
  }, []);

  const isConfigured = config !== null && config.apiKey.length > 0;

  return {
    config,
    setConfig,
    clearConfig,
    isConfigured,
    providerModels: PROVIDER_MODELS,
    defaultModel: DEFAULT_MODEL,
  };
}

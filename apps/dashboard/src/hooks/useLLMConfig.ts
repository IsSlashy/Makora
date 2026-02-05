'use client';

import { useState, useCallback, useEffect } from 'react';

export type LLMProviderId = 'anthropic' | 'openai' | 'qwen';

export type SigningMode = 'agent' | 'wallet';

export interface LLMConfig {
  // Local model endpoint (LM Studio / Ollama / vLLM — OpenAI-compatible)
  localEndpoint: string; // e.g. http://localhost:1234

  // Cloud LLM API keys
  llmKeys: Partial<Record<LLMProviderId, string>>;

  enablePolymarket: boolean;

  // Execution signing mode: 'agent' = server-side keypair, 'wallet' = Phantom approval
  signingMode: SigningMode;
}

const STORAGE_KEY = 'makora_llm_config';

function loadConfig(): LLMConfig | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Accept if at least local endpoint or one cloud key is set
    const hasLocal = parsed.localEndpoint && parsed.localEndpoint.length > 0;
    const hasCloud = parsed.llmKeys && Object.values(parsed.llmKeys).some((k: unknown) => typeof k === 'string' && k.length > 0);
    if (!hasLocal && !hasCloud) return null;
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

  const hasLocalModel = config !== null && config.localEndpoint.length > 0;
  const hasCloudKey = config !== null && Object.values(config.llmKeys).some(k => k && k.length > 0);
  const isConfigured = hasLocalModel || hasCloudKey;

  return {
    config,
    setConfig,
    clearConfig,
    hasLocalModel,
    hasCloudKey,
    isConfigured,
  };
}

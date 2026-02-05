'use client';

import { useState, useCallback, useRef } from 'react';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface OpenClawState {
  messages: ChatMessage[];
  isStreaming: boolean;
  isConnected: boolean;
  error: string | null;
}

interface OpenClawConfig {
  gatewayUrl: string;
  token?: string;
  sessionId: string;
  llmKeys?: Partial<Record<string, string>>; // Cloud API keys fallback
}

export function useOpenClaw(config: OpenClawConfig) {
  const [state, setState] = useState<OpenClawState>({
    messages: [],
    isStreaming: false,
    isConnected: false,
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);

  const setConnected = useCallback((connected: boolean) => {
    setState(prev => ({ ...prev, isConnected: connected }));
  }, []);

  const clearChat = useCallback(() => {
    setState(prev => ({
      ...prev,
      messages: [],
      error: null,
    }));
  }, []);

  const injectContext = useCallback((context: string) => {
    setState(prev => {
      const nonSystem = prev.messages.filter(m => m.role !== 'system');
      const sysMsg: ChatMessage = {
        id: `sys-${Date.now()}`,
        role: 'system',
        content: context,
        timestamp: Date.now(),
      };
      return { ...prev, messages: [sysMsg, ...nonSystem] };
    });
  }, []);

  const sendMessage = useCallback(async (content: string, systemContext?: string) => {
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    const assistantMsg: ChatMessage = {
      id: `asst-${Date.now()}`,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };

    setState(prev => ({
      ...prev,
      messages: [...prev.messages, userMsg, assistantMsg],
      isStreaming: true,
      error: null,
    }));

    // Build messages payload (include all history)
    const apiMessages = [...state.messages, userMsg].map(m => ({
      role: m.role,
      content: m.content,
    }));

    // Inject system context directly into the API payload (avoids stale closure)
    if (systemContext) {
      apiMessages.unshift({ role: 'system', content: systemContext });
    }

    abortRef.current = new AbortController();

    try {
      const res = await fetch('/api/openclaw/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          gatewayUrl: config.gatewayUrl,
          token: config.token,
          sessionId: config.sessionId,
          llmKeys: config.llmKeys, // Cloud API keys fallback
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(errData.error || `Gateway error ${res.status}`);
      }

      const data = await res.json();
      const responseContent = data.content || '';

      // Set the full response at once
      setState(prev => {
        const msgs = [...prev.messages];
        const last = msgs[msgs.length - 1];
        if (last && last.role === 'assistant') {
          msgs[msgs.length - 1] = { ...last, content: responseContent };
        }
        return { ...prev, messages: msgs, isStreaming: false, isConnected: true };
      });
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setState(prev => ({ ...prev, isStreaming: false }));
        return;
      }
      setState(prev => ({
        ...prev,
        isStreaming: false,
        error: err instanceof Error ? err.message : 'Request error',
      }));
    }
  }, [state.messages, config.gatewayUrl, config.token, config.sessionId, config.llmKeys]);

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
    setState(prev => ({ ...prev, isStreaming: false }));
  }, []);

  const checkConnection = useCallback(async () => {
    try {
      const res = await fetch('/api/openclaw/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gatewayUrl: config.gatewayUrl,
          token: config.token,
          llmKeys: config.llmKeys, // Cloud API keys fallback
        }),
      });
      const data = await res.json();
      setState(prev => ({
        ...prev,
        isConnected: data.ok === true,
        error: data.ok ? null : (data.error ?? 'Connection failed'),
      }));
      return data.ok === true;
    } catch {
      setState(prev => ({ ...prev, isConnected: false, error: 'Network error' }));
      return false;
    }
  }, [config.gatewayUrl, config.token, config.llmKeys]);

  return {
    ...state,
    sendMessage,
    clearChat,
    injectContext,
    stopStreaming,
    checkConnection,
    setConnected,
  };
}

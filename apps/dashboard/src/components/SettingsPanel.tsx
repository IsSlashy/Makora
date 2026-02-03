'use client';

import { useState, useEffect } from 'react';
import { useLLMConfig, type LLMProviderId, type LLMConfig } from '@/hooks/useLLMConfig';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const PROVIDER_LABELS: Record<LLMProviderId, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  qwen: 'Qwen (Alibaba)',
};

export const SettingsPanel = ({ open, onClose }: SettingsPanelProps) => {
  const { config, setConfig, clearConfig, providerModels, defaultModel } = useLLMConfig();

  const [providerId, setProviderId] = useState<LLMProviderId>(config?.providerId ?? 'anthropic');
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '');
  const [model, setModel] = useState(config?.model ?? defaultModel.anthropic);
  const [temperature, setTemperature] = useState(config?.temperature ?? 0.3);
  const [enablePolymarket, setEnablePolymarket] = useState(config?.enablePolymarket ?? true);
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'error'>('idle');
  const [testError, setTestError] = useState('');
  const [testLatency, setTestLatency] = useState(0);

  useEffect(() => {
    if (config) {
      setProviderId(config.providerId);
      setApiKey(config.apiKey);
      setModel(config.model);
      setTemperature(config.temperature);
      setEnablePolymarket(config.enablePolymarket);
    }
  }, [config]);

  useEffect(() => {
    setModel(defaultModel[providerId]);
  }, [providerId, defaultModel]);

  const handleSave = () => {
    setConfig({ providerId, apiKey, model, temperature, enablePolymarket });
    onClose();
  };

  const handleTest = async () => {
    setTestStatus('testing');
    setTestError('');
    try {
      const res = await fetch('/api/llm/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId, apiKey, model }),
      });
      const data = await res.json();
      if (data.ok) {
        setTestStatus('ok');
        setTestLatency(data.latencyMs ?? 0);
      } else {
        setTestStatus('error');
        setTestError(data.error ?? 'Connection failed');
      }
    } catch (err) {
      setTestStatus('error');
      setTestError(err instanceof Error ? err.message : 'Network error');
    }
  };

  const handleClear = () => {
    clearConfig();
    setApiKey('');
    setProviderId('anthropic');
    setModel(defaultModel.anthropic);
    setTemperature(0.3);
    setEnablePolymarket(true);
    setTestStatus('idle');
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-md h-full bg-bg-card border-l border-cursed/15 overflow-y-auto animate-fade-up">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="text-sm font-mono tracking-[0.15em] text-cursed uppercase font-bold">
              Agent Settings
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg font-mono">
              x
            </button>
          </div>

          {/* Provider selector */}
          <div className="mb-5">
            <label className="block text-[10px] font-mono tracking-wider text-text-muted uppercase mb-2">
              LLM Provider
            </label>
            <div className="flex gap-2">
              {(Object.keys(PROVIDER_LABELS) as LLMProviderId[]).map((id) => (
                <button
                  key={id}
                  onClick={() => setProviderId(id)}
                  className={`flex-1 px-2 py-2 text-[10px] font-mono tracking-wider border transition-colors ${
                    providerId === id
                      ? 'border-cursed/50 bg-cursed/10 text-cursed'
                      : 'border-cursed/10 bg-bg-inner text-text-muted hover:border-cursed/25'
                  }`}
                >
                  {PROVIDER_LABELS[id]}
                </button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div className="mb-5">
            <label className="block text-[10px] font-mono tracking-wider text-text-muted uppercase mb-2">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={`Enter your ${PROVIDER_LABELS[providerId].split(' ')[0]} API key`}
              className="w-full px-3 py-2 text-[11px] font-mono bg-bg-inner border border-cursed/15 text-text-primary placeholder:text-text-muted/50 focus:border-cursed/40 focus:outline-none"
            />
            <div className="mt-1 text-[9px] font-mono text-text-muted">
              Stored in localStorage only. Never sent to our servers.
            </div>
          </div>

          {/* Model selector */}
          <div className="mb-5">
            <label className="block text-[10px] font-mono tracking-wider text-text-muted uppercase mb-2">
              Model
            </label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="w-full px-3 py-2 text-[11px] font-mono bg-bg-inner border border-cursed/15 text-text-primary focus:border-cursed/40 focus:outline-none"
            >
              {providerModels[providerId].map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          {/* Temperature */}
          <div className="mb-5">
            <label className="block text-[10px] font-mono tracking-wider text-text-muted uppercase mb-2">
              Temperature: {temperature.toFixed(1)}
            </label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.1"
              value={temperature}
              onChange={(e) => setTemperature(parseFloat(e.target.value))}
              className="w-full accent-cursed"
            />
            <div className="flex justify-between text-[9px] font-mono text-text-muted">
              <span>Precise (0.0)</span>
              <span>Creative (1.0)</span>
            </div>
          </div>

          {/* Polymarket toggle */}
          <div className="mb-6">
            <label className="flex items-center gap-3 cursor-pointer">
              <div
                onClick={() => setEnablePolymarket(!enablePolymarket)}
                className={`w-10 h-5 rounded-full transition-colors relative ${
                  enablePolymarket ? 'bg-cursed/40' : 'bg-bg-inner border border-cursed/15'
                }`}
              >
                <div
                  className={`absolute top-0.5 w-4 h-4 rounded-full transition-all ${
                    enablePolymarket ? 'left-5 bg-cursed' : 'left-0.5 bg-text-muted'
                  }`}
                />
              </div>
              <span className="text-[10px] font-mono tracking-wider text-text-secondary uppercase">
                Enable Polymarket Intelligence
              </span>
            </label>
          </div>

          {/* Test connection */}
          <div className="mb-6">
            <button
              onClick={handleTest}
              disabled={!apiKey || testStatus === 'testing'}
              className="w-full px-3 py-2.5 text-[10px] font-mono tracking-[0.15em] uppercase border border-cursed/30 text-cursed hover:bg-cursed/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {testStatus === 'testing' ? 'Testing...' : 'Test Connection'}
            </button>
            {testStatus === 'ok' && (
              <div className="mt-2 text-[10px] font-mono text-positive">
                Connected — {testLatency}ms latency
              </div>
            )}
            {testStatus === 'error' && (
              <div className="mt-2 text-[10px] font-mono text-negative">
                {testError}
              </div>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={!apiKey}
              className="flex-1 px-3 py-2.5 text-[10px] font-mono tracking-[0.15em] uppercase bg-cursed/15 border border-cursed/40 text-cursed hover:bg-cursed/25 transition-colors font-bold disabled:opacity-40"
            >
              Save
            </button>
            <button
              onClick={handleClear}
              className="px-4 py-2.5 text-[10px] font-mono tracking-[0.15em] uppercase border border-negative/30 text-negative hover:bg-negative/10 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

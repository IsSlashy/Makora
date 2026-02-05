'use client';

import { useState, useEffect } from 'react';
import { useLLMConfig, type LLMProviderId } from '@/hooks/useLLMConfig';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const PROVIDER_INFO: Record<LLMProviderId, { label: string; placeholder: string }> = {
  anthropic: { label: 'Anthropic (Claude)', placeholder: 'sk-ant-...' },
  openai: { label: 'OpenAI (GPT)', placeholder: 'sk-...' },
  qwen: { label: 'Qwen (Cloud)', placeholder: 'sk-...' },
};

export const SettingsPanel = ({ open, onClose }: SettingsPanelProps) => {
  const { config, setConfig, clearConfig } = useLLMConfig();

  // Local model
  const [localEndpoint, setLocalEndpoint] = useState(config?.localEndpoint ?? '');
  const [localStatus, setLocalStatus] = useState<'idle' | 'testing' | 'connected' | 'error'>('idle');
  const [localError, setLocalError] = useState('');
  const [localLatency, setLocalLatency] = useState(0);

  // Cloud keys
  const [llmKeys, setLlmKeys] = useState<Partial<Record<LLMProviderId, string>>>(config?.llmKeys ?? {});
  const [keyStatus, setKeyStatus] = useState<Partial<Record<LLMProviderId, 'idle' | 'testing' | 'ok' | 'error'>>>({});
  const [keyError, setKeyError] = useState<Partial<Record<LLMProviderId, string>>>({});

  // Intelligence
  const [enablePolymarket, setEnablePolymarket] = useState(config?.enablePolymarket ?? true);

  useEffect(() => {
    if (config) {
      setLocalEndpoint(config.localEndpoint);
      setLlmKeys(config.llmKeys ?? {});
      setEnablePolymarket(config.enablePolymarket);
      if (config.localEndpoint) setLocalStatus('connected');
    }
  }, [config]);

  // ── Test local model endpoint ────────────────────────────
  const handleTestLocal = async () => {
    setLocalStatus('testing');
    setLocalError('');
    try {
      const start = Date.now();
      const res = await fetch('/api/openclaw/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gatewayUrl: localEndpoint }),
      });
      const data = await res.json();
      const latency = Date.now() - start;
      if (data.ok) {
        setLocalStatus('connected');
        setLocalLatency(latency);
      } else {
        setLocalStatus('error');
        setLocalError(data.error ?? 'Connection failed');
      }
    } catch (err) {
      setLocalStatus('error');
      setLocalError(err instanceof Error ? err.message : 'Network error');
    }
  };

  // ── Save ─────────────────────────────────────────────────
  const handleSave = () => {
    setConfig({ localEndpoint, llmKeys, enablePolymarket, signingMode: config?.signingMode ?? 'agent' });
    onClose();
  };

  // ── Clear ────────────────────────────────────────────────
  const handleClear = () => {
    clearConfig();
    setLocalEndpoint('');
    setLlmKeys({});
    setEnablePolymarket(true);
    setLocalStatus('idle');
  };

  const updateKey = (provider: LLMProviderId, value: string) => {
    setLlmKeys(prev => ({ ...prev, [provider]: value }));
    setKeyStatus(prev => ({ ...prev, [provider]: 'idle' }));
  };

  // ── Test cloud API key ─────────────────────────────────────
  const handleTestKey = async (provider: LLMProviderId) => {
    const key = llmKeys[provider];
    if (!key) return;

    setKeyStatus(prev => ({ ...prev, [provider]: 'testing' }));
    setKeyError(prev => ({ ...prev, [provider]: '' }));

    const modelMap: Record<LLMProviderId, string> = {
      anthropic: 'claude-sonnet-4-20250514',
      openai: 'gpt-4o-mini',
      qwen: 'qwen-plus',
    };

    try {
      const res = await fetch('/api/llm/ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, apiKey: key, model: modelMap[provider] }),
      });
      const data = await res.json();

      if (data.ok) {
        setKeyStatus(prev => ({ ...prev, [provider]: 'ok' }));
      } else {
        setKeyStatus(prev => ({ ...prev, [provider]: 'error' }));
        setKeyError(prev => ({ ...prev, [provider]: data.error || 'Connection failed' }));
      }
    } catch (err) {
      setKeyStatus(prev => ({ ...prev, [provider]: 'error' }));
      setKeyError(prev => ({ ...prev, [provider]: err instanceof Error ? err.message : 'Network error' }));
    }
  };

  const isLocalConnected = localStatus === 'connected';
  const keyCount = Object.values(llmKeys).filter(k => k && k.length > 0).length;
  const canSave = isLocalConnected || keyCount > 0;

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md h-full bg-bg-card border-l border-cursed/15 overflow-y-auto animate-fade-up">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-mono tracking-[0.15em] text-cursed uppercase font-bold">
              Agent Intelligence
            </div>
            <button onClick={onClose} className="text-text-muted hover:text-text-primary text-lg font-mono">
              x
            </button>
          </div>
          <div className="text-[9px] font-mono text-text-muted mb-6">
            Configure at least one LLM source. <span className="text-cursed">Cloud API keys work without local model.</span>
          </div>

          {/* ═══════════════════════════════════════════════════════
              OPTION A — Local Model (LM Studio / Ollama)
             ═══════════════════════════════════════════════════════ */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-2 h-2 rounded-full ${isLocalConnected ? 'bg-positive animate-pulse' : 'bg-text-muted/30'}`} />
              <span className="text-[10px] font-mono tracking-[0.15em] text-text-secondary uppercase font-bold">
                Local Model
              </span>
              {isLocalConnected && (
                <span className="text-[9px] font-mono text-positive ml-auto">{localLatency}ms</span>
              )}
            </div>

            <div className="text-[9px] font-mono text-text-muted mb-3">
              If you have a model running locally (LM Studio, Ollama, vLLM), enter the endpoint below. No API key needed.
            </div>

            <label className="block text-[10px] font-mono tracking-wider text-text-muted uppercase mb-1.5">
              Endpoint
            </label>
            <input
              type="text"
              value={localEndpoint}
              onChange={(e) => { setLocalEndpoint(e.target.value); setLocalStatus('idle'); }}
              placeholder="http://localhost:1234"
              className="w-full px-3 py-2 text-[11px] font-mono bg-bg-inner border border-cursed/15 text-text-primary placeholder:text-text-muted/50 focus:border-cursed/40 focus:outline-none"
            />

            <button
              onClick={handleTestLocal}
              disabled={!localEndpoint || localStatus === 'testing'}
              className="w-full mt-2 px-3 py-2 text-[10px] font-mono tracking-[0.15em] uppercase border border-cursed/30 text-cursed hover:bg-cursed/10 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {localStatus === 'testing' ? 'Testing...' : isLocalConnected ? 'Reconnect' : 'Test Connection'}
            </button>

            {localStatus === 'connected' && (
              <div className="mt-2 text-[10px] font-mono text-positive">Model connected</div>
            )}
            {localStatus === 'error' && (
              <div className="mt-2 text-[10px] font-mono text-negative">{localError}</div>
            )}
          </div>

          {/* Divider — OR */}
          <div className="flex items-center gap-3 mb-6">
            <div className="flex-1 border-t border-cursed/15" />
            <span className="text-[9px] font-mono text-text-muted tracking-widest">AND / OR</span>
            <div className="flex-1 border-t border-cursed/15" />
          </div>

          {/* ═══════════════════════════════════════════════════════
              OPTION B — Cloud API Keys
             ═══════════════════════════════════════════════════════ */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-2 h-2 rounded-full ${keyCount > 0 ? 'bg-positive animate-pulse' : 'bg-text-muted/30'}`} />
              <span className="text-[10px] font-mono tracking-[0.15em] text-text-secondary uppercase font-bold">
                Cloud API Keys
              </span>
              {keyCount > 0 && (
                <span className="text-[9px] font-mono text-positive ml-auto">{keyCount} active</span>
              )}
            </div>

            <div className="text-[9px] font-mono text-text-muted mb-3">
              Add API keys for cloud LLM providers. The agent will use the first available key for reasoning.
            </div>

            {(Object.keys(PROVIDER_INFO) as LLMProviderId[]).map((id) => (
              <div key={id} className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-mono tracking-wider text-text-muted uppercase">
                    {PROVIDER_INFO[id].label}
                  </label>
                  {keyStatus[id] === 'ok' && (
                    <span className="text-[9px] font-mono text-positive">✓ Connected</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={llmKeys[id] ?? ''}
                    onChange={(e) => updateKey(id, e.target.value)}
                    placeholder={PROVIDER_INFO[id].placeholder}
                    className={`flex-1 px-3 py-2 text-[11px] font-mono bg-bg-inner border text-text-primary placeholder:text-text-muted/50 focus:border-cursed/40 focus:outline-none transition-colors ${
                      keyStatus[id] === 'ok'
                        ? 'border-positive/40'
                        : keyStatus[id] === 'error'
                          ? 'border-negative/40'
                          : llmKeys[id] && llmKeys[id]!.length > 0
                            ? 'border-cursed/30'
                            : 'border-cursed/15'
                    }`}
                  />
                  <button
                    onClick={() => handleTestKey(id)}
                    disabled={!llmKeys[id] || keyStatus[id] === 'testing'}
                    className="px-3 py-2 text-[9px] font-mono tracking-wider uppercase border border-cursed/30 text-cursed hover:bg-cursed/10 transition-colors disabled:opacity-40"
                  >
                    {keyStatus[id] === 'testing' ? '...' : 'Test'}
                  </button>
                </div>
                {keyStatus[id] === 'error' && keyError[id] && (
                  <div className="mt-1 text-[9px] font-mono text-negative">{keyError[id]}</div>
                )}
              </div>
            ))}

            <div className="text-[9px] font-mono text-text-muted">
              Keys stored in your browser only. Sent directly to provider APIs for inference.
            </div>
          </div>

          <div className="border-t border-cursed/15 mb-6" />

          {/* ═══════════════════════════════════════════════════════
              Intelligence Sources
             ═══════════════════════════════════════════════════════ */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-2 h-2 rounded-full ${enablePolymarket ? 'bg-positive animate-pulse' : 'bg-text-muted/30'}`} />
              <span className="text-[10px] font-mono tracking-[0.15em] text-text-secondary uppercase font-bold">
                Intelligence
              </span>
            </div>

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
                Polymarket Prediction Markets
              </span>
            </label>
            <div className="mt-1 text-[9px] font-mono text-text-muted ml-[52px]">
              Feed crypto prediction market signals into agent analysis.
            </div>
          </div>

          <div className="border-t border-cursed/10 mb-6" />

          {/* Action buttons */}
          <div className="flex gap-3">
            <button
              onClick={handleSave}
              disabled={!canSave}
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

          {!canSave && (
            <div className="mt-3 text-[9px] font-mono text-text-muted text-center">
              Add at least one API key to enable MoltBot intelligence.
            </div>
          )}

          {canSave && !isLocalConnected && keyCount > 0 && (
            <div className="mt-3 p-2 bg-positive/10 border border-positive/20 text-[9px] font-mono text-positive text-center">
              MoltBot will use cloud LLM ({keyCount} key{keyCount > 1 ? 's' : ''} configured)
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

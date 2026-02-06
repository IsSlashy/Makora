'use client';

import { useState, useEffect } from 'react';

interface OnboardingBannerProps {
  walletConnected: boolean;
  llmConfigured: boolean;
  onDismiss: () => void;
}

export const OnboardingBanner = ({ walletConnected, llmConfigured, onDismiss }: OnboardingBannerProps) => {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(false);

  // Animate in on mount
  useEffect(() => {
    const timer = setTimeout(() => setMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // If everything is configured, hide
  if (walletConnected && llmConfigured) return null;
  if (!visible) return null;

  const handleDismiss = () => {
    setVisible(false);
    onDismiss();
  };

  // Determine which message to show
  const showWalletPrompt = !walletConnected;
  const showLLMPrompt = walletConnected && !llmConfigured;

  return (
    <div
      className={`relative flex items-center gap-3 px-4 py-3 border rounded transition-all duration-300 ${
        mounted ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
      }`}
      style={{
        background: 'linear-gradient(90deg, rgba(212,168,41,0.08) 0%, rgba(18,18,26,0.95) 100%)',
        borderColor: 'rgba(212,168,41,0.25)',
      }}
    >
      {/* Left icon */}
      <div className="flex-shrink-0">
        {showWalletPrompt && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-cursed"
          >
            <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
            <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
            <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
          </svg>
        )}
        {showLLMPrompt && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-cursed"
          >
            <path d="M12 8V4H8" />
            <rect width="16" height="12" x="4" y="8" rx="2" />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M15 13v2" />
            <path d="M9 13v2" />
          </svg>
        )}
      </div>

      {/* Message */}
      <div className="flex-1 min-w-0">
        {showWalletPrompt && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-cursed/90 tracking-wide">
              Connect your Solana wallet to get started
            </span>
            <span className="text-cursed animate-pulse text-sm" aria-hidden="true">
              &rarr;
            </span>
          </div>
        )}
        {showLLMPrompt && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-cursed/90 tracking-wide">
              Configure your LLM API key in Settings to enable AI-powered trading
            </span>
            <span className="text-cursed animate-pulse text-sm" aria-hidden="true">
              &rarr;
            </span>
          </div>
        )}
        <p className="text-[11px] md:text-[9px] font-mono text-text-muted mt-0.5 tracking-wider">
          {showWalletPrompt
            ? 'Phantom or Solflare recommended — this is devnet, no real funds required'
            : 'Supports Anthropic, OpenAI, or a local model (LM Studio / Ollama)'}
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex-shrink-0 flex items-center gap-1.5 mr-2">
        <div
          className={`w-1.5 h-1.5 rounded-full transition-colors ${
            walletConnected ? 'bg-positive' : 'bg-cursed/60 animate-pulse'
          }`}
        />
        <div
          className={`w-1.5 h-1.5 rounded-full transition-colors ${
            llmConfigured ? 'bg-positive' : walletConnected ? 'bg-cursed/60 animate-pulse' : 'bg-text-muted/30'
          }`}
        />
      </div>

      {/* Dismiss button */}
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 p-3 md:p-1 min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 flex items-center justify-center text-text-muted hover:text-cursed transition-colors"
        title="Dismiss"
        aria-label="Dismiss onboarding banner"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 6 6 18" />
          <path d="m6 6 12 12" />
        </svg>
      </button>
    </div>
  );
};

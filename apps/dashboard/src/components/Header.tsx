'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletButton } from './WalletButton';
import { TradingModeBadge } from './TradingModeSelector';
import type { TradingMode } from '@/hooks/useOODALoop';

interface HeaderProps {
  onSettingsOpen?: () => void;
  llmModel?: string;
  sentimentBias?: 'bullish' | 'neutral' | 'bearish';
  tradingMode?: TradingMode;
  onTradingModeChange?: (mode: TradingMode) => void;
}

const BIAS_DOT: Record<string, string> = {
  bullish: 'bg-positive',
  neutral: 'bg-caution',
  bearish: 'bg-negative',
};

export const Header = ({ onSettingsOpen, llmModel, sentimentBias, tradingMode, onTradingModeChange }: HeaderProps) => {
  const { publicKey, connected } = useWallet();

  // Toggle between trading modes
  const handleModeClick = () => {
    if (onTradingModeChange && tradingMode) {
      onTradingModeChange(tradingMode === 'invest' ? 'perps' : 'invest');
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-bg-void/90 backdrop-blur-sm border-b border-cursed/10">
      <div className="max-w-[1600px] 2xl:max-w-[2200px] mx-auto px-6 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-5">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <img
                src="/wheel.png"
                alt="Makora"
                className="w-8 h-8 invert opacity-80"
                style={{ filter: 'invert(1) sepia(1) saturate(3) hue-rotate(230deg) brightness(0.85)' }}
              />
              <h1 className="font-display text-2xl tracking-[0.3em] text-cursed-gradient">
                MAKORA
              </h1>
            </div>

            {/* Version */}
            <span className="hidden md:inline text-[9px] font-mono text-text-muted tracking-wider">v0.1</span>

            {/* Status */}
            <div className="hidden sm:flex items-center gap-2 px-3 py-1 border border-cursed/20 bg-cursed-faint">
              <div className={`w-1.5 h-1.5 ${connected ? 'bg-cursed animate-pulse' : 'bg-text-muted'}`} />
              <span className="text-[10px] font-mono tracking-wider text-cursed uppercase">
                {connected ? 'Adapting' : 'Idle'}
              </span>
            </div>

            {/* LLM provider badge */}
            {llmModel && (
              <div className="hidden md:flex items-center gap-2 px-2 py-1 border border-shadow-purple/30 bg-shadow-purple/5">
                <div className="w-1.5 h-1.5 bg-shadow-purple animate-pulse" />
                <span className="text-[9px] font-mono tracking-wider text-shadow-purple uppercase">
                  {llmModel}
                </span>
              </div>
            )}

            {/* Polymarket sentiment dot */}
            {sentimentBias && (
              <div className="hidden md:flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${BIAS_DOT[sentimentBias]}`} />
                <span className="text-[9px] font-mono text-text-muted tracking-wider uppercase">
                  {sentimentBias}
                </span>
              </div>
            )}

            {/* Trading mode badge */}
            {tradingMode && (
              <TradingModeBadge mode={tradingMode} onClick={handleModeClick} />
            )}
          </div>

          <div className="flex items-center gap-4">
            {/* Network */}
            <div className="hidden md:flex items-center gap-2 text-[10px] text-text-muted font-mono tracking-wider uppercase">
              <div className={`w-1.5 h-1.5 ${connected ? 'bg-positive' : 'bg-text-muted'}`} />
              Devnet
            </div>

            {/* External links */}
            <div className="hidden md:flex items-center gap-3">
              <a href="https://github.com/IsSlashy/Makora" target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-text-muted hover:text-cursed transition-colors tracking-wider uppercase">
                GitHub
              </a>
              <a href="https://x.com/Not_Mikuu" target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-text-muted hover:text-cursed transition-colors tracking-wider uppercase">
                Twitter
              </a>
            </div>

            {/* Settings gear */}
            <button
              onClick={onSettingsOpen}
              className="p-2 text-text-muted hover:text-cursed transition-colors"
              title="Agent Settings"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>

            <WalletButton />
          </div>
        </div>
      </div>
    </header>
  );
};

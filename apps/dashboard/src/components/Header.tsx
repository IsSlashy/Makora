'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletButton } from './WalletButton';
import { TradingModeBadge } from './TradingModeSelector';
import type { TradingMode } from '@/hooks/useOODALoop';

interface HeaderProps {
  sentimentBias?: 'bullish' | 'neutral' | 'bearish';
  tradingMode?: TradingMode;
  onTradingModeChange?: (mode: TradingMode) => void;
}

const BIAS_DOT: Record<string, string> = {
  bullish: 'bg-positive',
  neutral: 'bg-caution',
  bearish: 'bg-negative',
};

export const Header = ({ sentimentBias, tradingMode, onTradingModeChange }: HeaderProps) => {
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
                style={{ filter: 'invert(1) sepia(1) saturate(3) hue-rotate(160deg) brightness(0.85)' }}
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
              <a href="https://www.anonme.sh" target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-text-muted hover:text-cursed transition-colors tracking-wider uppercase">
                anonme.sh
              </a>
              <a href="https://github.com/anonmesh" target="_blank" rel="noopener noreferrer" className="text-[10px] font-mono text-text-muted hover:text-cursed transition-colors tracking-wider uppercase">
                GitHub
              </a>
              <a href="https://x.com/anon0mesh" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[10px] font-mono text-text-muted hover:text-cursed transition-colors tracking-wider">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                @anon0mesh
              </a>
            </div>

            <WalletButton />
          </div>
        </div>
      </div>
    </header>
  );
};

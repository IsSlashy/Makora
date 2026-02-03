'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletButton } from './WalletButton';

export const Header = () => {
  const { publicKey, connected } = useWallet();

  return (
    <header className="sticky top-0 z-50 bg-bg-void/90 backdrop-blur-sm border-b border-cursed/10">
      <div className="max-w-[1400px] mx-auto px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-5">
            {/* Logo */}
            <div className="flex items-center gap-3">
              <img
                src="/wheel.png"
                alt="Makora"
                className="w-8 h-8 invert opacity-80"
                style={{ filter: 'invert(1) sepia(1) saturate(3) hue-rotate(10deg) brightness(0.85)' }}
              />
              <h1 className="font-display text-2xl tracking-[0.3em] text-cursed-gradient">
                MAKORA
              </h1>
            </div>

            {/* Status */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1 border border-cursed/20 bg-cursed-faint">
              <div className={`w-1.5 h-1.5 ${connected ? 'bg-cursed animate-pulse' : 'bg-text-muted'}`} />
              <span className="text-[10px] font-mono tracking-wider text-cursed uppercase">
                {connected ? 'Adapting' : 'Idle'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {/* Network */}
            <div className="hidden md:flex items-center gap-2 text-[10px] text-text-muted font-mono tracking-wider uppercase">
              <div className={`w-1.5 h-1.5 ${connected ? 'bg-positive' : 'bg-text-muted'}`} />
              Devnet
            </div>
            <WalletButton />
          </div>
        </div>
      </div>
    </header>
  );
};

'use client';

import { WalletButton } from './WalletButton';

export const Header = () => {
  return (
    <header className="sticky top-0 z-50 glass-card mb-8">
      <div className="container mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-3xl font-bold gradient-text">MAKORA</h1>
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-bg-secondary border border-accent/30">
              <div className="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
              <span className="text-sm font-medium text-accent-light">Auto Mode</span>
            </div>
          </div>
          <WalletButton />
        </div>
      </div>
    </header>
  );
};

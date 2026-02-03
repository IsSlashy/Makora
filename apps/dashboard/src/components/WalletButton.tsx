'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export const WalletButton = () => {
  const { publicKey } = useWallet();

  return (
    <div className="flex items-center gap-2">
      {publicKey && (
        <div className="hidden md:flex items-center gap-2 px-3 py-2 glass-card">
          <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
          <span className="text-sm text-text-secondary">
            {publicKey.toString().slice(0, 4)}...{publicKey.toString().slice(-4)}
          </span>
        </div>
      )}
      <WalletMultiButton className="!bg-accent hover:!bg-accent-light transition-all !rounded-lg" />
    </div>
  );
};

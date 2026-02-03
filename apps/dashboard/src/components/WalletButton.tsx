'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export const WalletButton = () => {
  const { publicKey } = useWallet();

  return (
    <div className="flex items-center gap-3">
      {publicKey && (
        <div className="hidden md:flex items-center gap-2 px-2.5 py-1 border border-cursed/15 bg-cursed-faint">
          <div className="w-1.5 h-1.5 bg-positive" />
          <span className="text-[10px] font-mono text-text-secondary">
            {publicKey.toString().slice(0, 4)}...{publicKey.toString().slice(-4)}
          </span>
        </div>
      )}
      <WalletMultiButton
        className="!bg-cursed/15 !border !border-cursed/30 hover:!bg-cursed/25 !transition-colors !rounded-none !text-cursed !font-mono !text-[10px] !tracking-wider !uppercase !h-8 !px-3"
      />
    </div>
  );
};

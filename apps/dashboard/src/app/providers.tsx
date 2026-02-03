'use client';

import { FC, ReactNode, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { clusterApiUrl } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { ActivityContext, useActivityFeedState } from '@/hooks/useActivityFeed';

// Polyfill Buffer for browser (needed by @solana/web3.js and @coral-xyz/anchor)
if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
}

// Import wallet adapter CSS
import '@solana/wallet-adapter-react-ui/styles.css';

const ActivityProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const activityState = useActivityFeedState();
  return (
    <ActivityContext.Provider value={activityState}>
      {children}
    </ActivityContext.Provider>
  );
};

export const Providers: FC<{ children: ReactNode }> = ({ children }) => {
  // Use devnet for the hackathon
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(() => clusterApiUrl(network), [network]);

  // Phantom registers itself as a Standard Wallet — no adapter needed.
  // Only add adapters for wallets that don't support the Standard Wallet interface.
  const wallets = useMemo(
    () => [new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <ActivityProvider>
            {children}
          </ActivityProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

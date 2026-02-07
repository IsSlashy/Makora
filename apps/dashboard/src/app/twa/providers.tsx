'use client';

import { FC, ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { ActivityContext, useActivityFeedState } from '@/hooks/useActivityFeed';

// Polyfill Buffer for browser
if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
}

// ─── TWA Wallet Context (read-only, no signing) ────────────────────────────

interface TWAWalletContextType {
  publicKey: PublicKey | null;
  connected: boolean;
  walletAddress: string;
}

const TWAWalletContext = createContext<TWAWalletContextType>({
  publicKey: null,
  connected: false,
  walletAddress: '',
});

export function useTWAWallet() {
  return useContext(TWAWalletContext);
}

// ─── Providers ──────────────────────────────────────────────────────────────

interface TWAProvidersProps {
  children: ReactNode;
  walletAddress: string;
}

const ActivityProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const activityState = useActivityFeedState();
  return (
    <ActivityContext.Provider value={activityState}>
      {children}
    </ActivityContext.Provider>
  );
};

export const TWAProviders: FC<TWAProvidersProps> = ({ children, walletAddress }) => {
  const endpoint = 'https://devnet.helius-rpc.com/?api-key=ad0d91ac-dda3-4906-81ef-37338de04caa';

  const connectionConfig = useMemo(() => ({
    commitment: 'confirmed' as const,
    disableRetryOnRateLimit: true,
  }), []);

  const walletCtx = useMemo<TWAWalletContextType>(() => {
    let publicKey: PublicKey | null = null;
    try {
      if (walletAddress) publicKey = new PublicKey(walletAddress);
    } catch { /* invalid pubkey */ }
    return {
      publicKey,
      connected: publicKey !== null,
      walletAddress,
    };
  }, [walletAddress]);

  // Initialize Telegram WebApp SDK
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor('#050508');
      tg.setBackgroundColor('#050508');
    }
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint} config={connectionConfig}>
      <TWAWalletContext.Provider value={walletCtx}>
        <ActivityProvider>
          {children}
        </ActivityProvider>
      </TWAWalletContext.Provider>
    </ConnectionProvider>
  );
};

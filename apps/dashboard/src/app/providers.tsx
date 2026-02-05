'use client';

import { FC, ReactNode, useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
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

// Throttled fetch middleware: ensures minimum gap between RPC requests
// to avoid triggering 429 rate limits on the public devnet endpoint.
function createThrottledMiddleware(minIntervalMs: number) {
  let nextAllowedTime = 0;

  return (info: Parameters<typeof fetch>[0], init: Parameters<typeof fetch>[1], fetch: (...args: Parameters<typeof globalThis.fetch>) => void) => {
    const now = Date.now();
    const delay = Math.max(0, nextAllowedTime - now);
    nextAllowedTime = Math.max(now, nextAllowedTime) + minIntervalMs;

    if (delay > 0) {
      setTimeout(() => fetch(info, init), delay);
    } else {
      fetch(info, init);
    }
  };
}

const ActivityProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const activityState = useActivityFeedState();
  return (
    <ActivityContext.Provider value={activityState}>
      {children}
    </ActivityContext.Provider>
  );
};

export const Providers: FC<{ children: ReactNode }> = ({ children }) => {
  // HARDCODED: Devnet + Helius RPC for hackathon demo
  const network = WalletAdapterNetwork.Devnet;

  // HARDCODED: Use Helius devnet with user's API key
  const endpoint = 'https://devnet.helius-rpc.com/?api-key=ad0d91ac-dda3-4906-81ef-37338de04caa';

  console.log('[RPC] Using Helius devnet');

  // Disable automatic retry on 429 to prevent infinite cascade,
  // and throttle requests to ~5/sec via fetchMiddleware.
  const connectionConfig = useMemo(() => ({
    commitment: 'confirmed' as const,
    disableRetryOnRateLimit: true,
    fetchMiddleware: createThrottledMiddleware(200),
  }), []);

  // Modern wallets (Phantom, Solflare) register via the Standard Wallet interface.
  // No legacy adapters needed — they auto-detect.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={endpoint} config={connectionConfig}>
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

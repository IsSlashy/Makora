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
  // Read network from env (defaults to mainnet-beta for real execution)
  const networkEnv = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'mainnet-beta';
  const network = networkEnv === 'devnet'
    ? WalletAdapterNetwork.Devnet
    : networkEnv === 'testnet'
      ? WalletAdapterNetwork.Testnet
      : WalletAdapterNetwork.Mainnet;

  const endpoint = useMemo(() => {
    const custom = process.env.NEXT_PUBLIC_RPC_URL;

    // ALWAYS use Helius for devnet - public RPC has 403 rate limits
    const isDevnet = network === WalletAdapterNetwork.Devnet ||
                     networkEnv === 'devnet' ||
                     (custom && custom.includes('devnet'));

    console.log('[RPC Debug]', {
      custom,
      networkEnv,
      network,
      isDevnet,
    });

    if (isDevnet) {
      const heliusUrl = 'https://devnet.helius-rpc.com/?api-key=1d8740dc-e5f4-421c-b823-e1bad1889eff';
      console.log('[RPC] Using Helius devnet:', heliusUrl);
      return heliusUrl;
    }

    // For non-devnet, use custom RPC or default
    if (custom) {
      console.log('[RPC] Using custom:', custom);
      return custom;
    }
    const defaultUrl = clusterApiUrl(network);
    console.log('[RPC] Using default:', defaultUrl);
    return defaultUrl;
  }, [network, networkEnv]);

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

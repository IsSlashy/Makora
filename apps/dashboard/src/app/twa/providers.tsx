'use client';

import { FC, ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ConnectionProvider } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { Buffer } from 'buffer';
import { PrivyProvider } from '@privy-io/react-auth';
import { ActivityContext, useActivityFeedState } from '@/hooks/useActivityFeed';
import { useUser } from '@/hooks/useUser';

// Polyfill Buffer for browser
if (typeof window !== 'undefined') {
  (window as any).Buffer = Buffer;
}

// ─── TWA Wallet Context (now powered by Privy) ────────────────────────────

interface TWAWalletContextType {
  publicKey: PublicKey | null;
  connected: boolean;
  walletAddress: string;
  userId: string | null;
  displayName: string;
  authenticated: boolean;
  loading: boolean;
  login: () => void;
  logout: () => Promise<void>;
}

const TWAWalletContext = createContext<TWAWalletContextType>({
  publicKey: null,
  connected: false,
  walletAddress: '',
  userId: null,
  displayName: '',
  authenticated: false,
  loading: true,
  login: () => {},
  logout: async () => {},
});

export function useTWAWallet() {
  return useContext(TWAWalletContext);
}

// ─── Privy Wallet Bridge ─────────────────────────────────────────────────

const PrivyWalletBridge: FC<{ children: ReactNode }> = ({ children }) => {
  const user = useUser();
  const [timedOut, setTimedOut] = useState(false);

  // If Privy doesn't become ready within 8s, stop showing Loading
  useEffect(() => {
    if (!user.loading) return;
    const timer = setTimeout(() => setTimedOut(true), 8000);
    return () => clearTimeout(timer);
  }, [user.loading]);

  const walletCtx = useMemo<TWAWalletContextType>(() => {
    let publicKey: PublicKey | null = null;
    try {
      if (user.walletAddress) publicKey = new PublicKey(user.walletAddress);
    } catch { /* invalid pubkey */ }
    return {
      publicKey,
      connected: publicKey !== null,
      walletAddress: user.walletAddress,
      userId: user.userId,
      displayName: user.displayName,
      authenticated: user.authenticated,
      loading: timedOut ? false : user.loading,
      login: user.login,
      logout: user.logout,
    };
  }, [user, timedOut]);

  return (
    <TWAWalletContext.Provider value={walletCtx}>
      {children}
    </TWAWalletContext.Provider>
  );
};

// ─── Activity Provider ───────────────────────────────────────────────────

const ActivityProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const activityState = useActivityFeedState();
  return (
    <ActivityContext.Provider value={activityState}>
      {children}
    </ActivityContext.Provider>
  );
};

// ─── Telegram SDK Init ───────────────────────────────────────────────────

const TelegramInit: FC<{ children: ReactNode }> = ({ children }) => {
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (tg) {
      tg.ready();
      tg.expand();
      tg.setHeaderColor('#050508');
      tg.setBackgroundColor('#050508');
    }
  }, []);

  return <>{children}</>;
};

// ─── Main Providers ──────────────────────────────────────────────────────

interface TWAProvidersProps {
  children: ReactNode;
}

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID || '';

export const TWAProviders: FC<TWAProvidersProps> = ({ children }) => {
  const endpoint = process.env.NEXT_PUBLIC_RPC_URL || 'https://devnet.helius-rpc.com/?api-key=ad0d91ac-dda3-4906-81ef-37338de04caa';

  const connectionConfig = useMemo(() => ({
    commitment: 'confirmed' as const,
    disableRetryOnRateLimit: true,
  }), []);

  // If Privy is not configured, fall back to non-Privy mode
  // Set loading: false so the dashboard doesn't get stuck on "Loading..." forever
  if (!PRIVY_APP_ID) {
    return (
      <ConnectionProvider endpoint={endpoint} config={connectionConfig}>
        <TelegramInit>
          <TWAWalletContext.Provider value={{
            publicKey: null,
            connected: false,
            walletAddress: '',
            userId: null,
            displayName: '',
            authenticated: false,
            loading: false,
            login: () => {},
            logout: async () => {},
          }}>
            <ActivityProvider>
              {children}
            </ActivityProvider>
          </TWAWalletContext.Provider>
        </TelegramInit>
      </ConnectionProvider>
    );
  }

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#8b5cf6',
          logo: undefined,
        },
        loginMethods: ['email', 'sms', 'telegram', 'wallet'],
        embeddedWallets: {
          solana: {
            createOnLogin: 'all-users',
          },
        },
      }}
    >
      <ConnectionProvider endpoint={endpoint} config={connectionConfig}>
        <TelegramInit>
          <PrivyWalletBridge>
            <ActivityProvider>
              {children}
            </ActivityProvider>
          </PrivyWalletBridge>
        </TelegramInit>
      </ConnectionProvider>
    </PrivyProvider>
  );
};

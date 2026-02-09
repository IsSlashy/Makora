'use client';

import { usePrivy, useLoginWithTelegram } from '@privy-io/react-auth';
import { useCallback, useMemo } from 'react';

export interface MakoraUser {
  /** Privy user ID (e.g., 'did:privy:...') */
  userId: string | null;
  /** Display name — abbreviated wallet address */
  displayName: string;
  /** Solana wallet address from Privy embedded wallet */
  walletAddress: string;
  /** Whether the user is authenticated */
  authenticated: boolean;
  /** Whether we're still loading auth state */
  loading: boolean;
  /** Privy login function */
  login: () => void;
  /** Privy logout function */
  logout: () => Promise<void>;
}

/** Detect if running inside Telegram WebApp */
function isTelegramWebApp(): boolean {
  if (typeof window === 'undefined') return false;
  const tg = (window as any).Telegram?.WebApp;
  // Check if the TWA SDK is loaded and we have platform info (present even when initData is empty)
  return !!(tg && (tg.platform || tg.initData || tg.version));
}

/**
 * Combines Privy auth + embedded wallet into a single user context.
 * Uses user.linkedAccounts to find the Solana embedded wallet
 * (useWallets() only returns EVM wallets).
 *
 * Inside Telegram WebApp, uses useLoginWithTelegram for seamless
 * auth (no popup needed — uses Telegram initData).
 */
export function useUser(): MakoraUser {
  const { ready, authenticated, user, login: privyLogin, logout } = usePrivy();
  const { login: telegramLogin } = useLoginWithTelegram();

  // In TWA context, use Telegram login (no popup). Otherwise, use generic login.
  const login = useCallback(() => {
    if (isTelegramWebApp()) {
      telegramLogin().catch((err) => {
        console.warn('[useUser] Telegram login failed, falling back to generic:', err);
        privyLogin();
      });
    } else {
      privyLogin();
    }
  }, [telegramLogin, privyLogin]);

  return useMemo(() => {
    // Find the Solana embedded wallet from linkedAccounts
    // useWallets() only returns EVM wallets — Solana wallets are in linkedAccounts
    let walletAddress = '';
    if (user?.linkedAccounts) {
      const solanaWallet = (user.linkedAccounts as any[]).find(
        (a) => a.type === 'wallet' && a.chainType === 'solana' && a.walletClientType === 'privy',
      );
      if (solanaWallet?.address) {
        walletAddress = solanaWallet.address;
      }
    }

    // Display name: always show wallet address abbreviation (not email)
    let displayName = '';
    if (walletAddress) {
      displayName = `${walletAddress.slice(0, 4)}...${walletAddress.slice(-4)}`;
    }

    return {
      userId: user?.id ?? null,
      displayName,
      walletAddress,
      authenticated: authenticated && ready,
      loading: !ready,
      login,
      logout,
    };
  }, [ready, authenticated, user, login, logout]);
}

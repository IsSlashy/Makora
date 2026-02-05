// Mock for @solana/wallet-adapter-react
import { vi } from 'vitest';

export const useConnection = vi.fn(() => ({
  connection: {
    getBalance: vi.fn().mockResolvedValue(5_000_000_000),
    confirmTransaction: vi.fn().mockResolvedValue({}),
    getParsedTokenAccountsByOwner: vi.fn().mockResolvedValue({ value: [] }),
  },
}));

export const useWallet = vi.fn(() => ({
  publicKey: null,
  sendTransaction: vi.fn(),
  connected: false,
}));

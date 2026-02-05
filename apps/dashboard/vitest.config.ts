import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    testTimeout: 15_000,
    setupFiles: [],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@solana/wallet-adapter-react': resolve(
        __dirname,
        'src/hooks/__tests__/__mocks__/wallet-adapter.ts',
      ),
    },
  },
});

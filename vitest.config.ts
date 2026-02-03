import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@makora/types': resolve(__dirname, 'packages/types/src'),
      '@makora/data-feed': resolve(__dirname, 'packages/data-feed/src'),
      '@makora/adapters-jupiter': resolve(__dirname, 'packages/adapters/jupiter/src'),
      '@makora/adapters-marinade': resolve(__dirname, 'packages/adapters/marinade/src'),
      '@makora/adapters-privacy': resolve(__dirname, 'packages/adapters/privacy/src'),
      '@makora/agent-core': resolve(__dirname, 'packages/agent-core/src'),
      '@makora/risk-manager': resolve(__dirname, 'packages/risk-manager/src'),
      '@makora/execution-engine': resolve(__dirname, 'packages/execution-engine/src'),
      '@makora/protocol-router': resolve(__dirname, 'packages/protocol-router/src'),
      '@makora/privacy': resolve(__dirname, 'packages/privacy/src'),
      '@makora/strategy-engine': resolve(__dirname, 'packages/strategy-engine/src'),
    },
  },
});

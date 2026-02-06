import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: false,
  clean: true,
  external: [
    '@makora/types',
    '@makora/data-feed',
    '@makora/strategy-engine',
    '@makora/risk-manager',
    '@makora/execution-engine',
    '@makora/protocol-router',
    '@makora/session-manager',
    '@solana/web3.js',
    'crypto',
  ],
});

import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: false,
  clean: true,
  external: [
    '@makora/types',
    '@solana/web3.js',
    '@coral-xyz/anchor',
    'crypto',
  ],
});

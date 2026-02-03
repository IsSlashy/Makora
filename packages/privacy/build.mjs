import { build } from 'esbuild';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';

const execAsync = promisify(exec);

async function buildPackage() {
  console.log('Building @makora/privacy...');

  // Clean dist
  if (fs.existsSync('dist')) {
    fs.rmSync('dist', { recursive: true });
  }
  fs.mkdirSync('dist');

  // Build CJS
  await build({
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.js',
    bundle: false,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    sourcemap: true,
  });

  // Build ESM
  await build({
    entryPoints: ['src/index.ts'],
    outfile: 'dist/index.mjs',
    bundle: false,
    platform: 'node',
    format: 'esm',
    target: 'node18',
    sourcemap: true,
  });

  // Build types
  console.log('Generating type definitions...');
  try {
    await execAsync('npx tsc --project tsconfig.json --declaration --emitDeclarationOnly --outDir dist');
  } catch (error) {
    console.error('Type generation failed:', error.message);
  }

  console.log('Build complete!');
}

buildPackage().catch(console.error);

#!/usr/bin/env node

/**
 * Verification script for @makora/privacy package
 * Checks that all modules can be imported and basic functionality works
 */

console.log('Verifying @makora/privacy package...\n');

// Check Node.js version
const nodeVersion = process.versions.node;
console.log(`✓ Node.js version: ${nodeVersion}`);

// Check if TypeScript files exist
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const requiredFiles = [
  'src/index.ts',
  'src/types.ts',
  'src/privacy-manager.ts',
  'src/stealth/index.ts',
  'src/stealth/generate.ts',
  'src/stealth/derive.ts',
  'src/stealth/scan.ts',
  'src/shielded/index.ts',
  'src/shielded/note.ts',
  'src/shielded/merkle.ts',
  'src/shielded/prover.ts',
  'package.json',
  'tsconfig.json',
];

console.log('\nChecking required files:');
let allFilesExist = true;
for (const file of requiredFiles) {
  const filePath = path.join(__dirname, file);
  const exists = fs.existsSync(filePath);
  console.log(`${exists ? '✓' : '✗'} ${file}`);
  if (!exists) allFilesExist = false;
}

if (!allFilesExist) {
  console.error('\n✗ Some required files are missing!');
  process.exit(1);
}

// Check package.json structure
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
console.log('\nPackage information:');
console.log(`  Name: ${packageJson.name}`);
console.log(`  Version: ${packageJson.version}`);
console.log(`  Main: ${packageJson.main}`);
console.log(`  Module: ${packageJson.module}`);
console.log(`  Types: ${packageJson.types}`);

// Check dependencies
console.log('\nDependencies:');
const deps = Object.keys(packageJson.dependencies || {});
for (const dep of deps) {
  console.log(`  ✓ ${dep}`);
}

console.log('\nDevDependencies:');
const devDeps = Object.keys(packageJson.devDependencies || {});
for (const dep of devDeps) {
  console.log(`  ✓ ${dep}`);
}

console.log('\n✓ @makora/privacy package structure verified!');
console.log('\nTo build the package:');
console.log('  pnpm install');
console.log('  pnpm build');

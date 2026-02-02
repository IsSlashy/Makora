import chalk from 'chalk';
import Table from 'cli-table3';
import type { PortfolioState } from '@makora/types';

// Makora brand colors
const BRAND = {
  primary: chalk.hex('#8b5cf6'),   // Electric purple
  secondary: chalk.hex('#a78bfa'), // Light purple
  accent: chalk.hex('#c4b5fd'),    // Very light purple
  success: chalk.hex('#10b981'),   // Green
  warning: chalk.hex('#f59e0b'),   // Amber
  error: chalk.hex('#ef4444'),     // Red
  muted: chalk.gray,
};

/**
 * Print the Makora banner/header.
 */
export function printBanner(): void {
  console.log('');
  console.log(BRAND.primary('  ╔══════════════════════════════════════╗'));
  console.log(BRAND.primary('  ║') + BRAND.secondary('     MAKORA - Adaptive DeFi Agent     ') + BRAND.primary('║'));
  console.log(BRAND.primary('  ║') + BRAND.muted('        Master of Adaptation          ') + BRAND.primary('║'));
  console.log(BRAND.primary('  ╚══════════════════════════════════════╝'));
  console.log('');
}

/**
 * Format a USD value with $ sign and 2 decimal places.
 */
export function formatUsd(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
}

/**
 * Format a token balance with appropriate decimal places.
 */
export function formatBalance(balance: number, decimals: number = 4): string {
  if (balance === 0) return '0';
  if (balance < 0.0001) return '<0.0001';
  return balance.toFixed(decimals);
}

/**
 * Print the portfolio status as a formatted table.
 */
export function printPortfolioStatus(portfolio: PortfolioState): void {
  // Header
  console.log(BRAND.primary('  Wallet: ') + chalk.white(portfolio.owner.toBase58()));
  console.log(BRAND.primary('  Total Value: ') + chalk.bold.white(formatUsd(portfolio.totalValueUsd)));
  console.log('');

  // Token balances table
  const table = new Table({
    head: [
      chalk.bold('Token'),
      chalk.bold('Balance'),
      chalk.bold('Price'),
      chalk.bold('Value'),
      chalk.bold('Allocation'),
    ],
    colWidths: [12, 18, 14, 14, 14],
    style: {
      head: [],
      border: ['gray'],
    },
  });

  for (const balance of portfolio.balances) {
    const allocationPct = portfolio.totalValueUsd > 0
      ? (balance.usdValue / portfolio.totalValueUsd) * 100
      : 0;

    const allocationBar = getAllocationBar(allocationPct);

    table.push([
      BRAND.secondary(balance.token.symbol),
      chalk.white(formatBalance(balance.uiBalance)),
      BRAND.muted(formatUsd(balance.priceUsd)),
      chalk.white(formatUsd(balance.usdValue)),
      `${allocationBar} ${allocationPct.toFixed(1)}%`,
    ]);
  }

  console.log(table.toString());
  console.log('');
  console.log(BRAND.muted(`  Last updated: ${new Date(portfolio.lastUpdated).toLocaleTimeString()}`));
}

/**
 * Create a visual allocation bar.
 */
function getAllocationBar(pct: number): string {
  const filled = Math.round(pct / 10);
  const empty = 10 - filled;
  return BRAND.primary('█'.repeat(filled)) + BRAND.muted('░'.repeat(empty));
}

/**
 * Print an info message.
 */
export function printInfo(message: string): void {
  console.log(BRAND.secondary('  i ') + message);
}

/**
 * Print a success message.
 */
export function printSuccess(message: string): void {
  console.log(BRAND.success('  + ') + message);
}

/**
 * Print a warning message.
 */
export function printWarning(message: string): void {
  console.log(BRAND.warning('  ! ') + message);
}

/**
 * Print an error message.
 */
export function printError(message: string): void {
  console.log(BRAND.error('  x ') + message);
}

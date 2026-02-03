import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { createConnection, getRpcDisplayUrl, type ConnectionConfig } from '@makora/data-feed';
import { loadConfig } from '../utils/config.js';
import { loadWalletFromFile } from '../utils/wallet.js';
import {
  printBanner,
  printInfo,
  printError,
  printSuccess,
  printWarning,
  printTable,
  printConfirmation,
  formatUsd,
} from '../utils/display.js';

interface SwapQuote {
  inputAmount: number;
  inputToken: string;
  outputAmount: number;
  outputToken: string;
  priceImpact: number;
  route: string[];
  estimatedFee: number;
}

/**
 * Generate a mock swap quote (for demo purposes).
 */
function generateSwapQuote(amount: number, from: string, to: string, slippage: number): SwapQuote {
  // Mock exchange rates
  const rates: Record<string, number> = {
    'SOL': 245.30,
    'USDC': 1.0,
    'USDT': 1.0,
    'JUP': 1.15,
    'BONK': 0.00003,
    'RAY': 2.85,
  };

  const fromPrice = rates[from.toUpperCase()] || 1;
  const toPrice = rates[to.toUpperCase()] || 1;

  const baseOutput = (amount * fromPrice) / toPrice;
  const priceImpact = amount > 100 ? 0.8 : amount > 10 ? 0.3 : 0.1;
  const outputAmount = baseOutput * (1 - priceImpact / 100);

  // Mock routes
  const routes: Record<string, string[]> = {
    'SOL-USDC': ['SOL', 'USDC'],
    'SOL-USDT': ['SOL', 'USDC', 'USDT'],
    'USDC-SOL': ['USDC', 'SOL'],
    'USDC-USDT': ['USDC', 'USDT'],
  };

  const routeKey = `${from.toUpperCase()}-${to.toUpperCase()}`;
  const route = routes[routeKey] || [from.toUpperCase(), to.toUpperCase()];

  return {
    inputAmount: amount,
    inputToken: from.toUpperCase(),
    outputAmount: outputAmount,
    outputToken: to.toUpperCase(),
    priceImpact,
    route,
    estimatedFee: 0.000005,
  };
}

/**
 * Register the `makora swap` command.
 */
export function registerSwapCommand(program: Command): void {
  program
    .command('swap <amount> <from> <to>')
    .description('Swap tokens via Jupiter aggregator')
    .option('--slippage <bps>', 'Maximum slippage in basis points (default: 50)', '50')
    .option('--execute', 'Skip confirmation and execute immediately')
    .option('--wallet <path>', 'Path to wallet keypair JSON file')
    .option('--rpc <url>', 'Custom RPC endpoint URL')
    .option('--cluster <cluster>', 'Solana cluster: devnet, mainnet-beta, localnet', 'devnet')
    .action(async (amountStr: string, from: string, to: string, options) => {
      printBanner();

      const amount = parseFloat(amountStr);
      if (isNaN(amount) || amount <= 0) {
        printError('Invalid amount. Please provide a positive number.');
        process.exit(1);
      }

      const slippage = parseInt(options.slippage, 10);
      if (isNaN(slippage) || slippage < 0) {
        printError('Invalid slippage. Please provide a positive number in basis points.');
        process.exit(1);
      }

      const config = loadConfig();

      // Override config with CLI options
      if (options.rpc) config.rpcUrl = options.rpc;
      if (options.wallet) config.walletPath = options.wallet;
      if (options.cluster) config.cluster = options.cluster;

      // Load wallet
      const spinner = ora({ text: 'Loading wallet...', color: 'magenta' }).start();
      let wallet;
      try {
        wallet = loadWalletFromFile(config.walletPath);
        spinner.succeed(`Wallet loaded: ${wallet.publicKey.toBase58().slice(0, 8)}...${wallet.publicKey.toBase58().slice(-4)}`);
      } catch (err) {
        spinner.fail('Failed to load wallet');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      // Connect to Solana
      const connectionConfig: ConnectionConfig = {
        cluster: config.cluster,
        heliusApiKey: process.env.HELIUS_API_KEY,
        customRpcUrl: options.rpc,
      };

      const rpcDisplay = getRpcDisplayUrl(connectionConfig);
      const connectSpinner = ora({ text: `Connecting to ${config.cluster}...`, color: 'magenta' }).start();

      try {
        const connection = createConnection(connectionConfig);
        await connection.getSlot();
        connectSpinner.succeed(`Connected to ${config.cluster}`);
      } catch (err) {
        connectSpinner.fail(`Failed to connect to ${config.cluster}`);
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      // Generate quote
      const quoteSpinner = ora({ text: 'Fetching best swap route from Jupiter...', color: 'magenta' }).start();
      await new Promise(resolve => setTimeout(resolve, 800)); // Mock delay
      const quote = generateSwapQuote(amount, from, to, slippage);
      quoteSpinner.succeed('Quote received');

      console.log('');
      printInfo(`Swap ${chalk.white(quote.inputAmount)} ${chalk.cyan(quote.inputToken)} → ${chalk.white(`~${quote.outputAmount.toFixed(4)}`)} ${chalk.cyan(quote.outputToken)} via Jupiter`);
      console.log('');

      // Display quote details
      const quoteTable = [
        ['Input', `${quote.inputAmount} ${quote.inputToken}`],
        ['Expected Output', `~${quote.outputAmount.toFixed(4)} ${quote.outputToken}`],
        ['Price Impact', `${quote.priceImpact.toFixed(2)}%`],
        ['Route', quote.route.join(' → ')],
        ['Network Fee', `~${quote.estimatedFee} SOL`],
        ['Max Slippage', `${slippage / 100}%`],
      ];

      printTable(
        ['Detail', 'Value'],
        quoteTable
      );

      console.log('');

      // Risk assessment
      if (quote.priceImpact > 1) {
        printWarning(`High price impact (${quote.priceImpact.toFixed(2)}%). Consider splitting the swap.`);
      } else {
        printSuccess(`Low price impact (${quote.priceImpact.toFixed(2)}%). Good swap conditions.`);
      }

      console.log('');

      // Confirmation
      if (!options.execute) {
        const confirmed = await printConfirmation('Execute this swap?');
        if (!confirmed) {
          printWarning('Swap cancelled');
          process.exit(0);
        }
      }

      // Execute
      const execSpinner = ora({ text: 'Submitting transaction...', color: 'magenta' }).start();
      await new Promise(resolve => setTimeout(resolve, 1500)); // Mock execution time

      // Mock transaction signature
      const mockTxSig = `${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
      execSpinner.succeed('Transaction confirmed');

      console.log('');
      printSuccess(`Swap executed successfully!`);
      printInfo(`Transaction: ${chalk.white(mockTxSig)}`);
      printInfo(`Explorer: ${chalk.white(`https://explorer.solana.com/tx/${mockTxSig}?cluster=${config.cluster}`)}`);
      console.log('');
      printInfo(`New balance: ${chalk.white((quote.outputAmount).toFixed(4))} ${chalk.cyan(quote.outputToken)}`);
      console.log('');
    });
}

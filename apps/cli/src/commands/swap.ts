import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { createConnection, getRpcDisplayUrl, type ConnectionConfig, findTokenBySymbol, NATIVE_SOL_MINT } from '@makora/data-feed';
import { JupiterAdapter } from '@makora/adapters-jupiter';
import { ExecutionEngine } from '@makora/execution-engine';
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

/**
 * Register the `makora swap` command.
 *
 * Wired to REAL Jupiter aggregator for optimal swap routing on devnet/mainnet.
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

      let connection;
      try {
        connection = createConnection(connectionConfig);
        await connection.getSlot();
        connectSpinner.succeed(`Connected to ${config.cluster}`);
      } catch (err) {
        connectSpinner.fail(`Failed to connect to ${config.cluster}`);
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      // Resolve token mints
      const fromToken = findTokenBySymbol(from.toUpperCase(), config.cluster);
      const toToken = findTokenBySymbol(to.toUpperCase(), config.cluster);

      if (!fromToken) {
        printError(`Unknown token: ${from.toUpperCase()}. Supported: SOL, USDC, USDT, mSOL, JUP, BONK, RAY`);
        process.exit(1);
      }
      if (!toToken) {
        printError(`Unknown token: ${to.toUpperCase()}. Supported: SOL, USDC, USDT, mSOL, JUP, BONK, RAY`);
        process.exit(1);
      }

      // Initialize Jupiter adapter
      const jupiterSpinner = ora({ text: 'Initializing Jupiter aggregator...', color: 'magenta' }).start();
      const jupiter = new JupiterAdapter();
      try {
        await jupiter.initialize({
          rpcUrl: config.rpcUrl,
          walletPublicKey: wallet.publicKey,
        });
        jupiterSpinner.succeed('Jupiter connected');
      } catch (err) {
        jupiterSpinner.fail('Failed to initialize Jupiter');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      // Calculate raw amount (convert to smallest unit)
      const rawAmount = BigInt(Math.floor(amount * 10 ** fromToken.decimals));

      // Fetch real quote from Jupiter
      const quoteSpinner = ora({ text: 'Fetching best swap route from Jupiter...', color: 'magenta' }).start();
      let quote;
      try {
        quote = await jupiter.getQuote({
          inputToken: fromToken.mint,
          outputToken: toToken.mint,
          amount: rawAmount,
          maxSlippageBps: slippage,
        });
        quoteSpinner.succeed('Quote received from Jupiter');
      } catch (err) {
        quoteSpinner.fail('Failed to get Jupiter quote');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      // Display quote
      const expectedOutput = Number(quote.expectedOutputAmount) / 10 ** toToken.decimals;
      const minOutput = Number(quote.minimumOutputAmount) / 10 ** toToken.decimals;

      console.log('');
      printInfo(`Swap ${chalk.white(amount)} ${chalk.cyan(fromToken.symbol)} -> ${chalk.white(`~${expectedOutput.toFixed(4)}`)} ${chalk.cyan(toToken.symbol)} via Jupiter`);
      console.log('');

      const quoteTable = [
        ['Input', `${amount} ${fromToken.symbol}`],
        ['Expected Output', `~${expectedOutput.toFixed(4)} ${toToken.symbol}`],
        ['Minimum Output', `${minOutput.toFixed(4)} ${toToken.symbol}`],
        ['Price Impact', `${quote.priceImpactPct.toFixed(4)}%`],
        ['Route', quote.routeDescription],
        ['Max Slippage', `${slippage / 100}%`],
      ];

      printTable(['Detail', 'Value'], quoteTable);
      console.log('');

      // Risk assessment based on real quote
      if (quote.priceImpactPct > 1) {
        printWarning(`High price impact (${quote.priceImpactPct.toFixed(2)}%). Consider splitting the swap.`);
      } else {
        printSuccess(`Low price impact (${quote.priceImpactPct.toFixed(4)}%). Good swap conditions.`);
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

      // Execute via real Jupiter swap transaction + execution engine
      const execSpinner = ora({ text: 'Building and submitting transaction...', color: 'magenta' }).start();
      try {
        const { transaction, quote: swapQuote } = await jupiter.getSwapTransaction({
          inputToken: fromToken.mint,
          outputToken: toToken.mint,
          amount: rawAmount,
          maxSlippageBps: slippage,
          userPublicKey: wallet.publicKey,
        });

        const engine = new ExecutionEngine(connection);
        const result = await engine.execute({
          instructions: [],
          preBuiltTransaction: transaction,
          signer: wallet,
          description: `Swap ${amount} ${fromToken.symbol} -> ${toToken.symbol} via Jupiter`,
        });

        if (result.success && result.signature) {
          execSpinner.succeed('Transaction confirmed');
          console.log('');
          printSuccess('Swap executed successfully!');
          printInfo(`Transaction: ${chalk.white(result.signature)}`);
          printInfo(`Explorer: ${chalk.white(`https://explorer.solana.com/tx/${result.signature}?cluster=${config.cluster}`)}`);
          if (result.slot) {
            printInfo(`Confirmed at slot: ${chalk.white(result.slot)}`);
          }
        } else {
          execSpinner.fail('Transaction failed');
          printError(result.error || 'Unknown error');
        }
      } catch (err) {
        execSpinner.fail('Transaction failed');
        printError(err instanceof Error ? err.message : String(err));
      }

      console.log('');
    });
}

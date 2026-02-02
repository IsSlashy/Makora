import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { createConnection, getRpcDisplayUrl, PortfolioReader, type ConnectionConfig } from '@makora/data-feed';
import { loadConfig } from '../utils/config.js';
import { loadWalletFromFile } from '../utils/wallet.js';
import {
  printBanner,
  printPortfolioStatus,
  printInfo,
  printError,
  printWarning,
} from '../utils/display.js';

/**
 * Register the `makora status` command.
 *
 * Connects to Solana devnet (via Helius or public RPC),
 * reads the wallet's SOL and SPL token balances,
 * fetches USD prices from Jupiter Price API,
 * and displays a formatted portfolio view.
 */
export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('Show wallet balance, token holdings, and portfolio value')
    .option('--rpc <url>', 'Custom RPC endpoint URL')
    .option('--wallet <path>', 'Path to wallet keypair JSON file')
    .option('--cluster <cluster>', 'Solana cluster: devnet, mainnet-beta, localnet', 'devnet')
    .action(async (options) => {
      printBanner();

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
      const connectSpinner = ora({ text: `Connecting to ${config.cluster} (${rpcDisplay})...`, color: 'magenta' }).start();

      try {
        const connection = createConnection(connectionConfig);

        // Quick health check: get slot
        const slot = await connection.getSlot();
        connectSpinner.succeed(`Connected to ${config.cluster} (slot: ${slot})`);
      } catch (err) {
        connectSpinner.fail(`Failed to connect to ${config.cluster}`);
        printError(err instanceof Error ? err.message : String(err));

        // Try fallback
        if (config.rpcFallback) {
          printWarning(`Trying fallback RPC: ${config.rpcFallback}`);
          connectionConfig.customRpcUrl = config.rpcFallback;
        } else {
          process.exit(1);
        }
      }

      const connection = createConnection(connectionConfig);

      // Fetch portfolio
      const portfolioSpinner = ora({ text: 'Fetching portfolio data...', color: 'magenta' }).start();
      try {
        const reader = new PortfolioReader(connection, config.cluster);
        const portfolio = await reader.getPortfolio(wallet.publicKey);
        portfolioSpinner.succeed('Portfolio data loaded');

        console.log('');
        printPortfolioStatus(portfolio);

        // Network info
        console.log('');
        printInfo(`Network: ${chalk.white(config.cluster)}`);
        printInfo(`RPC: ${chalk.white(rpcDisplay)}`);
        printInfo(`Mode: ${chalk.white(config.mode)}`);

      } catch (err) {
        portfolioSpinner.fail('Failed to fetch portfolio');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }
    });
}

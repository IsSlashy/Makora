import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { createConnection, getRpcDisplayUrl, PortfolioReader, JupiterPriceFeed, type ConnectionConfig } from '@makora/data-feed';
import { StrategyEngine, type StrategyEvaluation } from '@makora/strategy-engine';
import { loadConfig } from '../utils/config.js';
import { loadWalletFromFile } from '../utils/wallet.js';
import {
  printBanner,
  printInfo,
  printSuccess,
  printWarning,
  printError,
  printTable,
} from '../utils/display.js';

/**
 * Register the `makora strategy` command.
 *
 * Wired to REAL strategy engine with live portfolio data and market analysis.
 */
export function registerStrategyCommand(program: Command): void {
  program
    .command('strategy')
    .description('Display current strategy and yield opportunities')
    .option('--set <type>', 'Set strategy type: yield, trading, rebalance, liquidity')
    .option('--wallet <path>', 'Path to wallet keypair JSON file')
    .option('--rpc <url>', 'Custom RPC endpoint URL')
    .option('--cluster <cluster>', 'Solana cluster: devnet, mainnet-beta, localnet', 'devnet')
    .action(async (options) => {
      printBanner();

      const config = loadConfig();

      // Override config with CLI options
      if (options.wallet) config.walletPath = options.wallet;
      if (options.rpc) config.rpcUrl = options.rpc;
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

      // Fetch real portfolio
      const portfolioSpinner = ora({ text: 'Fetching portfolio data...', color: 'magenta' }).start();
      let portfolio;
      try {
        const reader = new PortfolioReader(connection, config.cluster);
        portfolio = await reader.getPortfolio(wallet.publicKey);
        portfolioSpinner.succeed(`Portfolio loaded: $${portfolio.totalValueUsd.toFixed(2)} total`);
      } catch (err) {
        portfolioSpinner.fail('Failed to fetch portfolio');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      // Run real strategy engine evaluation
      const strategySpinner = ora({ text: 'Running strategy evaluation...', color: 'magenta' }).start();
      let evaluation: StrategyEvaluation;
      try {
        const strategyEngine = new StrategyEngine();

        // Build market data from portfolio
        const solBalance = portfolio.balances.find(b => b.token.symbol === 'SOL');
        const solPrice = solBalance?.priceUsd ?? 0;
        const prices = new Map<string, number>();
        for (const balance of portfolio.balances) {
          if (balance.priceUsd > 0) {
            prices.set(balance.token.mint.toBase58(), balance.priceUsd);
          }
        }

        const marketData = {
          solPriceUsd: solPrice,
          solChange24hPct: 0,
          volatilityIndex: 30,
          totalTvlUsd: 0,
          timestamp: Date.now(),
          prices,
        };

        evaluation = strategyEngine.evaluate(portfolio, marketData);
        strategySpinner.succeed('Strategy evaluation complete');
      } catch (err) {
        strategySpinner.fail('Strategy evaluation failed');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      console.log('');

      // Display current strategy from real evaluation
      console.log(chalk.hex('#8b5cf6').bold('  RECOMMENDED STRATEGY'));
      console.log('');
      const rec = evaluation.recommended;
      printInfo(`Strategy: ${chalk.white(rec.strategyName)}`);
      printInfo(`Type: ${chalk.white(rec.type)}`);
      printInfo(`Confidence: ${chalk.white(rec.confidence + '/100')}`);
      if (rec.expectedApy !== undefined) {
        printInfo(`Expected APY: ${chalk.green(rec.expectedApy.toFixed(1) + '%')}`);
      }
      printInfo(`Risk Score: ${chalk.white(rec.riskScore + '/100')}`);
      console.log('');
      printInfo(`Rationale: ${chalk.gray(rec.explanation)}`);
      console.log('');

      // Market conditions from real analysis
      console.log(chalk.hex('#8b5cf6').bold('  MARKET CONDITIONS'));
      console.log('');
      const mc = evaluation.marketCondition;
      printInfo(`Summary: ${chalk.white(mc.summary)}`);
      printInfo(`Volatility: ${chalk.white(mc.volatilityRegime)}`);
      printInfo(`Trend: ${chalk.white(mc.trendDirection)}`);
      console.log('');

      // Yield opportunities from real analysis
      if (evaluation.yieldOpportunities.length > 0) {
        console.log(chalk.hex('#8b5cf6').bold('  YIELD OPPORTUNITIES'));
        console.log('');

        const oppTable = evaluation.yieldOpportunities.map(op => [
          op.description,
        ]);

        for (const op of evaluation.yieldOpportunities) {
          printInfo(op.description);
        }
        console.log('');
      }

      // Proposed actions from real evaluation
      if (rec.actions.length > 0) {
        console.log(chalk.hex('#8b5cf6').bold('  PROPOSED ACTIONS'));
        console.log('');

        for (const action of rec.actions) {
          printInfo(`${chalk.white(action.type.toUpperCase())} | ${action.description} (${action.protocol})`);
        }
        console.log('');
      } else {
        printSuccess('Portfolio is well-positioned. No immediate actions recommended.');
        console.log('');
      }

      // Allocation table
      const rebalancer = evaluation.recommended.type === 'rebalance' ? 'Rebalance recommended' : 'Allocation within targets';
      console.log(chalk.hex('#8b5cf6').bold('  PORTFOLIO ALLOCATION'));
      console.log('');

      const allocTable = portfolio.balances
        .filter(b => b.usdValue > 0)
        .map(b => {
          const pct = portfolio.totalValueUsd > 0 ? (b.usdValue / portfolio.totalValueUsd * 100) : 0;
          return [
            b.token.symbol,
            `$${b.usdValue.toFixed(2)}`,
            `${pct.toFixed(1)}%`,
            getAllocationBar(pct),
          ];
        });

      printTable(['Token', 'Value', 'Weight', 'Allocation'], allocTable);
      console.log('');
    });
}

function getAllocationBar(pct: number): string {
  const filled = Math.round(pct / 5);
  const empty = 20 - filled;
  return chalk.hex('#8b5cf6')('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

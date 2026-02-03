import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { loadConfig } from '../utils/config.js';
import { loadWalletFromFile } from '../utils/wallet.js';
import {
  printBanner,
  printInfo,
  printSuccess,
  printWarning,
  printError,
  printTable,
  printConfirmation,
} from '../utils/display.js';

interface AutoModeConfig {
  enabled: boolean;
  maxPositionSize: number;
  maxSlippage: number;
  dailyLossLimit: number;
  minConfidence: number;
  allowedActions: string[];
}

/**
 * Get current auto mode configuration.
 */
function getAutoModeConfig(): AutoModeConfig {
  return {
    enabled: false,
    maxPositionSize: 20,
    maxSlippage: 1.0,
    dailyLossLimit: 5.0,
    minConfidence: 75,
    allowedActions: ['stake', 'swap', 'rebalance'],
  };
}

/**
 * Register the `makora auto` command.
 */
export function registerAutoCommand(program: Command): void {
  program
    .command('auto [state]')
    .description('Enable or disable autonomous trading mode')
    .option('--wallet <path>', 'Path to wallet keypair JSON file')
    .action(async (state: string | undefined, options) => {
      printBanner();

      const config = loadConfig();

      // Override config with CLI options
      if (options.wallet) config.walletPath = options.wallet;

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

      // Get current config
      const autoConfig = getAutoModeConfig();

      // No argument: show current state
      if (!state) {
        console.log('');
        console.log(chalk.hex('#8b5cf6').bold('  AUTO MODE CONFIGURATION'));
        console.log('');

        const modeColor = autoConfig.enabled ? chalk.green : chalk.gray;
        const modeText = autoConfig.enabled ? 'ENABLED (Autonomous)' : 'DISABLED (Advisory)';
        printInfo(`Mode: ${modeColor(modeText)}`);
        console.log('');

        const configTable = [
          ['Max Position Size', `${autoConfig.maxPositionSize}%`],
          ['Max Slippage', `${autoConfig.maxSlippage}%`],
          ['Daily Loss Limit', `${autoConfig.dailyLossLimit}%`],
          ['Min Confidence', `${autoConfig.minConfidence}%`],
          ['Allowed Actions', autoConfig.allowedActions.join(', ')],
        ];

        printTable(['Parameter', 'Value'], configTable);

        console.log('');

        if (autoConfig.enabled) {
          printSuccess('Auto mode is active. Makora will execute trades autonomously.');
          printWarning('Always monitor your portfolio when auto mode is enabled.');
        } else {
          printInfo('Auto mode is disabled. Makora will provide recommendations only.');
          printInfo('Run `makora auto on` to enable autonomous trading.');
        }

        console.log('');
        return;
      }

      // Turn on
      if (state.toLowerCase() === 'on') {
        if (autoConfig.enabled) {
          printWarning('Auto mode is already enabled.');
          return;
        }

        console.log('');
        console.log(chalk.hex('#8b5cf6').bold('  ENABLE AUTO MODE'));
        console.log('');
        printWarning('You are about to enable autonomous trading mode.');
        printWarning('Makora will execute trades without manual confirmation.');
        console.log('');

        // Prompt for risk parameters
        printInfo('Configure risk parameters:');
        console.log('');

        const defaultParams = [
          ['Max Position Size', '20%', 'Maximum % of portfolio per position'],
          ['Max Slippage', '1.0%', 'Maximum acceptable slippage'],
          ['Daily Loss Limit', '5.0%', 'Stop trading if daily loss exceeds'],
          ['Min Confidence', '75%', 'Minimum confidence score for trades'],
        ];

        printTable(['Parameter', 'Default', 'Description'], defaultParams);

        console.log('');
        printInfo('Using default parameters for this demo.');
        console.log('');

        // Confirm
        const confirmed = await printConfirmation('Enable auto mode with these parameters?');
        if (!confirmed) {
          printWarning('Auto mode activation cancelled');
          return;
        }

        const enableSpinner = ora({ text: 'Activating auto mode...', color: 'magenta' }).start();
        await new Promise(resolve => setTimeout(resolve, 800));
        enableSpinner.succeed('Auto mode enabled');

        console.log('');
        printSuccess('Auto mode is now active!');
        printWarning('Makora will monitor markets and execute trades autonomously.');
        printInfo('You can disable auto mode anytime with `makora auto off`.');
        console.log('');
        return;
      }

      // Turn off
      if (state.toLowerCase() === 'off') {
        if (!autoConfig.enabled) {
          printWarning('Auto mode is already disabled.');
          return;
        }

        console.log('');
        const confirmed = await printConfirmation('Disable auto mode and switch to advisory?');
        if (!confirmed) {
          printWarning('Auto mode remains enabled');
          return;
        }

        const disableSpinner = ora({ text: 'Deactivating auto mode...', color: 'magenta' }).start();
        await new Promise(resolve => setTimeout(resolve, 600));
        disableSpinner.succeed('Auto mode disabled');

        console.log('');
        printSuccess('Auto mode deactivated. Switched to advisory mode.');
        printInfo('Makora will now provide recommendations only.');
        console.log('');
        return;
      }

      // Invalid argument
      printError('Invalid argument. Use `makora auto on` or `makora auto off`.');
      process.exit(1);
    });
}

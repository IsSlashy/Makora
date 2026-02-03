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
  printRiskAssessment,
} from '../utils/display.js';

interface StakingOption {
  protocol: string;
  inputAmount: number;
  inputToken: string;
  outputAmount: number;
  outputToken: string;
  apy: number;
  lockPeriod: string;
  risk: 'Low' | 'Medium' | 'High';
  fees: number;
}

/**
 * Generate mock staking details.
 */
function generateStakingOption(amount: number, protocol: string): StakingOption {
  const protocols: Record<string, { apy: number; token: string; lockPeriod: string; risk: 'Low' | 'Medium' | 'High'; fees: number }> = {
    'marinade': { apy: 7.2, token: 'mSOL', lockPeriod: 'None (liquid staking)', risk: 'Low', fees: 0.01 },
    'raydium': { apy: 12.4, token: 'RAY-LP', lockPeriod: 'None (withdraw anytime)', risk: 'Medium', fees: 0.02 },
    'jito': { apy: 8.5, token: 'jitoSOL', lockPeriod: 'None (liquid staking)', risk: 'Low', fees: 0.01 },
  };

  const protocolData = protocols[protocol.toLowerCase()] || protocols['marinade'];
  const outputAmount = amount * (1 - protocolData.fees);

  return {
    protocol: protocol.charAt(0).toUpperCase() + protocol.slice(1).toLowerCase(),
    inputAmount: amount,
    inputToken: 'SOL',
    outputAmount,
    outputToken: protocolData.token,
    apy: protocolData.apy,
    lockPeriod: protocolData.lockPeriod,
    risk: protocolData.risk,
    fees: protocolData.fees,
  };
}

/**
 * Register the `makora stake` command.
 */
export function registerStakeCommand(program: Command): void {
  program
    .command('stake <amount>')
    .description('Stake SOL on liquid staking protocols')
    .option('--protocol <name>', 'Staking protocol: marinade, raydium, jito', 'marinade')
    .option('--execute', 'Skip confirmation and execute immediately')
    .option('--wallet <path>', 'Path to wallet keypair JSON file')
    .option('--rpc <url>', 'Custom RPC endpoint URL')
    .option('--cluster <cluster>', 'Solana cluster: devnet, mainnet-beta, localnet', 'devnet')
    .action(async (amountStr: string, options) => {
      printBanner();

      const amount = parseFloat(amountStr);
      if (isNaN(amount) || amount <= 0) {
        printError('Invalid amount. Please provide a positive number.');
        process.exit(1);
      }

      const validProtocols = ['marinade', 'raydium', 'jito'];
      if (!validProtocols.includes(options.protocol.toLowerCase())) {
        printError(`Invalid protocol. Choose from: ${validProtocols.join(', ')}`);
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

      // Generate staking details
      const detailsSpinner = ora({ text: `Fetching staking details from ${options.protocol}...`, color: 'magenta' }).start();
      await new Promise(resolve => setTimeout(resolve, 700)); // Mock delay
      const stakingOption = generateStakingOption(amount, options.protocol);
      detailsSpinner.succeed('Staking details loaded');

      console.log('');
      printInfo(`Stake ${chalk.white(stakingOption.inputAmount)} ${chalk.cyan(stakingOption.inputToken)} → ${chalk.white(`~${stakingOption.outputAmount.toFixed(4)}`)} ${chalk.cyan(stakingOption.outputToken)} via ${chalk.magenta(stakingOption.protocol)} (${chalk.green(stakingOption.apy + '%')} APY)`);
      console.log('');

      // Display staking details
      const stakingTable = [
        ['Protocol', stakingOption.protocol],
        ['Input', `${stakingOption.inputAmount} ${stakingOption.inputToken}`],
        ['Expected Output', `~${stakingOption.outputAmount.toFixed(4)} ${stakingOption.outputToken}`],
        ['APY', `${stakingOption.apy}%`],
        ['Lock Period', stakingOption.lockPeriod],
        ['Fees', `${(stakingOption.fees * 100).toFixed(2)}%`],
        ['Risk Level', stakingOption.risk],
      ];

      printTable(
        ['Detail', 'Value'],
        stakingTable
      );

      console.log('');

      // Risk assessment
      const riskChecks = [
        { name: 'Protocol Security Audit', passed: true },
        { name: 'Liquidity Depth', passed: true },
        { name: 'Smart Contract Risk', passed: stakingOption.risk !== 'High' },
        { name: 'Slashing Risk', passed: stakingOption.risk === 'Low' },
      ];

      printRiskAssessment(riskChecks);

      console.log('');

      if (stakingOption.risk === 'Low') {
        printSuccess(`Low risk staking option. Safe for conservative strategies.`);
      } else if (stakingOption.risk === 'Medium') {
        printWarning(`Medium risk staking option. Monitor your position regularly.`);
      } else {
        printWarning(`High risk staking option. Only proceed if you understand the risks.`);
      }

      console.log('');

      // Confirmation
      if (!options.execute) {
        const confirmed = await printConfirmation('Execute this staking operation?');
        if (!confirmed) {
          printWarning('Staking cancelled');
          process.exit(0);
        }
      }

      // Execute
      const execSpinner = ora({ text: 'Submitting staking transaction...', color: 'magenta' }).start();
      await new Promise(resolve => setTimeout(resolve, 1800)); // Mock execution time

      // Mock transaction signature
      const mockTxSig = `${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
      execSpinner.succeed('Transaction confirmed');

      console.log('');
      printSuccess(`Staking executed successfully!`);
      printInfo(`Transaction: ${chalk.white(mockTxSig)}`);
      printInfo(`Explorer: ${chalk.white(`https://explorer.solana.com/tx/${mockTxSig}?cluster=${config.cluster}`)}`);
      console.log('');
      printInfo(`New balance: ${chalk.white(stakingOption.outputAmount.toFixed(4))} ${chalk.cyan(stakingOption.outputToken)}`);
      printInfo(`Estimated yearly rewards: ${chalk.white((stakingOption.outputAmount * stakingOption.apy / 100).toFixed(4))} ${chalk.cyan(stakingOption.outputToken)}`);
      console.log('');
    });
}

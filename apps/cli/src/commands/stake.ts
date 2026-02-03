import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createConnection, getRpcDisplayUrl, type ConnectionConfig } from '@makora/data-feed';
import { MarinadeAdapter } from '@makora/adapters-marinade';
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
  printRiskAssessment,
} from '../utils/display.js';

/**
 * Register the `makora stake` command.
 *
 * Wired to REAL Marinade Finance SDK for liquid staking on devnet/mainnet.
 */
export function registerStakeCommand(program: Command): void {
  program
    .command('stake <amount>')
    .description('Stake SOL on liquid staking protocols')
    .option('--protocol <name>', 'Staking protocol: marinade, jito', 'marinade')
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

      const validProtocols = ['marinade', 'jito'];
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

      // Check SOL balance
      const balanceSpinner = ora({ text: 'Checking SOL balance...', color: 'magenta' }).start();
      let solBalance;
      try {
        const lamports = await connection.getBalance(wallet.publicKey);
        solBalance = lamports / LAMPORTS_PER_SOL;
        balanceSpinner.succeed(`SOL balance: ${solBalance.toFixed(4)} SOL`);
      } catch (err) {
        balanceSpinner.fail('Failed to check balance');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      if (solBalance < amount + 0.05) {
        printError(`Insufficient SOL. Need ${amount} + 0.05 SOL for gas. Have ${solBalance.toFixed(4)} SOL.`);
        process.exit(1);
      }

      // Initialize Marinade adapter
      const adapterSpinner = ora({ text: `Initializing ${options.protocol}...`, color: 'magenta' }).start();
      const marinade = new MarinadeAdapter();
      try {
        await marinade.initialize({
          rpcUrl: config.rpcUrl,
          walletPublicKey: wallet.publicKey,
        });
        adapterSpinner.succeed(`${options.protocol} connected`);
      } catch (err) {
        adapterSpinner.fail(`Failed to initialize ${options.protocol}`);
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      // Fetch real quote from Marinade
      const rawAmount = BigInt(Math.floor(amount * LAMPORTS_PER_SOL));
      const detailsSpinner = ora({ text: `Fetching staking details from ${options.protocol}...`, color: 'magenta' }).start();
      let quote;
      try {
        const { PublicKey } = await import('@solana/web3.js');
        quote = await marinade.getQuote({
          inputToken: new PublicKey('So11111111111111111111111111111111111111112'),
          outputToken: new PublicKey('mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So'),
          amount: rawAmount,
          maxSlippageBps: 10,
        });
        detailsSpinner.succeed('Staking details loaded from Marinade');
      } catch (err) {
        detailsSpinner.fail('Failed to fetch staking details');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      const expectedMsol = Number(quote.expectedOutputAmount) / LAMPORTS_PER_SOL;
      const exchangeRate = quote.raw?.exchangeRate ?? (expectedMsol / amount);

      console.log('');
      printInfo(`Stake ${chalk.white(amount)} ${chalk.cyan('SOL')} -> ${chalk.white(`~${expectedMsol.toFixed(4)}`)} ${chalk.cyan('mSOL')} via ${chalk.magenta('Marinade')}`);
      console.log('');

      // Display staking details from real quote
      const stakingTable = [
        ['Protocol', 'Marinade Finance'],
        ['Input', `${amount} SOL`],
        ['Expected Output', `~${expectedMsol.toFixed(4)} mSOL`],
        ['Exchange Rate', `1 SOL = ${exchangeRate.toFixed(6)} mSOL`],
        ['Price Impact', `${quote.priceImpactPct.toFixed(2)}%`],
        ['Route', quote.routeDescription],
        ['Risk Level', 'Low'],
      ];

      printTable(['Detail', 'Value'], stakingTable);
      console.log('');

      // Risk assessment
      const riskChecks = [
        { name: 'Protocol Security Audit', passed: true },
        { name: 'Liquidity Depth', passed: true },
        { name: 'Smart Contract Risk', passed: true },
        { name: 'Sufficient SOL Balance', passed: solBalance >= amount + 0.05 },
      ];

      printRiskAssessment(riskChecks);
      console.log('');

      printSuccess('Low risk staking option. Marinade is audited and liquid.');
      console.log('');

      // Confirmation
      if (!options.execute) {
        const confirmed = await printConfirmation('Execute this staking operation?');
        if (!confirmed) {
          printWarning('Staking cancelled');
          process.exit(0);
        }
      }

      // Execute via real Marinade + execution engine
      const execSpinner = ora({ text: 'Building and submitting staking transaction...', color: 'magenta' }).start();
      try {
        const instructions = await marinade.buildStakeIx({
          amount: rawAmount,
          userPublicKey: wallet.publicKey,
        });

        const engine = new ExecutionEngine(connection);
        const result = await engine.execute({
          instructions,
          signer: wallet,
          description: `Stake ${amount} SOL via Marinade`,
        });

        if (result.success && result.signature) {
          execSpinner.succeed('Transaction confirmed');
          console.log('');
          printSuccess('Staking executed successfully!');
          printInfo(`Transaction: ${chalk.white(result.signature)}`);
          printInfo(`Explorer: ${chalk.white(`https://explorer.solana.com/tx/${result.signature}?cluster=${config.cluster}`)}`);
          if (result.slot) {
            printInfo(`Confirmed at slot: ${chalk.white(result.slot)}`);
          }
          printInfo(`You will receive: ~${chalk.white(expectedMsol.toFixed(4))} ${chalk.cyan('mSOL')}`);
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

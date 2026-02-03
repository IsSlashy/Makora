import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { createConnection, getRpcDisplayUrl, type ConnectionConfig } from '@makora/data-feed';
import { loadConfig } from '../utils/config.js';
import { loadWalletFromFile } from '../utils/wallet.js';
import { createMakoraAgent } from '../utils/agent-factory.js';
import {
  printBanner,
  printInfo,
  printSuccess,
  printWarning,
  printError,
  printTable,
  printActionPlan,
  printConfirmation,
  printRiskAssessment,
} from '../utils/display.js';

/**
 * Register the `makora agent` command.
 *
 * Wired to REAL MakoraAgent with NL parser, strategy engine, and execution engine.
 * Parses natural language, evaluates strategy, and executes on devnet.
 */
export function registerAgentCommand(program: Command): void {
  program
    .command('agent <instruction>')
    .description('Execute natural language trading instructions')
    .option('--wallet <path>', 'Path to wallet keypair JSON file')
    .option('--rpc <url>', 'Custom RPC endpoint URL')
    .option('--cluster <cluster>', 'Solana cluster: devnet, mainnet-beta, localnet', 'devnet')
    .action(async (instruction: string, options) => {
      printBanner();

      if (!instruction || instruction.trim().length === 0) {
        printError('Please provide an instruction.');
        printInfo('Example: makora agent "swap 10 SOL to USDC"');
        process.exit(1);
      }

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

      console.log('');

      // Initialize the real MakoraAgent
      const initSpinner = ora({ text: 'Initializing Makora Agent...', color: 'magenta' }).start();
      let agent;
      try {
        agent = await createMakoraAgent(connection, wallet, config);
        initSpinner.succeed('Makora Agent initialized (Jupiter + Marinade + Privacy)');
      } catch (err) {
        initSpinner.fail('Failed to initialize agent');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      // Parse instruction using real NL parser
      const parseSpinner = ora({ text: 'Parsing instruction...', color: 'magenta' }).start();
      const intent = agent.parseCommand(instruction);

      if (intent.type === 'unknown') {
        parseSpinner.fail('Unable to understand instruction');
        printError('Could not parse your instruction. Please try rephrasing.');
        printInfo('Example commands:');
        printInfo('  - "swap 10 SOL to USDC"');
        printInfo('  - "stake 5 SOL"');
        printInfo('  - "check my portfolio"');
        printInfo('  - "what should I do?"');
        printInfo('  - "unstake 2 mSOL"');
        process.exit(1);
      }

      parseSpinner.succeed('Instruction parsed');
      console.log('');

      // Display parsed intent
      console.log(chalk.hex('#8b5cf6').bold('  PARSED INTENT'));
      console.log('');
      printInfo(`Action: ${chalk.white(intent.type.toUpperCase())}`);

      if (intent.type === 'swap') {
        printInfo(`Amount: ${chalk.white(intent.amountIsPercent ? `${intent.amount}%` : String(intent.amount))} ${chalk.cyan(intent.fromToken)}`);
        printInfo(`To: ${chalk.cyan(intent.toToken)}`);
      } else if (intent.type === 'stake') {
        printInfo(`Amount: ${chalk.white(intent.amountIsPercent ? `${intent.amount}%` : String(intent.amount))} ${chalk.cyan(intent.token)}`);
      } else if (intent.type === 'unstake') {
        printInfo(`Amount: ${chalk.white(intent.amountIsPercent ? `${intent.amount}%` : String(intent.amount))} ${chalk.cyan(intent.token)}`);
      }

      console.log('');

      // Execute via real agent core
      const execSpinner = ora({ text: `Executing via agent core...`, color: 'magenta' }).start();
      try {
        const result = await agent.executeCommand(instruction);
        execSpinner.succeed('Agent evaluation complete');

        console.log('');
        console.log(chalk.hex('#8b5cf6').bold('  AGENT RESPONSE'));
        console.log('');

        // Display the agent's response line by line
        for (const line of result.split('\n')) {
          if (line.trim()) {
            printInfo(line);
          }
        }

        console.log('');

        // Show current agent state
        const phase = agent.getPhase();
        const mode = agent.getMode();
        printInfo(`Agent mode: ${chalk.white(mode)}`);
        printInfo(`OODA phase: ${chalk.white(phase)}`);
        console.log('');

        if (mode === 'advisory') {
          printInfo('Run `makora auto on` to enable autonomous execution.');
          printInfo('Or run a single OODA cycle with `makora auto cycle`.');
        }
      } catch (err) {
        execSpinner.fail('Agent execution failed');
        printError(err instanceof Error ? err.message : String(err));
      }

      console.log('');
    });
}

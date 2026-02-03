import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { createConnection, type ConnectionConfig } from '@makora/data-feed';
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
  printConfirmation,
} from '../utils/display.js';

/**
 * Register the `makora auto` command.
 *
 * Wired to REAL MakoraAgent OODA loop. Can run single cycles or continuous mode.
 */
export function registerAutoCommand(program: Command): void {
  program
    .command('auto [state]')
    .description('Enable autonomous trading or run a single OODA cycle (on | off | cycle)')
    .option('--wallet <path>', 'Path to wallet keypair JSON file')
    .option('--rpc <url>', 'Custom RPC endpoint URL')
    .option('--cluster <cluster>', 'Solana cluster: devnet, mainnet-beta, localnet', 'devnet')
    .action(async (state: string | undefined, options) => {
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

      // Initialize agent
      const initSpinner = ora({ text: 'Initializing Makora Agent...', color: 'magenta' }).start();
      let agent;
      try {
        agent = await createMakoraAgent(connection, wallet, config);
        initSpinner.succeed('Makora Agent initialized');
      } catch (err) {
        initSpinner.fail('Failed to initialize agent');
        printError(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      // No argument: show status and run a single OODA cycle
      if (!state || state.toLowerCase() === 'cycle') {
        console.log('');
        console.log(chalk.hex('#8b5cf6').bold('  OODA CYCLE - SINGLE RUN'));
        console.log('');

        printInfo(`Mode: ${chalk.white(agent.getMode())}`);
        printInfo(`Running single OODA cycle (Observe -> Orient -> Decide -> Act)...`);
        console.log('');

        const cycleSpinner = ora({ text: 'OBSERVE: Fetching portfolio and market data...', color: 'magenta' }).start();

        // Wire up event listener for real-time phase updates
        agent.onEvent((event) => {
          if (event.type === 'cycle_started') {
            const phaseNames: Record<string, string> = {
              observe: 'OBSERVE: Fetching portfolio and market data...',
              orient: 'ORIENT: Analyzing market conditions...',
              decide: 'DECIDE: Evaluating strategy and risk...',
              act: 'ACT: Processing recommendations...',
            };
            cycleSpinner.text = phaseNames[event.phase] || event.phase;
          }
        });

        try {
          const result = await agent.runSingleCycle();
          cycleSpinner.succeed('OODA cycle complete');

          console.log('');

          // Display cycle results
          console.log(chalk.hex('#8b5cf6').bold('  CYCLE RESULTS'));
          console.log('');

          const resultsTable = [
            ['Cycle Time', `${result.cycleTimeMs}ms`],
            ['Proposed Actions', `${result.proposedActions.length}`],
            ['Approved Actions', `${result.approvedActions.length}`],
            ['Rejected Actions', `${result.rejectedActions.length}`],
          ];

          if (result.executionResults) {
            const successes = result.executionResults.filter(r => r.success).length;
            resultsTable.push(['Executed', `${successes}/${result.executionResults.length}`]);
          }

          printTable(['Metric', 'Value'], resultsTable);
          console.log('');

          // Show proposed actions
          if (result.proposedActions.length > 0) {
            console.log(chalk.hex('#8b5cf6').bold('  PROPOSED ACTIONS'));
            console.log('');
            for (const action of result.proposedActions) {
              printInfo(`${chalk.white(action.type.toUpperCase())} | ${action.description} (${action.protocol})`);
            }
            console.log('');
          } else {
            printSuccess('No actions needed. Portfolio is well-positioned.');
            console.log('');
          }

          // Show approved actions
          if (result.approvedActions.length > 0) {
            console.log(chalk.hex('#8b5cf6').bold('  APPROVED (PASSED RISK CHECKS)'));
            console.log('');
            for (const action of result.approvedActions) {
              const riskColor = action.riskAssessment.riskScore < 30 ? chalk.green : action.riskAssessment.riskScore < 60 ? chalk.yellow : chalk.red;
              printSuccess(`${action.type.toUpperCase()} | Risk: ${riskColor(action.riskAssessment.riskScore + '/100')} | ${action.riskAssessment.summary}`);
            }
            console.log('');
          }

          // Show rejected actions
          if (result.rejectedActions.length > 0) {
            console.log(chalk.hex('#8b5cf6').bold('  REJECTED (RISK VETO)'));
            console.log('');
            for (const action of result.rejectedActions) {
              printWarning(`${action.type.toUpperCase()} | ${action.riskAssessment.summary}`);
            }
            console.log('');
          }

          // Show execution results
          if (result.executionResults && result.executionResults.length > 0) {
            console.log(chalk.hex('#8b5cf6').bold('  EXECUTION RESULTS'));
            console.log('');
            for (const exec of result.executionResults) {
              if (exec.success) {
                printSuccess(`TX: ${exec.signature}`);
              } else {
                printError(`Failed: ${exec.error}`);
              }
            }
            console.log('');
          }

          // Show strategy evaluation
          const evaluation = agent.getLastEvaluation();
          if (evaluation) {
            printInfo(`Market: ${chalk.gray(evaluation.marketCondition.summary)}`);
            printInfo(`Strategy: ${chalk.white(evaluation.recommended.strategyName)} (confidence: ${evaluation.recommended.confidence}/100)`);
          }

          console.log('');
          printInfo('Run `makora auto on` to enable continuous autonomous trading.');

        } catch (err) {
          cycleSpinner.fail('OODA cycle failed');
          printError(err instanceof Error ? err.message : String(err));
        }

        console.log('');
        return;
      }

      // Turn on continuous OODA loop
      if (state.toLowerCase() === 'on') {
        console.log('');
        console.log(chalk.hex('#8b5cf6').bold('  ENABLE AUTONOMOUS MODE'));
        console.log('');
        printWarning('You are about to enable autonomous trading mode.');
        printWarning('Makora will execute trades without manual confirmation.');
        console.log('');

        const riskSnapshot = agent.getRiskSnapshot();
        const riskTable = [
          ['Max Position Size', `${riskSnapshot?.limits?.maxPositionSizePct ?? 25}%`],
          ['Max Slippage', `${(riskSnapshot?.limits?.maxSlippageBps ?? 100) / 100}%`],
          ['Max Daily Loss', `${riskSnapshot?.limits?.maxDailyLossPct ?? 5}%`],
          ['Min SOL Reserve', `${riskSnapshot?.limits?.minSolReserve ?? 0.05} SOL`],
          ['OODA Cycle Interval', '30 seconds'],
        ];

        printTable(['Risk Parameter', 'Value'], riskTable);
        console.log('');

        const confirmed = await printConfirmation('Enable autonomous mode with these parameters?');
        if (!confirmed) {
          printWarning('Autonomous mode activation cancelled');
          return;
        }

        agent.setMode('auto');
        agent.start();

        printSuccess('Autonomous mode activated!');
        printInfo('Makora OODA loop is now running. Press Ctrl+C to stop.');
        console.log('');

        // Keep process alive and show cycle updates
        agent.onEvent((event) => {
          if (event.type === 'cycle_completed') {
            const r = event.result;
            const ts = new Date().toLocaleTimeString();
            console.log(chalk.gray(`  [${ts}]`) +
              ` Cycle: ${r.proposedActions.length} proposed, ` +
              `${r.approvedActions.length} approved, ` +
              `${r.rejectedActions.length} rejected ` +
              `(${r.cycleTimeMs}ms)`);

            if (r.executionResults) {
              for (const exec of r.executionResults) {
                if (exec.success) {
                  console.log(chalk.green(`  [${ts}] TX: ${exec.signature}`));
                }
              }
            }
          }
          if (event.type === 'error') {
            console.log(chalk.red(`  [ERROR] ${event.message}`));
          }
        });

        // Keep the process alive
        await new Promise(() => {});
      }

      // Turn off
      if (state.toLowerCase() === 'off') {
        agent.setMode('advisory');
        agent.stop();

        printSuccess('Autonomous mode deactivated. Switched to advisory mode.');
        printInfo('Makora will now provide recommendations only.');
        console.log('');
        return;
      }

      // Invalid argument
      printError('Invalid argument. Use `makora auto on`, `makora auto off`, or `makora auto cycle`.');
      process.exit(1);
    });
}

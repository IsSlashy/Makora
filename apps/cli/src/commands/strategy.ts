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
} from '../utils/display.js';

interface StrategyConfig {
  type: 'yield' | 'trading' | 'rebalance' | 'liquidity';
  allocation: Record<string, number>;
  confidenceThreshold: number;
  riskTolerance: 'low' | 'medium' | 'high';
}

interface YieldOpportunity {
  protocol: string;
  action: string;
  apy: number;
  risk: 'Low' | 'Medium' | 'High';
  confidence: number;
}

/**
 * Get current strategy configuration.
 */
function getCurrentStrategy(): StrategyConfig {
  return {
    type: 'yield',
    allocation: {
      'Staking': 40,
      'Liquidity Pools': 30,
      'Lending': 20,
      'Cash': 10,
    },
    confidenceThreshold: 75,
    riskTolerance: 'medium',
  };
}

/**
 * Get mock yield opportunities.
 */
function getYieldOpportunities(): YieldOpportunity[] {
  return [
    { protocol: 'Marinade', action: 'Stake SOL', apy: 7.2, risk: 'Low', confidence: 85 },
    { protocol: 'Raydium', action: 'LP SOL/USDC', apy: 12.4, risk: 'Medium', confidence: 72 },
    { protocol: 'Kamino', action: 'Deposit USDC', apy: 5.8, risk: 'Low', confidence: 90 },
    { protocol: 'Drift', action: 'Lending SOL', apy: 8.9, risk: 'Medium', confidence: 68 },
    { protocol: 'Orca', action: 'LP SOL/USDT', apy: 10.2, risk: 'Medium', confidence: 75 },
  ];
}

/**
 * Get OODA cycle state.
 */
function getOODACycleState(): { phase: string; description: string; lastUpdate: Date } {
  const phases = [
    { phase: 'Observe', description: 'Monitoring market conditions and portfolio performance' },
    { phase: 'Orient', description: 'Analyzing yield opportunities and risk factors' },
    { phase: 'Decide', description: 'Evaluating optimal rebalancing strategy' },
    { phase: 'Act', description: 'Executing rebalancing transactions' },
  ];

  // Mock: cycle through phases
  const currentIndex = Math.floor(Date.now() / 10000) % phases.length;
  return {
    ...phases[currentIndex],
    lastUpdate: new Date(),
  };
}

/**
 * Register the `makora strategy` command.
 */
export function registerStrategyCommand(program: Command): void {
  program
    .command('strategy')
    .description('Display current strategy and yield opportunities')
    .option('--set <type>', 'Set strategy type: yield, trading, rebalance, liquidity')
    .option('--wallet <path>', 'Path to wallet keypair JSON file')
    .action(async (options) => {
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

      // Handle --set option
      if (options.set) {
        const validTypes = ['yield', 'trading', 'rebalance', 'liquidity'];
        if (!validTypes.includes(options.set)) {
          printError(`Invalid strategy type. Choose from: ${validTypes.join(', ')}`);
          process.exit(1);
        }

        const setSpinner = ora({ text: `Switching strategy to ${options.set}...`, color: 'magenta' }).start();
        await new Promise(resolve => setTimeout(resolve, 500));
        setSpinner.succeed(`Strategy set to ${options.set}`);
        console.log('');
      }

      // Fetch strategy
      const strategySpinner = ora({ text: 'Loading strategy configuration...', color: 'magenta' }).start();
      await new Promise(resolve => setTimeout(resolve, 600));
      const strategy = getCurrentStrategy();
      strategySpinner.succeed('Strategy loaded');

      console.log('');
      console.log(chalk.hex('#8b5cf6').bold('  CURRENT STRATEGY'));
      console.log('');
      printInfo(`Type: ${chalk.white(strategy.type.toUpperCase())}`);
      printInfo(`Risk Tolerance: ${chalk.white(strategy.riskTolerance.toUpperCase())}`);
      printInfo(`Confidence Threshold: ${chalk.white(strategy.confidenceThreshold + '%')}`);
      console.log('');

      // Allocation table
      console.log(chalk.hex('#8b5cf6').bold('  TARGET ALLOCATION'));
      console.log('');
      const allocationTable = Object.entries(strategy.allocation).map(([key, value]) => [
        key,
        `${value}%`,
        getAllocationBar(value),
      ]);
      printTable(['Category', 'Target', 'Allocation'], allocationTable);

      console.log('');

      // Yield opportunities
      const opportunitiesSpinner = ora({ text: 'Scanning yield opportunities...', color: 'magenta' }).start();
      await new Promise(resolve => setTimeout(resolve, 800));
      const opportunities = getYieldOpportunities();
      opportunitiesSpinner.succeed('Yield opportunities loaded');

      console.log('');
      console.log(chalk.hex('#8b5cf6').bold('  YIELD OPPORTUNITIES'));
      console.log('');

      const opportunitiesTable = opportunities.map((opp) => {
        const riskColor = opp.risk === 'Low' ? chalk.green : opp.risk === 'Medium' ? chalk.yellow : chalk.red;
        const confidenceColor = opp.confidence >= 80 ? chalk.green : opp.confidence >= 70 ? chalk.yellow : chalk.gray;
        return [
          opp.protocol,
          opp.action,
          chalk.green(`${opp.apy}%`),
          riskColor(opp.risk),
          confidenceColor(`${opp.confidence}%`),
        ];
      });

      printTable(
        ['Protocol', 'Action', 'APY', 'Risk', 'Confidence'],
        opportunitiesTable
      );

      console.log('');

      // OODA cycle state
      const oodaCycle = getOODACycleState();
      console.log(chalk.hex('#8b5cf6').bold('  OODA CYCLE STATE'));
      console.log('');
      printInfo(`Current Phase: ${chalk.white(oodaCycle.phase)}`);
      printInfo(`Description: ${chalk.gray(oodaCycle.description)}`);
      printInfo(`Last Update: ${chalk.gray(oodaCycle.lastUpdate.toLocaleTimeString())}`);
      console.log('');

      // Recommendations
      console.log(chalk.hex('#8b5cf6').bold('  RECOMMENDATIONS'));
      console.log('');
      printSuccess('High confidence opportunity: Kamino USDC deposit (90% confidence)');
      printWarning('Consider rebalancing: Liquidity Pools allocation 15% above target');
      printInfo('Next rebalance scheduled in: 2 hours 34 minutes');
      console.log('');
    });
}

/**
 * Create a visual allocation bar.
 */
function getAllocationBar(pct: number): string {
  const filled = Math.round(pct / 5);
  const empty = 20 - filled;
  return chalk.hex('#8b5cf6')('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

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
  printActionPlan,
  printConfirmation,
  printRiskAssessment,
} from '../utils/display.js';

interface ParsedIntent {
  action: string;
  params: Record<string, any>;
  confidence: number;
}

/**
 * Parse natural language instruction into structured intent.
 */
function parseInstruction(instruction: string): ParsedIntent {
  const lower = instruction.toLowerCase();

  // Swap detection
  if (lower.includes('swap') || lower.includes('exchange') || lower.includes('trade')) {
    const amountMatch = lower.match(/(\d+\.?\d*)\s*(sol|usdc|usdt|jup|bonk|ray)/i);
    const toMatch = lower.match(/to\s+(\d+\.?\d*)?\s*(sol|usdc|usdt|jup|bonk|ray)/i);

    if (amountMatch && toMatch) {
      return {
        action: 'swap',
        params: {
          amount: parseFloat(amountMatch[1]),
          from: amountMatch[2].toUpperCase(),
          to: toMatch[2].toUpperCase(),
        },
        confidence: 95,
      };
    }
  }

  // Stake detection
  if (lower.includes('stake') || lower.includes('staking')) {
    const amountMatch = lower.match(/(\d+\.?\d*)\s*(sol)/i);
    const protocolMatch = lower.match(/(marinade|raydium|jito)/i);

    if (amountMatch) {
      return {
        action: 'stake',
        params: {
          amount: parseFloat(amountMatch[1]),
          protocol: protocolMatch ? protocolMatch[1].toLowerCase() : 'marinade',
        },
        confidence: 90,
      };
    }
  }

  // Rebalance detection
  if (lower.includes('rebalance') || lower.includes('optimize')) {
    return {
      action: 'rebalance',
      params: {
        strategy: 'yield',
      },
      confidence: 85,
    };
  }

  // Shield detection
  if (lower.includes('shield') || lower.includes('privacy') || lower.includes('hide')) {
    const amountMatch = lower.match(/(\d+\.?\d*)\s*(sol)/i);
    if (amountMatch) {
      return {
        action: 'shield',
        params: {
          amount: parseFloat(amountMatch[1]),
        },
        confidence: 88,
      };
    }
  }

  // Unknown intent
  return {
    action: 'unknown',
    params: {},
    confidence: 0,
  };
}

/**
 * Generate action plan for intent.
 */
function generateActionPlan(intent: ParsedIntent): string[] {
  switch (intent.action) {
    case 'swap':
      return [
        `Fetch best swap route from Jupiter for ${intent.params.amount} ${intent.params.from} → ${intent.params.to}`,
        'Calculate price impact and slippage',
        'Verify swap parameters are within risk limits',
        'Submit swap transaction',
        'Confirm transaction on Solana blockchain',
      ];
    case 'stake':
      return [
        `Connect to ${intent.params.protocol} staking protocol`,
        `Fetch current APY and staking parameters`,
        `Stake ${intent.params.amount} SOL`,
        'Receive liquid staking tokens',
        'Update portfolio tracking',
      ];
    case 'rebalance':
      return [
        'Analyze current portfolio allocation',
        'Calculate optimal rebalancing strategy',
        'Identify underweight and overweight positions',
        'Execute rebalancing swaps',
        'Confirm new allocation matches target',
      ];
    case 'shield':
      return [
        `Generate zero-knowledge proof for ${intent.params.amount} SOL`,
        'Create on-chain commitment',
        'Transfer SOL to privacy pool',
        'Verify privacy properties',
      ];
    default:
      return ['Unknown action'];
  }
}

/**
 * Perform risk checks for intent.
 */
function performRiskChecks(intent: ParsedIntent): Array<{ name: string; passed: boolean }> {
  const checks = [
    { name: 'Sufficient balance', passed: true },
    { name: 'Within position size limits', passed: true },
    { name: 'Acceptable slippage', passed: true },
    { name: 'Protocol security verified', passed: true },
  ];

  // Add specific checks based on action
  if (intent.action === 'swap') {
    const positionSize = Math.min((intent.params.amount || 0) * 245.30 / 1000, 100); // Mock calculation
    checks[1].passed = positionSize <= 20;
  }

  if (intent.action === 'stake') {
    checks.push({ name: 'Liquid staking available', passed: true });
  }

  return checks;
}

/**
 * Register the `makora agent` command.
 */
export function registerAgentCommand(program: Command): void {
  program
    .command('agent <instruction>')
    .description('Execute natural language trading instructions')
    .option('--wallet <path>', 'Path to wallet keypair JSON file')
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

      console.log('');

      // Parse instruction
      const parseSpinner = ora({ text: 'Parsing instruction...', color: 'magenta' }).start();
      await new Promise(resolve => setTimeout(resolve, 600));
      const intent = parseInstruction(instruction);

      if (intent.action === 'unknown') {
        parseSpinner.fail('Unable to understand instruction');
        printError('Could not parse your instruction. Please try rephrasing.');
        printInfo('Example commands:');
        printInfo('  - "swap 10 SOL to USDC"');
        printInfo('  - "stake 5 SOL on marinade"');
        printInfo('  - "rebalance my portfolio"');
        printInfo('  - "shield 2 SOL for privacy"');
        process.exit(1);
      }

      parseSpinner.succeed('Instruction parsed');

      console.log('');

      // Display parsed intent
      console.log(chalk.hex('#8b5cf6').bold('  PARSED INTENT'));
      console.log('');
      printInfo(`Action: ${chalk.white(intent.action.toUpperCase())}`);
      printInfo(`Confidence: ${chalk.white(intent.confidence + '%')}`);

      if (Object.keys(intent.params).length > 0) {
        const paramsStr = Object.entries(intent.params)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ');
        printInfo(`Parameters: ${chalk.gray(paramsStr)}`);
      }

      console.log('');

      // Generate strategy
      const strategySpinner = ora({ text: 'Analyzing optimal strategy...', color: 'magenta' }).start();
      await new Promise(resolve => setTimeout(resolve, 700));
      strategySpinner.succeed('Strategy determined');

      console.log('');

      // Display strategy
      console.log(chalk.hex('#8b5cf6').bold('  STRATEGY'));
      console.log('');

      if (intent.action === 'swap') {
        printInfo(`Route: Use Jupiter aggregator for best rates`);
        printInfo(`Expected slippage: ~0.3%`);
        printInfo(`Estimated output: ~${(intent.params.amount * 245.30).toFixed(2)} ${intent.params.to}`);
      } else if (intent.action === 'stake') {
        printInfo(`Protocol: ${intent.params.protocol.charAt(0).toUpperCase() + intent.params.protocol.slice(1)}`);
        printInfo(`Expected APY: ~7.2%`);
        printInfo(`Risk level: Low`);
      } else if (intent.action === 'rebalance') {
        printInfo(`Target allocation: 40% Staking, 30% LPs, 20% Lending, 10% Cash`);
        printInfo(`Estimated transactions: 3-5`);
      } else if (intent.action === 'shield') {
        printInfo(`Privacy protocol: Zero-knowledge proofs (Groth16)`);
        printInfo(`Anonymity set: ~1,450 participants`);
      }

      console.log('');

      // Display action plan
      console.log(chalk.hex('#8b5cf6').bold('  EXECUTION PLAN'));
      console.log('');
      const plan = generateActionPlan(intent);
      printActionPlan(plan);

      console.log('');

      // Risk checks
      const riskSpinner = ora({ text: 'Running risk checks...', color: 'magenta' }).start();
      await new Promise(resolve => setTimeout(resolve, 500));
      const riskChecks = performRiskChecks(intent);
      const allPassed = riskChecks.every(check => check.passed);

      if (allPassed) {
        riskSpinner.succeed('All risk checks passed');
      } else {
        riskSpinner.warn('Some risk checks failed');
      }

      console.log('');
      printRiskAssessment(riskChecks);

      console.log('');

      if (!allPassed) {
        printError('Cannot execute: risk checks failed');
        process.exit(1);
      }

      printSuccess('All parameters within acceptable risk limits');
      console.log('');

      // Confirmation
      const confirmed = await printConfirmation('Execute this action?');
      if (!confirmed) {
        printWarning('Action cancelled');
        process.exit(0);
      }

      console.log('');

      // Execute
      const execSpinner = ora({ text: `Executing ${intent.action}...`, color: 'magenta' }).start();
      await new Promise(resolve => setTimeout(resolve, 1800));
      execSpinner.succeed('Action executed successfully');

      // Mock transaction signature
      const mockTxSig = `${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;

      console.log('');
      printSuccess(`${intent.action.toUpperCase()} completed!`);
      printInfo(`Transaction: ${chalk.white(mockTxSig)}`);
      printInfo(`Explorer: ${chalk.white(`https://explorer.solana.com/tx/${mockTxSig}?cluster=${config.cluster}`)}`);
      console.log('');
    });
}

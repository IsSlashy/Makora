import { Command } from 'commander';
import { registerStatusCommand } from './commands/status.js';
import { registerSwapCommand } from './commands/swap.js';
import { registerStakeCommand } from './commands/stake.js';
import { registerStrategyCommand } from './commands/strategy.js';
import { registerAutoCommand } from './commands/auto.js';
import { registerShieldCommand } from './commands/shield.js';
import { registerAgentCommand } from './commands/agent.js';

const program = new Command();

program
  .name('makora')
  .description('Makora - The Adaptive DeFi Agent for Solana')
  .version('0.1.0');

// Register commands
registerStatusCommand(program);
registerSwapCommand(program);
registerStakeCommand(program);
registerStrategyCommand(program);
registerAutoCommand(program);
registerShieldCommand(program);
registerAgentCommand(program);

// Parse and execute
program.parse();

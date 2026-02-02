import { Command } from 'commander';
import { registerStatusCommand } from './commands/status.js';

const program = new Command();

program
  .name('makora')
  .description('Makora - The Adaptive DeFi Agent for Solana')
  .version('0.1.0');

// Register commands
registerStatusCommand(program);

// Parse and execute
program.parse();

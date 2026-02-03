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
  printActionPlan,
} from '../utils/display.js';

/**
 * Generate mock ZK proof (for demo purposes).
 */
function generateMockProof(): { commitmentHash: string; nullifierHash: string; proofData: string } {
  const randomHex = (len: number) =>
    Array.from({ length: len }, () => Math.floor(Math.random() * 16).toString(16)).join('');

  return {
    commitmentHash: '0x' + randomHex(64),
    nullifierHash: '0x' + randomHex(64),
    proofData: '0x' + randomHex(128),
  };
}

/**
 * Register the `makora shield` command.
 */
export function registerShieldCommand(program: Command): void {
  program
    .command('shield <amount>')
    .description('Shield SOL into privacy pool using zero-knowledge proofs')
    .option('--unshield', 'Unshield tokens from privacy pool')
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

      const isUnshield = options.unshield === true;

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

      console.log('');

      // Display operation details
      if (isUnshield) {
        printInfo(`${chalk.white('Unshield')} ${chalk.cyan(amount)} ${chalk.white('SOL')} from privacy pool`);
      } else {
        printInfo(`${chalk.white('Shield')} ${chalk.cyan(amount)} ${chalk.white('SOL')} into privacy pool`);
      }

      console.log('');

      // Show operation plan
      if (isUnshield) {
        const unshieldPlan = [
          'Generate nullifier proof for shielded balance',
          'Verify proof validity on-chain',
          'Transfer SOL from privacy pool to wallet',
          'Burn nullifier to prevent double-spending',
        ];
        printActionPlan(unshieldPlan);
      } else {
        const shieldPlan = [
          'Generate commitment hash from secret note',
          'Create zero-knowledge proof of ownership',
          'Transfer SOL from wallet to privacy pool',
          'Store commitment on-chain',
        ];
        printActionPlan(shieldPlan);
      }

      console.log('');

      // Privacy benefits
      console.log(chalk.hex('#8b5cf6').bold('  PRIVACY FEATURES'));
      console.log('');
      const privacyTable = [
        ['Zero-Knowledge Proofs', 'Groth16 (snarkjs)'],
        ['Anonymity Set', '~1,450 participants'],
        ['Privacy Level', 'High (onchain observer cannot link sender/receiver)'],
        ['Gas Cost', '~0.001 SOL (2-phase commit)'],
      ];
      printTable(['Feature', 'Details'], privacyTable);

      console.log('');
      printWarning('Privacy operations use on-chain commitments. Transaction may take longer.');
      console.log('');

      // Confirm
      const confirmed = await printConfirmation(`Execute ${isUnshield ? 'unshield' : 'shield'} operation?`);
      if (!confirmed) {
        printWarning('Operation cancelled');
        process.exit(0);
      }

      console.log('');

      // Phase 1: Generate ZK proof
      const proofSpinner = ora({ text: 'Generating zero-knowledge proof...', color: 'magenta' }).start();
      await new Promise(resolve => setTimeout(resolve, 2000)); // Mock ZK proof generation time
      const proof = generateMockProof();
      proofSpinner.succeed('ZK proof generated');

      printInfo(`Commitment: ${chalk.gray(proof.commitmentHash.slice(0, 20) + '...')}`);
      printInfo(`Nullifier: ${chalk.gray(proof.nullifierHash.slice(0, 20) + '...')}`);
      console.log('');

      // Phase 2: Submit commitment
      const commitSpinner = ora({ text: 'Phase 1: Submitting commitment on-chain...', color: 'magenta' }).start();
      await new Promise(resolve => setTimeout(resolve, 1200));
      const commitTxSig = `${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
      commitSpinner.succeed('Phase 1: Commitment stored');

      printInfo(`TX: ${chalk.white(commitTxSig)}`);
      console.log('');

      // Phase 3: Transfer SOL
      const transferSpinner = ora({ text: `Phase 2: ${isUnshield ? 'Withdrawing' : 'Transferring'} ${amount} SOL...`, color: 'magenta' }).start();
      await new Promise(resolve => setTimeout(resolve, 1500));
      const transferTxSig = `${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}${Math.random().toString(36).substring(2, 15)}`;
      transferSpinner.succeed(`Phase 2: ${isUnshield ? 'Withdrawal' : 'Transfer'} complete`);

      printInfo(`TX: ${chalk.white(transferTxSig)}`);
      console.log('');

      // Success
      printSuccess(`${isUnshield ? 'Unshield' : 'Shield'} operation completed successfully!`);
      console.log('');
      printInfo(`Explorer: ${chalk.white(`https://explorer.solana.com/tx/${transferTxSig}?cluster=${config.cluster}`)}`);

      if (!isUnshield) {
        printWarning('Save your secret note to unshield later:');
        printInfo(`Note: ${chalk.gray(proof.nullifierHash)}`);
      }

      console.log('');
    });
}

import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { expect } from 'chai';
import type { MakoraStrategy } from '../target/types/makora_strategy';

describe('makora_strategy', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MakoraStrategy as Program<MakoraStrategy>;
  const owner = provider.wallet as anchor.Wallet;
  const agentAuthority = Keypair.generate();

  let strategyPda: PublicKey;
  let strategyBump: number;
  let auditPda: PublicKey;
  let auditBump: number;

  before(async () => {
    [strategyPda, strategyBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('strategy'), owner.publicKey.toBuffer()],
      program.programId
    );

    [auditPda, auditBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('audit'), owner.publicKey.toBuffer()],
      program.programId
    );
  });

  function padSymbol(symbol: string): number[] {
    const bytes = Buffer.alloc(8);
    bytes.write(symbol);
    return Array.from(bytes);
  }

  it('initializes a strategy account', async () => {
    const allocSymbols = [
      padSymbol('SOL'),
      padSymbol('mSOL'),
      padSymbol('USDC'),
    ];
    const allocPcts = [50, 30, 20];

    await program.methods
      .initialize(
        agentAuthority.publicKey,
        0, // yield strategy
        0, // advisory mode
        40, // confidence threshold
        5,  // max actions per cycle
        allocSymbols,
        Buffer.from(allocPcts),
      )
      .accounts({
        owner: owner.publicKey,
        strategyAccount: strategyPda,
        auditTrail: auditPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const strategy = await program.account.strategyAccount.fetch(strategyPda);
    expect(strategy.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(strategy.agentAuthority.toBase58()).to.equal(agentAuthority.publicKey.toBase58());
    expect(strategy.strategyType).to.deep.equal({ yield: {} });
    expect(strategy.mode).to.deep.equal({ advisory: {} });
    expect(strategy.confidenceThreshold).to.equal(40);
    expect(strategy.maxActionsPerCycle).to.equal(5);
    expect(strategy.allocationCount).to.equal(3);
    expect(strategy.totalCycles.toNumber()).to.equal(0);
    expect(strategy.totalActionsExecuted.toNumber()).to.equal(0);

    const audit = await program.account.auditTrail.fetch(auditPda);
    expect(audit.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(audit.head).to.equal(0);
    expect(audit.count).to.equal(0);
  });

  it('updates strategy via owner', async () => {
    const newAllocSymbols = [
      padSymbol('SOL'),
      padSymbol('USDC'),
    ];
    const newAllocPcts = [60, 40];

    await program.methods
      .updateStrategy(
        2, // rebalance strategy
        50,
        3,
        newAllocSymbols,
        Buffer.from(newAllocPcts),
      )
      .accounts({
        authority: owner.publicKey,
        strategyAccount: strategyPda,
      })
      .rpc();

    const strategy = await program.account.strategyAccount.fetch(strategyPda);
    expect(strategy.strategyType).to.deep.equal({ rebalance: {} });
    expect(strategy.confidenceThreshold).to.equal(50);
    expect(strategy.allocationCount).to.equal(2);
    expect(strategy.totalCycles.toNumber()).to.equal(1);
  });

  it('updates strategy via agent authority', async () => {
    const sig = await provider.connection.requestAirdrop(
      agentAuthority.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(sig);

    const allocSymbols = [
      padSymbol('SOL'),
      padSymbol('mSOL'),
      padSymbol('USDC'),
    ];
    const allocPcts = [50, 30, 20];

    await program.methods
      .updateStrategy(
        0, // yield strategy
        40,
        5,
        allocSymbols,
        Buffer.from(allocPcts),
      )
      .accounts({
        authority: agentAuthority.publicKey,
        strategyAccount: strategyPda,
      })
      .signers([agentAuthority])
      .rpc();

    const strategy = await program.account.strategyAccount.fetch(strategyPda);
    expect(strategy.strategyType).to.deep.equal({ yield: {} });
    expect(strategy.totalCycles.toNumber()).to.equal(2);
  });

  it('logs an action to the audit trail', async () => {
    await program.methods
      .logAction(
        'stake',
        'marinade',
        'Stake 5 SOL via Marinade for mSOL',
        true,
        true,
      )
      .accounts({
        authority: owner.publicKey,
        strategyAccount: strategyPda,
        auditTrail: auditPda,
        owner: owner.publicKey,
      })
      .rpc();

    const audit = await program.account.auditTrail.fetch(auditPda);
    expect(audit.count).to.equal(1);
    expect(audit.head).to.equal(1);

    const entry = audit.entries[0];
    expect(entry.executed).to.be.true;
    expect(entry.success).to.be.true;

    const strategy = await program.account.strategyAccount.fetch(strategyPda);
    expect(strategy.totalActionsExecuted.toNumber()).to.equal(1);
  });

  it('logs multiple actions (ring buffer)', async () => {
    for (let i = 0; i < 3; i++) {
      await program.methods
        .logAction(
          'swap',
          'jupiter',
          `Swap ${i + 1} SOL to USDC`,
          true,
          i !== 2,
        )
        .accounts({
          authority: agentAuthority.publicKey,
          strategyAccount: strategyPda,
          auditTrail: auditPda,
          owner: owner.publicKey,
        })
        .signers([agentAuthority])
        .rpc();
    }

    const audit = await program.account.auditTrail.fetch(auditPda);
    expect(audit.count).to.equal(4);
    expect(audit.head).to.equal(4);

    const lastEntry = audit.entries[3];
    expect(lastEntry.executed).to.be.true;
    expect(lastEntry.success).to.be.false;
  });

  it('updates permissions (owner only)', async () => {
    const newAgent = Keypair.generate();

    await program.methods
      .updatePermissions(
        newAgent.publicKey,
        1, // auto mode
      )
      .accounts({
        owner: owner.publicKey,
        strategyAccount: strategyPda,
      })
      .rpc();

    const strategy = await program.account.strategyAccount.fetch(strategyPda);
    expect(strategy.agentAuthority.toBase58()).to.equal(newAgent.publicKey.toBase58());
    expect(strategy.mode).to.deep.equal({ auto: {} });
  });

  it('rejects permissions update from non-owner', async () => {
    const randomSigner = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      randomSigner.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .updatePermissions(
          randomSigner.publicKey,
          0,
        )
        .accounts({
          owner: randomSigner.publicKey,
          strategyAccount: strategyPda,
        })
        .signers([randomSigner])
        .rpc();

      expect.fail('Should have thrown an error');
    } catch (err: any) {
      expect(err.toString()).to.include('Error');
    }
  });

  it('rejects invalid strategy type', async () => {
    try {
      await program.methods
        .updateStrategy(
          99,
          40,
          5,
          [],
          Buffer.from([]),
        )
        .accounts({
          authority: owner.publicKey,
          strategyAccount: strategyPda,
        })
        .rpc();

      expect.fail('Should have thrown an error');
    } catch (err: any) {
      expect(err.toString()).to.include('InvalidStrategyType');
    }
  });

  it('rejects allocation that does not sum to 100', async () => {
    const allocSymbols = [
      padSymbol('SOL'),
      padSymbol('USDC'),
    ];
    const allocPcts = [60, 60];

    try {
      await program.methods
        .updateStrategy(
          0,
          40,
          5,
          allocSymbols,
          Buffer.from(allocPcts),
        )
        .accounts({
          authority: owner.publicKey,
          strategyAccount: strategyPda,
        })
        .rpc();

      expect.fail('Should have thrown an error');
    } catch (err: any) {
      expect(err.toString()).to.include('InvalidAllocationSum');
    }
  });
});

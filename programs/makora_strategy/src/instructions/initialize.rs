use anchor_lang::prelude::*;
use crate::state::{StrategyAccount, StrategyType, AgentMode, AllocationTarget, AuditTrail, AUDIT_TRAIL_CAPACITY};
use crate::errors::StrategyError;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The wallet owner creating the strategy account
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Strategy PDA: seeds = ["strategy", owner]
    #[account(
        init,
        payer = owner,
        space = StrategyAccount::SIZE,
        seeds = [b"strategy", owner.key().as_ref()],
        bump
    )]
    pub strategy_account: Account<'info, StrategyAccount>,

    /// Audit trail PDA: seeds = ["audit", owner]
    #[account(
        init,
        payer = owner,
        space = AuditTrail::SIZE,
        seeds = [b"audit", owner.key().as_ref()],
        bump
    )]
    pub audit_trail: Box<Account<'info, AuditTrail>>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Initialize>,
    agent_authority: Pubkey,
    strategy_type: u8,
    mode: u8,
    confidence_threshold: u8,
    max_actions_per_cycle: u8,
    alloc_symbols: Vec<[u8; 8]>,
    alloc_pcts: Vec<u8>,
) -> Result<()> {
    // Validate strategy type
    let st = StrategyType::from_u8(strategy_type)
        .map_err(|_| error!(StrategyError::InvalidStrategyType))?;

    // Validate mode
    let m = AgentMode::from_u8(mode)
        .map_err(|_| error!(StrategyError::InvalidAgentMode))?;

    // Validate allocation
    require!(
        alloc_symbols.len() == alloc_pcts.len(),
        StrategyError::InvalidAllocationSum
    );
    require!(
        alloc_symbols.len() <= 5,
        StrategyError::InvalidAllocationEntry
    );

    let alloc_sum: u16 = alloc_pcts.iter().map(|&p| p as u16).sum();
    if !alloc_pcts.is_empty() {
        require!(alloc_sum == 100, StrategyError::InvalidAllocationSum);
    }

    for &pct in &alloc_pcts {
        require!(pct <= 100, StrategyError::InvalidAllocationEntry);
    }

    // Build target allocation
    let mut target_allocation = [AllocationTarget::default(); 5];
    for (i, (symbol, &pct)) in alloc_symbols.iter().zip(alloc_pcts.iter()).enumerate() {
        target_allocation[i] = AllocationTarget {
            symbol: *symbol,
            target_pct: pct,
        };
    }

    let clock = Clock::get()?;

    // Initialize strategy account
    let strategy = &mut ctx.accounts.strategy_account;
    strategy.owner = ctx.accounts.owner.key();
    strategy.agent_authority = agent_authority;
    strategy.strategy_type = st;
    strategy.mode = m;
    strategy.confidence_threshold = confidence_threshold;
    strategy.max_actions_per_cycle = max_actions_per_cycle;
    strategy.target_allocation = target_allocation;
    strategy.allocation_count = alloc_symbols.len() as u8;
    strategy.total_cycles = 0;
    strategy.total_actions_executed = 0;
    strategy.last_cycle_at = clock.unix_timestamp;
    strategy.created_at = clock.unix_timestamp;
    strategy.bump = ctx.bumps.strategy_account;
    strategy._padding = [0u8; 32];

    // Initialize audit trail
    let audit = &mut ctx.accounts.audit_trail;
    audit.owner = ctx.accounts.owner.key();
    audit.head = 0;
    audit.count = 0;
    audit.entries = [Default::default(); AUDIT_TRAIL_CAPACITY];
    audit.bump = ctx.bumps.audit_trail;

    msg!(
        "Strategy account initialized for owner {} with strategy type {:?} in {:?} mode",
        ctx.accounts.owner.key(),
        st,
        m
    );

    Ok(())
}

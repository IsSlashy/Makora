use anchor_lang::prelude::*;
use crate::state::{StrategyAccount, StrategyType, AllocationTarget};
use crate::errors::StrategyError;

#[derive(Accounts)]
pub struct UpdateStrategy<'info> {
    /// Signer must be owner OR agent_authority
    pub authority: Signer<'info>,

    /// Strategy PDA
    #[account(
        mut,
        seeds = [b"strategy", strategy_account.owner.as_ref()],
        bump = strategy_account.bump,
        constraint = strategy_account.is_authorized(authority.key) @ StrategyError::UnauthorizedStrategyUpdate
    )]
    pub strategy_account: Account<'info, StrategyAccount>,
}

pub fn handler(
    ctx: Context<UpdateStrategy>,
    strategy_type: u8,
    confidence_threshold: u8,
    max_actions_per_cycle: u8,
    alloc_symbols: Vec<[u8; 8]>,
    alloc_pcts: Vec<u8>,
) -> Result<()> {
    // Validate strategy type
    let st = StrategyType::from_u8(strategy_type)
        .map_err(|_| error!(StrategyError::InvalidStrategyType))?;

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

    // Update strategy account
    let strategy = &mut ctx.accounts.strategy_account;
    strategy.strategy_type = st;
    strategy.confidence_threshold = confidence_threshold;
    strategy.max_actions_per_cycle = max_actions_per_cycle;
    strategy.target_allocation = target_allocation;
    strategy.allocation_count = alloc_symbols.len() as u8;
    strategy.total_cycles = strategy.total_cycles.checked_add(1).unwrap_or(u64::MAX);
    strategy.last_cycle_at = clock.unix_timestamp;

    msg!(
        "Strategy updated to {:?} by {}",
        st,
        ctx.accounts.authority.key()
    );

    Ok(())
}

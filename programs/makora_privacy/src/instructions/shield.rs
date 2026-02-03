use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::ShieldedPool;
use crate::errors::PrivacyError;

#[derive(Accounts)]
pub struct Shield<'info> {
    #[account(
        mut,
        seeds = [b"pool", pool.authority.as_ref()],
        bump = pool.bump,
        constraint = pool.is_active @ PrivacyError::PoolNotActive
    )]
    pub pool: Account<'info, ShieldedPool>,

    #[account(mut)]
    pub depositor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Shield>,
    amount: u64,
    commitment: [u8; 32],
) -> Result<()> {
    require!(amount > 0, PrivacyError::InvalidAmount);

    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    // Transfer SOL to pool PDA
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.depositor.to_account_info(),
                to: pool.to_account_info(),
            },
        ),
        amount,
    )?;

    // Update pool state
    pool.total_shielded = pool.total_shielded
        .checked_add(amount)
        .ok_or(PrivacyError::InvalidAmount)?;

    pool.next_leaf_index = pool.next_leaf_index
        .checked_add(1)
        .ok_or(PrivacyError::InvalidAmount)?;

    pool.last_tx_at = clock.unix_timestamp;

    // Emit commitment as event (in real ZK system, this would be added to merkle tree)
    msg!(
        "Shield deposit: {} lamports | leaf_index: {} | commitment: {:?}",
        amount,
        pool.next_leaf_index - 1,
        commitment
    );

    Ok(())
}

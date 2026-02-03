use anchor_lang::prelude::*;
use crate::state::ShieldedPool;

#[derive(Accounts)]
pub struct InitPool<'info> {
    #[account(
        init,
        payer = authority,
        space = ShieldedPool::SIZE,
        seeds = [b"pool", authority.key().as_ref()],
        bump
    )]
    pub pool: Account<'info, ShieldedPool>,

    #[account(mut)]
    pub authority: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitPool>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    let clock = Clock::get()?;

    pool.authority = ctx.accounts.authority.key();
    pool.merkle_root = [0u8; 32];
    pool.next_leaf_index = 0;
    pool.total_shielded = 0;
    pool.is_active = true;
    pool.created_at = clock.unix_timestamp;
    pool.last_tx_at = clock.unix_timestamp;
    pool.bump = ctx.bumps.pool;
    pool._padding = [0u8; 32];

    msg!("Shielded pool initialized by authority: {}", ctx.accounts.authority.key());

    Ok(())
}

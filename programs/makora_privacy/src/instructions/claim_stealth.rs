use anchor_lang::prelude::*;
use crate::state::StealthAccount;
use crate::errors::PrivacyError;

#[derive(Accounts)]
pub struct ClaimStealth<'info> {
    #[account(
        mut,
        seeds = [b"stealth", stealth_account.stealth_address.as_ref()],
        bump = stealth_account.bump,
        constraint = !stealth_account.claimed @ PrivacyError::AlreadyClaimed
    )]
    pub stealth_account: Account<'info, StealthAccount>,

    #[account(mut)]
    pub recipient: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ClaimStealth>) -> Result<()> {
    let amount = ctx.accounts.stealth_account.amount;

    require!(amount > 0, PrivacyError::InvalidAmount);

    // Get account infos before mutating
    let stealth_account_info = ctx.accounts.stealth_account.to_account_info();
    let recipient_info = ctx.accounts.recipient.to_account_info();

    // Transfer lamports from PDA to recipient
    **stealth_account_info.try_borrow_mut_lamports()? = stealth_account_info
        .lamports()
        .checked_sub(amount)
        .ok_or(PrivacyError::InsufficientPoolBalance)?;

    **recipient_info.try_borrow_mut_lamports()? = recipient_info
        .lamports()
        .checked_add(amount)
        .ok_or(PrivacyError::InvalidAmount)?;

    // Mark as claimed
    ctx.accounts.stealth_account.claimed = true;

    msg!("Stealth payment claimed: {} lamports", amount);

    Ok(())
}

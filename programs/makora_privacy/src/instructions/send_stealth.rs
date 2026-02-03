use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::StealthAccount;
use crate::errors::PrivacyError;

#[derive(Accounts)]
#[instruction(stealth_address: [u8; 32])]
pub struct SendStealth<'info> {
    #[account(
        init,
        payer = sender,
        space = StealthAccount::SIZE,
        seeds = [b"stealth", stealth_address.as_ref()],
        bump
    )]
    pub stealth_account: Account<'info, StealthAccount>,

    #[account(mut)]
    pub sender: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<SendStealth>,
    stealth_address: [u8; 32],
    ephemeral_pubkey: [u8; 32],
    view_tag: u8,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, PrivacyError::InvalidAmount);

    let stealth_account = &mut ctx.accounts.stealth_account;
    let clock = Clock::get()?;

    // Initialize stealth account
    stealth_account.sender = ctx.accounts.sender.key();
    stealth_account.stealth_address = stealth_address;
    stealth_account.ephemeral_pubkey = ephemeral_pubkey;
    stealth_account.view_tag = view_tag;
    stealth_account.amount = amount;
    stealth_account.claimed = false;
    stealth_account.created_at = clock.unix_timestamp;
    stealth_account.bump = ctx.bumps.stealth_account;

    // Transfer SOL to the stealth account PDA (holds the funds in escrow)
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.sender.to_account_info(),
                to: ctx.accounts.stealth_account.to_account_info(),
            },
        ),
        amount,
    )?;

    msg!(
        "Stealth payment created: {} lamports to stealth address (view_tag: {})",
        amount,
        view_tag
    );

    Ok(())
}

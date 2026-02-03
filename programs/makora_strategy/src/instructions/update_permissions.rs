use anchor_lang::prelude::*;
use crate::state::{StrategyAccount, AgentMode};
use crate::errors::StrategyError;

#[derive(Accounts)]
pub struct UpdatePermissions<'info> {
    /// ONLY the owner can update permissions (not the agent)
    pub owner: Signer<'info>,

    /// Strategy PDA
    #[account(
        mut,
        seeds = [b"strategy", strategy_account.owner.as_ref()],
        bump = strategy_account.bump,
        has_one = owner @ StrategyError::UnauthorizedPermissionsUpdate
    )]
    pub strategy_account: Account<'info, StrategyAccount>,
}

pub fn handler(
    ctx: Context<UpdatePermissions>,
    new_agent_authority: Pubkey,
    new_mode: u8,
) -> Result<()> {
    let mode = AgentMode::from_u8(new_mode)
        .map_err(|_| error!(StrategyError::InvalidAgentMode))?;

    let strategy = &mut ctx.accounts.strategy_account;
    strategy.agent_authority = new_agent_authority;
    strategy.mode = mode;

    msg!(
        "Permissions updated: agent_authority={}, mode={:?}",
        new_agent_authority,
        mode
    );

    Ok(())
}

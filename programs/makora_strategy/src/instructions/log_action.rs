use anchor_lang::prelude::*;
use crate::state::{StrategyAccount, AuditTrail, AuditEntry};
use crate::errors::StrategyError;

#[derive(Accounts)]
pub struct LogAction<'info> {
    /// Signer must be owner OR agent_authority
    pub authority: Signer<'info>,

    /// Strategy PDA (for authorization check)
    #[account(
        mut,
        seeds = [b"strategy", strategy_account.owner.as_ref()],
        bump = strategy_account.bump,
        constraint = strategy_account.is_authorized(authority.key) @ StrategyError::UnauthorizedLogAction
    )]
    pub strategy_account: Account<'info, StrategyAccount>,

    /// Audit trail PDA
    #[account(
        mut,
        seeds = [b"audit", strategy_account.owner.as_ref()],
        bump = audit_trail.bump,
        has_one = owner @ StrategyError::UnauthorizedLogAction
    )]
    pub audit_trail: Box<Account<'info, AuditTrail>>,

    /// CHECK: Owner pubkey for the has_one constraint on audit_trail.
    /// Not a signer -- the authority signer provides the authorization.
    pub owner: UncheckedAccount<'info>,
}

pub fn handler(
    ctx: Context<LogAction>,
    action_type: String,
    protocol: String,
    description: String,
    executed: bool,
    success: bool,
) -> Result<()> {
    // Validate string lengths
    require!(action_type.len() <= 16, StrategyError::ActionTypeTooLong);
    require!(protocol.len() <= 16, StrategyError::ProtocolTooLong);
    require!(description.len() <= 64, StrategyError::DescriptionTooLong);

    let clock = Clock::get()?;

    // Create audit entry
    let audit = &mut ctx.accounts.audit_trail;
    let entry = AuditEntry::new(
        audit.count,
        &action_type,
        &protocol,
        &description,
        executed,
        success,
        clock.unix_timestamp,
    );

    // Append to ring buffer
    audit.append(entry);

    // Update strategy account counters
    let strategy = &mut ctx.accounts.strategy_account;
    if executed {
        strategy.total_actions_executed = strategy
            .total_actions_executed
            .checked_add(1)
            .unwrap_or(u64::MAX);
    }
    strategy.last_cycle_at = clock.unix_timestamp;

    msg!(
        "Logged action: {} via {} (executed: {}, success: {})",
        action_type,
        protocol,
        executed,
        success
    );

    Ok(())
}

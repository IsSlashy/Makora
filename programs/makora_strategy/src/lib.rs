use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("EH5sixTHAoLsdFox1bR3YUqgwf5VuX2BdXFew5wTE6dj");

#[program]
pub mod makora_strategy {
    use super::*;

    /// Initialize a strategy account and audit trail for a user.
    /// Creates two PDAs:
    ///   - StrategyAccount: seeds = ["strategy", owner]
    ///   - AuditTrail: seeds = ["audit", owner]
    pub fn initialize(
        ctx: Context<Initialize>,
        agent_authority: Pubkey,
        strategy_type: u8,
        mode: u8,
        confidence_threshold: u8,
        max_actions_per_cycle: u8,
        alloc_symbols: Vec<[u8; 8]>,
        alloc_pcts: Vec<u8>,
    ) -> Result<()> {
        instructions::initialize::handler(
            ctx,
            agent_authority,
            strategy_type,
            mode,
            confidence_threshold,
            max_actions_per_cycle,
            alloc_symbols,
            alloc_pcts,
        )
    }

    /// Update the active strategy and target allocation.
    /// Callable by owner OR agent_authority.
    pub fn update_strategy(
        ctx: Context<UpdateStrategy>,
        strategy_type: u8,
        confidence_threshold: u8,
        max_actions_per_cycle: u8,
        alloc_symbols: Vec<[u8; 8]>,
        alloc_pcts: Vec<u8>,
    ) -> Result<()> {
        instructions::update_strategy::handler(
            ctx,
            strategy_type,
            confidence_threshold,
            max_actions_per_cycle,
            alloc_symbols,
            alloc_pcts,
        )
    }

    /// Log an agent action to the audit trail.
    /// Callable by owner OR agent_authority.
    pub fn log_action(
        ctx: Context<LogAction>,
        action_type: String,
        protocol: String,
        description: String,
        executed: bool,
        success: bool,
    ) -> Result<()> {
        instructions::log_action::handler(
            ctx,
            action_type,
            protocol,
            description,
            executed,
            success,
        )
    }

    /// Update agent permissions (authority key, mode).
    /// ONLY callable by the owner (not the agent).
    pub fn update_permissions(
        ctx: Context<UpdatePermissions>,
        new_agent_authority: Pubkey,
        new_mode: u8,
    ) -> Result<()> {
        instructions::update_permissions::handler(
            ctx,
            new_agent_authority,
            new_mode,
        )
    }
}

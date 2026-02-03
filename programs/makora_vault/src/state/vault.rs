use anchor_lang::prelude::*;

/// Agent operating mode
/// 0 = Advisory (suggest only, user confirms)
/// 1 = Auto (execute within risk limits)
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum AgentMode {
    Advisory = 0,
    Auto = 1,
}

impl Default for AgentMode {
    fn default() -> Self {
        AgentMode::Advisory
    }
}

impl AgentMode {
    pub fn from_u8(val: u8) -> Result<Self> {
        match val {
            0 => Ok(AgentMode::Advisory),
            1 => Ok(AgentMode::Auto),
            _ => Err(error!(crate::errors::VaultError::InvalidAgentMode)),
        }
    }
}

/// On-chain risk limits stored in the vault PDA.
/// These are enforced by the agent's risk manager off-chain,
/// but stored on-chain for auditability and transparency.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default)]
pub struct RiskLimits {
    /// Maximum position size as percentage of portfolio (0-100)
    pub max_position_size_pct: u8,
    /// Maximum slippage in basis points (e.g., 100 = 1%)
    pub max_slippage_bps: u16,
    /// Maximum daily loss as percentage of portfolio (0-100)
    pub max_daily_loss_pct: u8,
    /// Minimum SOL to keep for rent/gas (in lamports)
    pub min_sol_reserve: u64,
    /// Maximum exposure to any single protocol (0-100)
    pub max_protocol_exposure_pct: u8,
}

/// Vault PDA account.
///
/// Seeds: ["vault", owner_pubkey]
/// One vault per user. Stores agent configuration and tracks fund flows.
///
/// Size calculation:
///   discriminator: 8
///   owner: 32
///   agent_authority: 32
///   total_deposited: 8
///   total_withdrawn: 8
///   mode: 1
///   risk_limits: 1 + 2 + 1 + 8 + 1 = 13
///   created_at: 8
///   last_action_at: 8
///   bump: 1
///   in_session_amount: 8
///   _padding: 24 (reserved for future fields)
///   TOTAL: 8 + 32 + 32 + 8 + 8 + 1 + 13 + 8 + 8 + 1 + 8 + 24 = 151
///   Round up to 160 for safety
#[account]
pub struct Vault {
    /// The wallet owner who created this vault
    pub owner: Pubkey,

    /// The agent's signing authority (can execute on behalf of vault in auto mode)
    pub agent_authority: Pubkey,

    /// Total SOL deposited into this vault (lamports, cumulative)
    pub total_deposited: u64,

    /// Total SOL withdrawn from this vault (lamports, cumulative)
    pub total_withdrawn: u64,

    /// Agent operating mode (0 = advisory, 1 = auto)
    pub mode: AgentMode,

    /// Risk limits for the agent
    pub risk_limits: RiskLimits,

    /// Unix timestamp when this vault was created
    pub created_at: i64,

    /// Unix timestamp of the last deposit/withdraw action
    pub last_action_at: i64,

    /// PDA bump seed
    pub bump: u8,

    /// SOL currently out in active stealth sessions (lamports)
    pub in_session_amount: u64,

    /// Reserved space for future upgrades (avoid realloc)
    pub _padding: [u8; 24],
}

impl Vault {
    /// Account size for space allocation (includes discriminator)
    /// in_session_amount uses 8 bytes from the former 32-byte _padding,
    /// so total stays at 160 bytes.
    pub const SIZE: usize = 8 + // discriminator
        32 +  // owner
        32 +  // agent_authority
        8 +   // total_deposited
        8 +   // total_withdrawn
        1 +   // mode
        13 +  // risk_limits (1+2+1+8+1)
        8 +   // created_at
        8 +   // last_action_at
        1 +   // bump
        8 +   // in_session_amount
        24;   // _padding (was 32, now 24 after in_session_amount)

    /// Current vault balance available for new operations.
    /// Excludes SOL currently out in stealth sessions.
    pub fn current_balance(&self) -> u64 {
        self.total_deposited
            .saturating_sub(self.total_withdrawn)
            .saturating_sub(self.in_session_amount)
    }
}

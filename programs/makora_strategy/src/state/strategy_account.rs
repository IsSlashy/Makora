use anchor_lang::prelude::*;

/// Strategy type enum (matches TypeScript StrategyType)
/// 0 = yield, 1 = trading, 2 = rebalance, 3 = liquidity
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum StrategyType {
    Yield = 0,
    Trading = 1,
    Rebalance = 2,
    Liquidity = 3,
}

impl Default for StrategyType {
    fn default() -> Self {
        StrategyType::Yield
    }
}

impl StrategyType {
    pub fn from_u8(val: u8) -> std::result::Result<Self, ()> {
        match val {
            0 => Ok(StrategyType::Yield),
            1 => Ok(StrategyType::Trading),
            2 => Ok(StrategyType::Rebalance),
            3 => Ok(StrategyType::Liquidity),
            _ => Err(()),
        }
    }
}

/// Agent mode (advisory or auto) -- mirrors vault program
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
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
    pub fn from_u8(val: u8) -> std::result::Result<Self, ()> {
        match val {
            0 => Ok(AgentMode::Advisory),
            1 => Ok(AgentMode::Auto),
            _ => Err(()),
        }
    }
}

/// Target allocation for a single token (symbol + percentage)
/// Fixed-size for predictable account layout.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug)]
pub struct AllocationTarget {
    /// Token symbol (e.g., "SOL", "mSOL", "USDC"), padded to 8 bytes
    pub symbol: [u8; 8],
    /// Target percentage (0-100)
    pub target_pct: u8,
}

impl AllocationTarget {
    pub fn new(symbol: &str, target_pct: u8) -> Self {
        let mut s = [0u8; 8];
        let bytes = symbol.as_bytes();
        let len = bytes.len().min(8);
        s[..len].copy_from_slice(&bytes[..len]);
        Self { symbol: s, target_pct }
    }

    pub fn symbol_str(&self) -> String {
        let end = self.symbol.iter().position(|&b| b == 0).unwrap_or(8);
        String::from_utf8_lossy(&self.symbol[..end]).to_string()
    }

    pub fn is_empty(&self) -> bool {
        self.target_pct == 0 && self.symbol[0] == 0
    }
}

/// Strategy Account PDA
///
/// Seeds: ["strategy", owner_pubkey]
/// One per user. Stores the active strategy configuration and agent permissions.
///
/// Size calculation:
///   discriminator: 8
///   owner: 32
///   agent_authority: 32
///   strategy_type: 1
///   mode: 1
///   confidence_threshold: 1
///   max_actions_per_cycle: 1
///   target_allocation: 5 * (8 + 1) = 45  (5 slots, 9 bytes each)
///   allocation_count: 1
///   total_cycles: 8
///   total_actions_executed: 8
///   last_cycle_at: 8
///   created_at: 8
///   bump: 1
///   _padding: 32
///   TOTAL: 8 + 32 + 32 + 1 + 1 + 1 + 1 + 45 + 1 + 8 + 8 + 8 + 8 + 1 + 32 = 187
///   Round up to 200 for safety
#[account]
pub struct StrategyAccount {
    /// The wallet owner (same as vault owner)
    pub owner: Pubkey,

    /// The agent's signing authority (can execute strategy updates)
    pub agent_authority: Pubkey,

    /// Active strategy type
    pub strategy_type: StrategyType,

    /// Agent operating mode
    pub mode: AgentMode,

    /// Minimum confidence threshold for action proposals (0-100)
    pub confidence_threshold: u8,

    /// Maximum actions per OODA cycle
    pub max_actions_per_cycle: u8,

    /// Target allocation (up to 5 tokens)
    pub target_allocation: [AllocationTarget; 5],

    /// How many of the 5 allocation slots are in use
    pub allocation_count: u8,

    /// Total OODA cycles executed
    pub total_cycles: u64,

    /// Total actions executed on-chain
    pub total_actions_executed: u64,

    /// Unix timestamp of last OODA cycle
    pub last_cycle_at: i64,

    /// Unix timestamp when this account was created
    pub created_at: i64,

    /// PDA bump seed
    pub bump: u8,

    /// Reserved space for future upgrades
    pub _padding: [u8; 32],
}

impl StrategyAccount {
    /// Account size for space allocation (includes discriminator)
    pub const SIZE: usize = 8 +   // discriminator
        32 +  // owner
        32 +  // agent_authority
        1 +   // strategy_type
        1 +   // mode
        1 +   // confidence_threshold
        1 +   // max_actions_per_cycle
        45 +  // target_allocation (5 * 9)
        1 +   // allocation_count
        8 +   // total_cycles
        8 +   // total_actions_executed
        8 +   // last_cycle_at
        8 +   // created_at
        1 +   // bump
        32;   // _padding

    /// Check if a pubkey is authorized to update strategy
    pub fn is_authorized(&self, signer: &Pubkey) -> bool {
        *signer == self.owner || *signer == self.agent_authority
    }
}

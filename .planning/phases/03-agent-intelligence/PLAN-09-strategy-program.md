---
phase: 03-agent-intelligence
plan: 09
type: execute
wave: 2
depends_on: [07, 08]
files_modified:
  - programs/makora_strategy/Cargo.toml
  - programs/makora_strategy/Xargo.toml
  - programs/makora_strategy/src/lib.rs
  - programs/makora_strategy/src/state/mod.rs
  - programs/makora_strategy/src/state/strategy_account.rs
  - programs/makora_strategy/src/state/audit_entry.rs
  - programs/makora_strategy/src/instructions/mod.rs
  - programs/makora_strategy/src/instructions/initialize.rs
  - programs/makora_strategy/src/instructions/update_strategy.rs
  - programs/makora_strategy/src/instructions/log_action.rs
  - programs/makora_strategy/src/instructions/update_permissions.rs
  - programs/makora_strategy/src/errors.rs
  - Anchor.toml
  - tests/strategy-program.test.ts
autonomous: true
must_haves:
  truths:
    - "`anchor build` compiles makora_strategy without errors"
    - "initialize instruction creates a strategy PDA with seeds=['strategy', owner]"
    - "update_strategy instruction updates strategy_type and target allocation on the PDA"
    - "log_action instruction appends an audit entry to the audit trail PDA"
    - "update_permissions instruction changes agent authority and mode"
    - "Only the vault owner can call update_permissions"
    - "Only the agent authority OR vault owner can call update_strategy"
    - "Only the agent authority OR vault owner can call log_action"
    - "All accounts use Anchor constraints (has_one, seeds, bump, constraint)"
    - "Integration test: initialize -> update_strategy -> log_action -> verify PDA state"
  artifacts:
    - target/deploy/makora_strategy.so
    - target/idl/makora_strategy.json
    - target/types/makora_strategy.ts
---

# Plan 09: Strategy Anchor Program + Integration Tests (programs/makora_strategy)

## Objective

Build the on-chain strategy program (PROG-02) that stores strategy parameters, agent permissions, and an audit trail on-chain. This program provides on-chain transparency and auditability for the agent's decisions -- critical for hackathon judging.

After this plan completes:
- A `StrategyAccount` PDA stores the active strategy type, target allocation, and agent permissions
- An `AuditTrail` PDA stores a ring buffer of the last 32 agent actions for on-chain auditability
- Integration tests verify the full flow: initialize -> update strategy -> log action -> read state
- The program links to the existing vault program (owner and agent authority are shared)

## Context

- **Vault program reference**: `programs/makora_vault` (Plan 02) establishes the pattern: PDA with seeds, Anchor constraints on every account, owner/agent_authority separation. This program follows the exact same patterns.
- **On-chain vs off-chain**: The strategy engine (Plan 07) runs off-chain and produces decisions. This program stores the results on-chain for transparency. The agent core (Plan 08) calls `log_action` after every execution.
- **Account relationship**: StrategyAccount references the Vault by owner. The same `owner` and `agent_authority` keypairs are used. If a vault exists for an owner, the strategy account shares its authority model.
- **Size constraints**: Solana accounts have a 10MB max, but rent is expensive. We use a fixed-size ring buffer (32 entries) for the audit trail to keep rent reasonable (~0.01 SOL).
- **Anchor version**: 0.30.1 (matching makora_vault). Uses `anchor-lang` and `anchor-spl`.

## Tasks

### Task 1: Cargo Configuration

**File: `P:\solana-agent-hackathon\programs\makora_strategy\Cargo.toml`**

```toml
[package]
name = "makora_strategy"
version = "0.1.0"
description = "Makora Strategy - On-chain strategy params, permissions, and audit trail"
edition = "2021"
rust-version = "1.75"

[lib]
crate-type = ["cdylib", "lib"]
name = "makora_strategy"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []

[dependencies]
anchor-lang = { version = "0.30.1", features = ["init-if-needed"] }
anchor-spl = "0.30.1"
```

**File: `P:\solana-agent-hackathon\programs\makora_strategy\Xargo.toml`**

```toml
[target.bpfel-unknown-unknown.dependencies.std]
features = []
```

### Task 2: Error Codes

**File: `P:\solana-agent-hackathon\programs\makora_strategy\src\errors.rs`**

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum StrategyError {
    #[msg("Invalid strategy type. Must be 0 (yield), 1 (trading), 2 (rebalance), or 3 (liquidity).")]
    InvalidStrategyType,

    #[msg("Invalid allocation: target percentages must sum to 100.")]
    InvalidAllocationSum,

    #[msg("Invalid allocation: individual percentage must be 0-100.")]
    InvalidAllocationEntry,

    #[msg("Unauthorized: only the owner can update permissions.")]
    UnauthorizedPermissionsUpdate,

    #[msg("Unauthorized: only the owner or agent authority can update strategy.")]
    UnauthorizedStrategyUpdate,

    #[msg("Unauthorized: only the owner or agent authority can log actions.")]
    UnauthorizedLogAction,

    #[msg("Invalid agent mode. Must be 0 (advisory) or 1 (auto).")]
    InvalidAgentMode,

    #[msg("Audit trail is full. This should never happen (ring buffer).")]
    AuditTrailFull,

    #[msg("Description too long. Maximum 64 bytes.")]
    DescriptionTooLong,

    #[msg("Action type too long. Maximum 16 bytes.")]
    ActionTypeTooLong,

    #[msg("Protocol name too long. Maximum 16 bytes.")]
    ProtocolTooLong,
}
```

### Task 3: State — Strategy Account

**File: `P:\solana-agent-hackathon\programs\makora_strategy\src\state\strategy_account.rs`**

```rust
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

/// Agent mode (advisory or auto) — mirrors vault program
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
```

### Task 4: State — Audit Entry

**File: `P:\solana-agent-hackathon\programs\makora_strategy\src\state\audit_entry.rs`**

```rust
use anchor_lang::prelude::*;

/// A single audit log entry for an agent action.
/// Fixed-size for ring buffer storage.
///
/// Size: 4 + 16 + 16 + 64 + 1 + 1 + 8 = 110 bytes per entry
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug)]
pub struct AuditEntry {
    /// Entry index (monotonically increasing)
    pub index: u32,

    /// Action type (e.g., "swap", "stake"), padded to 16 bytes
    pub action_type: [u8; 16],

    /// Protocol used (e.g., "jupiter", "marinade"), padded to 16 bytes
    pub protocol: [u8; 16],

    /// Description, padded to 64 bytes
    pub description: [u8; 64],

    /// Whether the action was executed (vs. just proposed)
    pub executed: bool,

    /// Whether the action succeeded
    pub success: bool,

    /// Unix timestamp
    pub timestamp: i64,
}

impl AuditEntry {
    pub const SIZE: usize = 4 + 16 + 16 + 64 + 1 + 1 + 8;

    pub fn new(
        index: u32,
        action_type: &str,
        protocol: &str,
        description: &str,
        executed: bool,
        success: bool,
        timestamp: i64,
    ) -> Self {
        let mut at = [0u8; 16];
        let at_bytes = action_type.as_bytes();
        let at_len = at_bytes.len().min(16);
        at[..at_len].copy_from_slice(&at_bytes[..at_len]);

        let mut pr = [0u8; 16];
        let pr_bytes = protocol.as_bytes();
        let pr_len = pr_bytes.len().min(16);
        pr[..pr_len].copy_from_slice(&pr_bytes[..pr_len]);

        let mut desc = [0u8; 64];
        let desc_bytes = description.as_bytes();
        let desc_len = desc_bytes.len().min(64);
        desc[..desc_len].copy_from_slice(&desc_bytes[..desc_len]);

        Self {
            index,
            action_type: at,
            protocol: pr,
            description: desc,
            executed,
            success,
            timestamp,
        }
    }

    pub fn action_type_str(&self) -> String {
        let end = self.action_type.iter().position(|&b| b == 0).unwrap_or(16);
        String::from_utf8_lossy(&self.action_type[..end]).to_string()
    }

    pub fn protocol_str(&self) -> String {
        let end = self.protocol.iter().position(|&b| b == 0).unwrap_or(16);
        String::from_utf8_lossy(&self.protocol[..end]).to_string()
    }

    pub fn description_str(&self) -> String {
        let end = self.description.iter().position(|&b| b == 0).unwrap_or(64);
        String::from_utf8_lossy(&self.description[..end]).to_string()
    }
}

/// Ring buffer capacity for audit entries
pub const AUDIT_TRAIL_CAPACITY: usize = 32;

/// Audit Trail PDA
///
/// Seeds: ["audit", owner_pubkey]
/// Stores the last 32 agent actions as a ring buffer.
///
/// Size calculation:
///   discriminator: 8
///   owner: 32
///   head: 4
///   count: 4
///   entries: 32 * 110 = 3520
///   bump: 1
///   TOTAL: 8 + 32 + 4 + 4 + 3520 + 1 = 3569
///   Round up to 3600 for safety
#[account]
pub struct AuditTrail {
    /// The wallet owner
    pub owner: Pubkey,

    /// Index of the next write position (wraps around at AUDIT_TRAIL_CAPACITY)
    pub head: u32,

    /// Total number of entries written (can exceed AUDIT_TRAIL_CAPACITY)
    pub count: u32,

    /// Ring buffer of audit entries
    pub entries: [AuditEntry; AUDIT_TRAIL_CAPACITY],

    /// PDA bump seed
    pub bump: u8,
}

impl AuditTrail {
    pub const SIZE: usize = 8 +    // discriminator
        32 +                         // owner
        4 +                          // head
        4 +                          // count
        (AuditEntry::SIZE * AUDIT_TRAIL_CAPACITY) + // entries
        1;                           // bump

    /// Append an entry to the ring buffer.
    /// Overwrites the oldest entry when full.
    pub fn append(&mut self, entry: AuditEntry) {
        let idx = (self.head as usize) % AUDIT_TRAIL_CAPACITY;
        self.entries[idx] = entry;
        self.head = self.head.wrapping_add(1);
        self.count = self.count.saturating_add(1);
    }

    /// Get the most recent N entries (newest first).
    pub fn recent(&self, n: usize) -> Vec<&AuditEntry> {
        let effective_count = (self.count as usize).min(AUDIT_TRAIL_CAPACITY);
        let take = n.min(effective_count);
        let mut result = Vec::with_capacity(take);

        for i in 0..take {
            // Walk backwards from head
            let idx = if self.head as usize > i {
                (self.head as usize - 1 - i) % AUDIT_TRAIL_CAPACITY
            } else {
                (AUDIT_TRAIL_CAPACITY + self.head as usize - 1 - i) % AUDIT_TRAIL_CAPACITY
            };
            result.push(&self.entries[idx]);
        }

        result
    }
}
```

### Task 5: State Module

**File: `P:\solana-agent-hackathon\programs\makora_strategy\src\state\mod.rs`**

```rust
pub mod strategy_account;
pub mod audit_entry;

pub use strategy_account::*;
pub use audit_entry::*;
```

### Task 6: Instructions — Initialize

**File: `P:\solana-agent-hackathon\programs\makora_strategy\src\instructions\initialize.rs`**

```rust
use anchor_lang::prelude::*;
use crate::state::{StrategyAccount, StrategyType, AgentMode, AllocationTarget, AuditTrail};
use crate::errors::StrategyError;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The wallet owner creating the strategy account
    #[account(mut)]
    pub owner: Signer<'info>,

    /// Strategy PDA: seeds = ["strategy", owner]
    #[account(
        init,
        payer = owner,
        space = StrategyAccount::SIZE,
        seeds = [b"strategy", owner.key().as_ref()],
        bump
    )]
    pub strategy_account: Account<'info, StrategyAccount>,

    /// Audit trail PDA: seeds = ["audit", owner]
    #[account(
        init,
        payer = owner,
        space = AuditTrail::SIZE,
        seeds = [b"audit", owner.key().as_ref()],
        bump
    )]
    pub audit_trail: Account<'info, AuditTrail>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Initialize>,
    agent_authority: Pubkey,
    strategy_type: u8,
    mode: u8,
    confidence_threshold: u8,
    max_actions_per_cycle: u8,
    // Target allocation: up to 5 (symbol, pct) pairs
    // Passed as parallel arrays for Anchor compatibility
    alloc_symbols: Vec<[u8; 8]>,
    alloc_pcts: Vec<u8>,
) -> Result<()> {
    // Validate strategy type
    let st = StrategyType::from_u8(strategy_type)
        .map_err(|_| error!(StrategyError::InvalidStrategyType))?;

    // Validate mode
    let m = AgentMode::from_u8(mode)
        .map_err(|_| error!(StrategyError::InvalidAgentMode))?;

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

    // Initialize strategy account
    let strategy = &mut ctx.accounts.strategy_account;
    strategy.owner = ctx.accounts.owner.key();
    strategy.agent_authority = agent_authority;
    strategy.strategy_type = st;
    strategy.mode = m;
    strategy.confidence_threshold = confidence_threshold;
    strategy.max_actions_per_cycle = max_actions_per_cycle;
    strategy.target_allocation = target_allocation;
    strategy.allocation_count = alloc_symbols.len() as u8;
    strategy.total_cycles = 0;
    strategy.total_actions_executed = 0;
    strategy.last_cycle_at = clock.unix_timestamp;
    strategy.created_at = clock.unix_timestamp;
    strategy.bump = ctx.bumps.strategy_account;
    strategy._padding = [0u8; 32];

    // Initialize audit trail
    let audit = &mut ctx.accounts.audit_trail;
    audit.owner = ctx.accounts.owner.key();
    audit.head = 0;
    audit.count = 0;
    audit.entries = [Default::default(); 32];
    audit.bump = ctx.bumps.audit_trail;

    msg!(
        "Strategy account initialized for owner {} with strategy type {:?} in {:?} mode",
        ctx.accounts.owner.key(),
        st,
        m
    );

    Ok(())
}
```

### Task 7: Instructions — Update Strategy

**File: `P:\solana-agent-hackathon\programs\makora_strategy\src\instructions\update_strategy.rs`**

```rust
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
```

### Task 8: Instructions — Log Action

**File: `P:\solana-agent-hackathon\programs\makora_strategy\src\instructions\log_action.rs`**

```rust
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
    pub audit_trail: Account<'info, AuditTrail>,

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
```

### Task 9: Instructions — Update Permissions

**File: `P:\solana-agent-hackathon\programs\makora_strategy\src\instructions\update_permissions.rs`**

```rust
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
```

### Task 10: Instructions Module

**File: `P:\solana-agent-hackathon\programs\makora_strategy\src\instructions\mod.rs`**

```rust
pub mod initialize;
pub mod update_strategy;
pub mod log_action;
pub mod update_permissions;

pub use initialize::*;
pub use update_strategy::*;
pub use log_action::*;
pub use update_permissions::*;
```

### Task 11: Program Entry Point

**File: `P:\solana-agent-hackathon\programs\makora_strategy\src\lib.rs`**

```rust
use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("MKSTraTEGYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

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
```

### Task 12: Update Anchor.toml

Add the strategy program to the Anchor workspace. This file should already exist from Phase 1. Add the `makora_strategy` entry.

Append to the `[programs.localnet]` and `[programs.devnet]` sections:

```toml
# In [programs.localnet] section:
makora_strategy = "MKSTraTEGYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

# In [programs.devnet] section:
makora_strategy = "MKSTraTEGYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

NOTE: The program ID `MKSTraTEGYxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` is a placeholder. After the first `anchor build`, replace it with the actual generated keypair from `target/deploy/makora_strategy-keypair.json`:

```bash
solana-keygen pubkey target/deploy/makora_strategy-keypair.json
```

Then update both `lib.rs` and `Anchor.toml` with the real program ID.

### Task 13: Integration Test

**File: `P:\solana-agent-hackathon\tests\strategy-program.test.ts`**

```typescript
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { expect } from 'chai';
import type { MakoraStrategy } from '../target/types/makora_strategy';

describe('makora_strategy', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.MakoraStrategy as Program<MakoraStrategy>;
  const owner = provider.wallet as anchor.Wallet;
  const agentAuthority = Keypair.generate();

  let strategyPda: PublicKey;
  let strategyBump: number;
  let auditPda: PublicKey;
  let auditBump: number;

  before(async () => {
    // Derive PDAs
    [strategyPda, strategyBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('strategy'), owner.publicKey.toBuffer()],
      program.programId
    );

    [auditPda, auditBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('audit'), owner.publicKey.toBuffer()],
      program.programId
    );
  });

  // Helper to create a padded symbol
  function padSymbol(symbol: string): number[] {
    const bytes = Buffer.alloc(8);
    bytes.write(symbol);
    return Array.from(bytes);
  }

  it('initializes a strategy account', async () => {
    const allocSymbols = [
      padSymbol('SOL'),
      padSymbol('mSOL'),
      padSymbol('USDC'),
    ];
    const allocPcts = [50, 30, 20];

    await program.methods
      .initialize(
        agentAuthority.publicKey,
        0, // yield strategy
        0, // advisory mode
        40, // confidence threshold
        5,  // max actions per cycle
        allocSymbols,
        Buffer.from(allocPcts),
      )
      .accounts({
        owner: owner.publicKey,
        strategyAccount: strategyPda,
        auditTrail: auditPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // Verify strategy account
    const strategy = await program.account.strategyAccount.fetch(strategyPda);
    expect(strategy.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(strategy.agentAuthority.toBase58()).to.equal(agentAuthority.publicKey.toBase58());
    expect(strategy.strategyType).to.deep.equal({ yield: {} });
    expect(strategy.mode).to.deep.equal({ advisory: {} });
    expect(strategy.confidenceThreshold).to.equal(40);
    expect(strategy.maxActionsPerCycle).to.equal(5);
    expect(strategy.allocationCount).to.equal(3);
    expect(strategy.totalCycles.toNumber()).to.equal(0);
    expect(strategy.totalActionsExecuted.toNumber()).to.equal(0);

    // Verify audit trail
    const audit = await program.account.auditTrail.fetch(auditPda);
    expect(audit.owner.toBase58()).to.equal(owner.publicKey.toBase58());
    expect(audit.head).to.equal(0);
    expect(audit.count).to.equal(0);
  });

  it('updates strategy via owner', async () => {
    const newAllocSymbols = [
      padSymbol('SOL'),
      padSymbol('USDC'),
    ];
    const newAllocPcts = [60, 40];

    await program.methods
      .updateStrategy(
        2, // rebalance strategy
        50, // confidence threshold
        3,  // max actions per cycle
        newAllocSymbols,
        Buffer.from(newAllocPcts),
      )
      .accounts({
        authority: owner.publicKey,
        strategyAccount: strategyPda,
      })
      .rpc();

    const strategy = await program.account.strategyAccount.fetch(strategyPda);
    expect(strategy.strategyType).to.deep.equal({ rebalance: {} });
    expect(strategy.confidenceThreshold).to.equal(50);
    expect(strategy.allocationCount).to.equal(2);
    expect(strategy.totalCycles.toNumber()).to.equal(1);
  });

  it('updates strategy via agent authority', async () => {
    // Fund agent authority for signing
    const sig = await provider.connection.requestAirdrop(
      agentAuthority.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(sig);

    const allocSymbols = [
      padSymbol('SOL'),
      padSymbol('mSOL'),
      padSymbol('USDC'),
    ];
    const allocPcts = [50, 30, 20];

    await program.methods
      .updateStrategy(
        0, // yield strategy
        40,
        5,
        allocSymbols,
        Buffer.from(allocPcts),
      )
      .accounts({
        authority: agentAuthority.publicKey,
        strategyAccount: strategyPda,
      })
      .signers([agentAuthority])
      .rpc();

    const strategy = await program.account.strategyAccount.fetch(strategyPda);
    expect(strategy.strategyType).to.deep.equal({ yield: {} });
    expect(strategy.totalCycles.toNumber()).to.equal(2);
  });

  it('logs an action to the audit trail', async () => {
    await program.methods
      .logAction(
        'stake',
        'marinade',
        'Stake 5 SOL via Marinade for mSOL',
        true,
        true,
      )
      .accounts({
        authority: owner.publicKey,
        strategyAccount: strategyPda,
        auditTrail: auditPda,
        owner: owner.publicKey,
      })
      .rpc();

    const audit = await program.account.auditTrail.fetch(auditPda);
    expect(audit.count).to.equal(1);
    expect(audit.head).to.equal(1);

    // Check the entry at index 0
    const entry = audit.entries[0];
    expect(entry.executed).to.be.true;
    expect(entry.success).to.be.true;

    // Verify strategy counter incremented
    const strategy = await program.account.strategyAccount.fetch(strategyPda);
    expect(strategy.totalActionsExecuted.toNumber()).to.equal(1);
  });

  it('logs multiple actions (ring buffer)', async () => {
    // Log 3 more actions
    for (let i = 0; i < 3; i++) {
      await program.methods
        .logAction(
          'swap',
          'jupiter',
          `Swap ${i + 1} SOL to USDC`,
          true,
          i !== 2, // Third one fails
        )
        .accounts({
          authority: agentAuthority.publicKey,
          strategyAccount: strategyPda,
          auditTrail: auditPda,
          owner: owner.publicKey,
        })
        .signers([agentAuthority])
        .rpc();
    }

    const audit = await program.account.auditTrail.fetch(auditPda);
    expect(audit.count).to.equal(4); // 1 from previous + 3 new
    expect(audit.head).to.equal(4);

    // Verify last entry (index 3) was a failed swap
    const lastEntry = audit.entries[3];
    expect(lastEntry.executed).to.be.true;
    expect(lastEntry.success).to.be.false;
  });

  it('updates permissions (owner only)', async () => {
    const newAgent = Keypair.generate();

    await program.methods
      .updatePermissions(
        newAgent.publicKey,
        1, // auto mode
      )
      .accounts({
        owner: owner.publicKey,
        strategyAccount: strategyPda,
      })
      .rpc();

    const strategy = await program.account.strategyAccount.fetch(strategyPda);
    expect(strategy.agentAuthority.toBase58()).to.equal(newAgent.publicKey.toBase58());
    expect(strategy.mode).to.deep.equal({ auto: {} });
  });

  it('rejects permissions update from non-owner', async () => {
    const randomSigner = Keypair.generate();
    const sig = await provider.connection.requestAirdrop(
      randomSigner.publicKey,
      1_000_000_000
    );
    await provider.connection.confirmTransaction(sig);

    try {
      await program.methods
        .updatePermissions(
          randomSigner.publicKey,
          0,
        )
        .accounts({
          owner: randomSigner.publicKey,
          strategyAccount: strategyPda,
        })
        .signers([randomSigner])
        .rpc();

      expect.fail('Should have thrown an error');
    } catch (err: any) {
      // Should fail with constraint violation (has_one = owner)
      expect(err.toString()).to.include('Error');
    }
  });

  it('rejects invalid strategy type', async () => {
    try {
      await program.methods
        .updateStrategy(
          99, // invalid
          40,
          5,
          [],
          Buffer.from([]),
        )
        .accounts({
          authority: owner.publicKey,
          strategyAccount: strategyPda,
        })
        .rpc();

      expect.fail('Should have thrown an error');
    } catch (err: any) {
      expect(err.toString()).to.include('InvalidStrategyType');
    }
  });

  it('rejects allocation that does not sum to 100', async () => {
    const allocSymbols = [
      padSymbol('SOL'),
      padSymbol('USDC'),
    ];
    const allocPcts = [60, 60]; // Sum = 120, not 100

    try {
      await program.methods
        .updateStrategy(
          0,
          40,
          5,
          allocSymbols,
          Buffer.from(allocPcts),
        )
        .accounts({
          authority: owner.publicKey,
          strategyAccount: strategyPda,
        })
        .rpc();

      expect.fail('Should have thrown an error');
    } catch (err: any) {
      expect(err.toString()).to.include('InvalidAllocationSum');
    }
  });
});
```

### Task 14: Build and Test

```bash
cd P:\solana-agent-hackathon

# Build the strategy program
anchor build

# After build, get the real program ID:
# solana-keygen pubkey target/deploy/makora_strategy-keypair.json
# Then update the declare_id! in lib.rs and the program ID in Anchor.toml

# Rebuild with correct program ID
anchor build

# Run tests (requires local validator)
anchor test
```

## Verification

1. **Program compiles** -- `anchor build` succeeds and produces `target/deploy/makora_strategy.so`.
2. **IDL generated** -- `target/idl/makora_strategy.json` contains all 4 instructions (initialize, update_strategy, log_action, update_permissions).
3. **TypeScript types generated** -- `target/types/makora_strategy.ts` is present and importable.
4. **Initialize creates PDA** -- Strategy PDA at seeds `["strategy", owner]` is created with correct initial state.
5. **Audit trail PDA** -- Audit PDA at seeds `["audit", owner]` is created with empty ring buffer.
6. **Update strategy by owner** -- Owner can change strategy_type, allocation, and thresholds.
7. **Update strategy by agent** -- Agent authority can change strategy_type, allocation, and thresholds.
8. **Log action** -- log_action appends an AuditEntry to the ring buffer and increments counters.
9. **Permissions update owner-only** -- Only the owner can call update_permissions. Non-owner signers get a constraint error.
10. **Invalid strategy type rejected** -- Passing strategy_type=99 throws `InvalidStrategyType`.
11. **Invalid allocation rejected** -- Passing allocation percentages that don't sum to 100 throws `InvalidAllocationSum`.
12. **All accounts use Anchor constraints** -- Every instruction context uses `seeds`, `bump`, `has_one`, or `constraint` on every account.
13. **No warnings in build** -- `anchor build` produces no Rust warnings.

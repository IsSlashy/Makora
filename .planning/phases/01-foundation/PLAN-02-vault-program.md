---
phase: 01-foundation
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - programs/makora_vault/Cargo.toml
  - programs/makora_vault/Xargo.toml
  - programs/makora_vault/src/lib.rs
  - programs/makora_vault/src/instructions/mod.rs
  - programs/makora_vault/src/instructions/initialize.rs
  - programs/makora_vault/src/instructions/deposit.rs
  - programs/makora_vault/src/instructions/withdraw.rs
  - programs/makora_vault/src/state/mod.rs
  - programs/makora_vault/src/state/vault.rs
  - programs/makora_vault/src/errors.rs
  - Anchor.toml (update program ID after keygen)
autonomous: true
must_haves:
  truths:
    - "`anchor build` compiles makora_vault without errors"
    - "`anchor keys list` outputs the vault program ID"
    - "Program uses `has_one`, `seeds`, `bump`, and `constraint` on every account"
    - "`overflow-checks = true` is set in Cargo.toml release profile"
    - "All financial math uses checked arithmetic"
    - "Vault PDA uses seeds = [b\"vault\", owner.key().as_ref()]"
    - "Program deploys to localnet via `anchor deploy`"
  artifacts:
    - programs/makora_vault/src/lib.rs
    - programs/makora_vault/src/instructions/initialize.rs
    - programs/makora_vault/src/instructions/deposit.rs
    - programs/makora_vault/src/instructions/withdraw.rs
    - programs/makora_vault/src/state/vault.rs
    - programs/makora_vault/src/errors.rs
    - target/deploy/makora_vault.so
---

# Plan 02: Vault Anchor Program (PROG-01)

## Objective

Build the `makora_vault` Anchor program with `initialize`, `deposit`, and `withdraw` instructions. The vault is an on-chain escrow/treasury where users deposit funds for agent management. After this plan completes, `anchor build` succeeds and the program deploys to localnet.

## Context

- **Pattern reference**: P01's `specter` program structure -- `lib.rs` with `instructions/` and `state/` modules, handler pattern for each instruction.
- **Anchor version**: 0.30.1 (matches workspace Cargo.toml).
- **Security requirements (PROG-04)**: Every account must use Anchor constraints (`has_one`, `seeds`, `bump`, `constraint`). This is the #1 Solana exploit vector (Wormhole $325M loss).
- **Arithmetic safety**: All financial math uses `checked_*` operations. `overflow-checks = true` in release profile.
- **PDA seeds**: Vault PDA = `["vault", owner_pubkey]`. This ensures one vault per user.
- **Program name**: `makora_vault` (snake_case, matching Anchor convention).
- **This plan runs in parallel with Plan 01** (Wave 1). It only depends on the Cargo.toml workspace being present, which can be a minimal stub.

## Tasks

### Task 1: Program Cargo.toml

Create the program's Cargo.toml following P01's specter pattern exactly.

**File: `P:\solana-agent-hackathon\programs\makora_vault\Cargo.toml`**

```toml
[package]
name = "makora_vault"
version = "0.1.0"
description = "Makora Vault - On-chain escrow/treasury for agent-managed DeFi funds"
edition = "2021"
rust-version = "1.75"

[lib]
crate-type = ["cdylib", "lib"]
name = "makora_vault"

[features]
no-entrypoint = []
no-idl = []
no-log-ix-name = []
cpi = ["no-entrypoint"]
default = []

[dependencies]
anchor-lang = { version = "0.30.1", features = ["init-if-needed"] }
anchor-spl = "0.30.1"

[dev-dependencies]
solana-program-test = "1.18"
solana-sdk = "1.18"
tokio = { version = "1", features = ["full"] }
```

**File: `P:\solana-agent-hackathon\programs\makora_vault\Xargo.toml`**

```toml
[target.bpfel-unknown-unknown.dependencies.std]
features = []
```

### Task 2: Program Entry Point (lib.rs)

Define the program module with all three instructions. Follow P01's pattern of delegating to handler functions in the `instructions/` module.

**File: `P:\solana-agent-hackathon\programs\makora_vault\src\lib.rs`**

```rust
use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("MKRvau1tPKsZY7B8fZQGpuvqbVwEML3RCrgBJ4sSXkP");

#[program]
pub mod makora_vault {
    use super::*;

    /// Initialize a new vault for a user.
    /// Creates a PDA with seeds = ["vault", owner].
    /// The vault tracks deposits, withdrawals, agent mode, and risk limits.
    pub fn initialize(
        ctx: Context<Initialize>,
        agent_authority: Pubkey,
        mode: u8,
        max_position_size_pct: u8,
        max_slippage_bps: u16,
        max_daily_loss_pct: u8,
        min_sol_reserve: u64,
        max_protocol_exposure_pct: u8,
    ) -> Result<()> {
        instructions::initialize::handler(
            ctx,
            agent_authority,
            mode,
            max_position_size_pct,
            max_slippage_bps,
            max_daily_loss_pct,
            min_sol_reserve,
            max_protocol_exposure_pct,
        )
    }

    /// Deposit SOL into the vault.
    /// Only the vault owner can deposit.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        instructions::deposit::handler(ctx, amount)
    }

    /// Withdraw SOL from the vault.
    /// Only the vault owner can withdraw.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        instructions::withdraw::handler(ctx, amount)
    }
}
```

> **Note**: The `declare_id!()` macro uses a placeholder. After running `anchor keys list`, update this value in both `lib.rs` and `Anchor.toml`.

### Task 3: Vault State Account

Define the on-chain vault PDA structure.

**File: `P:\solana-agent-hackathon\programs\makora_vault\src\state\mod.rs`**

```rust
pub mod vault;

pub use vault::*;
```

**File: `P:\solana-agent-hackathon\programs\makora_vault\src\state\vault.rs`**

```rust
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
///   _padding: 32 (reserved for future fields)
///   TOTAL: 8 + 32 + 32 + 8 + 8 + 1 + 13 + 8 + 8 + 1 + 32 = 151
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

    /// Reserved space for future upgrades (avoid realloc)
    pub _padding: [u8; 32],
}

impl Vault {
    /// Account size for space allocation (includes discriminator)
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
        32;   // _padding

    /// Current vault balance (deposited minus withdrawn)
    pub fn current_balance(&self) -> u64 {
        // Use saturating_sub because total_withdrawn should never exceed total_deposited
        // but we protect against it anyway
        self.total_deposited.saturating_sub(self.total_withdrawn)
    }
}
```

### Task 4: Error Definitions

Define custom error codes for the vault program.

**File: `P:\solana-agent-hackathon\programs\makora_vault\src\errors.rs`**

```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    /// Deposit amount must be greater than zero
    #[msg("Deposit amount must be greater than zero")]
    ZeroDeposit,

    /// Withdraw amount must be greater than zero
    #[msg("Withdraw amount must be greater than zero")]
    ZeroWithdraw,

    /// Withdraw amount exceeds vault balance
    #[msg("Withdraw amount exceeds vault balance")]
    InsufficientBalance,

    /// Arithmetic overflow during balance calculation
    #[msg("Arithmetic overflow in balance calculation")]
    ArithmeticOverflow,

    /// Invalid agent mode value (must be 0 or 1)
    #[msg("Invalid agent mode (must be 0=advisory or 1=auto)")]
    InvalidAgentMode,

    /// Risk limit value is out of valid range
    #[msg("Risk limit value out of range")]
    InvalidRiskLimit,

    /// Unauthorized: signer is not the vault owner
    #[msg("Unauthorized: signer is not the vault owner")]
    Unauthorized,

    /// Vault is already initialized
    #[msg("Vault is already initialized for this owner")]
    AlreadyInitialized,

    /// Must keep minimum SOL reserve for rent and gas
    #[msg("Must keep minimum SOL reserve for rent and gas")]
    InsufficientReserve,
}
```

### Task 5: Instructions Module

**File: `P:\solana-agent-hackathon\programs\makora_vault\src\instructions\mod.rs`**

```rust
pub mod initialize;
pub mod deposit;
pub mod withdraw;

pub use initialize::*;
pub use deposit::*;
pub use withdraw::*;
```

### Task 6: Initialize Instruction

Creates the vault PDA for a user. Uses `init` constraint with seeds.

**File: `P:\solana-agent-hackathon\programs\makora_vault\src\instructions\initialize.rs`**

```rust
use anchor_lang::prelude::*;
use crate::state::{Vault, AgentMode, RiskLimits};
use crate::errors::VaultError;

#[derive(Accounts)]
pub struct Initialize<'info> {
    /// The user creating the vault (pays for account creation)
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The vault PDA to initialize
    /// Seeds: ["vault", owner_pubkey]
    /// Constraint: one vault per user, enforced by PDA derivation
    #[account(
        init,
        payer = owner,
        space = Vault::SIZE,
        seeds = [b"vault", owner.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, Vault>,

    /// System program for account creation
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Initialize>,
    agent_authority: Pubkey,
    mode: u8,
    max_position_size_pct: u8,
    max_slippage_bps: u16,
    max_daily_loss_pct: u8,
    min_sol_reserve: u64,
    max_protocol_exposure_pct: u8,
) -> Result<()> {
    // Validate agent mode
    let agent_mode = AgentMode::from_u8(mode)?;

    // Validate risk limits are within sane ranges
    require!(
        max_position_size_pct <= 100,
        VaultError::InvalidRiskLimit
    );
    require!(
        max_slippage_bps <= 10_000, // max 100%
        VaultError::InvalidRiskLimit
    );
    require!(
        max_daily_loss_pct <= 100,
        VaultError::InvalidRiskLimit
    );
    require!(
        max_protocol_exposure_pct <= 100,
        VaultError::InvalidRiskLimit
    );

    let vault = &mut ctx.accounts.vault;
    let clock = Clock::get()?;

    vault.owner = ctx.accounts.owner.key();
    vault.agent_authority = agent_authority;
    vault.total_deposited = 0;
    vault.total_withdrawn = 0;
    vault.mode = agent_mode;
    vault.risk_limits = RiskLimits {
        max_position_size_pct,
        max_slippage_bps,
        max_daily_loss_pct,
        min_sol_reserve,
        max_protocol_exposure_pct,
    };
    vault.created_at = clock.unix_timestamp;
    vault.last_action_at = clock.unix_timestamp;
    vault.bump = ctx.bumps.vault;
    vault._padding = [0u8; 32];

    msg!(
        "Vault initialized for owner {} with mode {:?}",
        vault.owner,
        mode
    );

    Ok(())
}
```

### Task 7: Deposit Instruction

Transfers SOL from the owner to the vault PDA. Uses checked arithmetic.

**File: `P:\solana-agent-hackathon\programs\makora_vault\src\instructions\deposit.rs`**

```rust
use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::Vault;
use crate::errors::VaultError;

#[derive(Accounts)]
pub struct Deposit<'info> {
    /// The vault owner making the deposit
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The vault PDA to deposit into
    /// Constraint: vault.owner must match the signer
    /// Seeds verify this is the correct vault for this owner
    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,

    /// System program for the SOL transfer
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Deposit>, amount: u64) -> Result<()> {
    // Validate amount
    require!(amount > 0, VaultError::ZeroDeposit);

    // Transfer SOL from owner to vault PDA
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.owner.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
            },
        ),
        amount,
    )?;

    // Update vault state with checked arithmetic
    let vault = &mut ctx.accounts.vault;
    vault.total_deposited = vault
        .total_deposited
        .checked_add(amount)
        .ok_or(VaultError::ArithmeticOverflow)?;

    let clock = Clock::get()?;
    vault.last_action_at = clock.unix_timestamp;

    msg!(
        "Deposited {} lamports into vault. Total deposited: {}",
        amount,
        vault.total_deposited
    );

    Ok(())
}
```

### Task 8: Withdraw Instruction

Transfers SOL from the vault PDA back to the owner. Uses PDA signer seeds for the CPI.

**File: `P:\solana-agent-hackathon\programs\makora_vault\src\instructions\withdraw.rs`**

```rust
use anchor_lang::prelude::*;
use crate::state::Vault;
use crate::errors::VaultError;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    /// The vault owner requesting the withdrawal
    #[account(mut)]
    pub owner: Signer<'info>,

    /// The vault PDA to withdraw from
    /// Constraint: vault.owner must match the signer
    /// Seeds verify this is the correct vault for this owner
    #[account(
        mut,
        seeds = [b"vault", owner.key().as_ref()],
        bump = vault.bump,
        has_one = owner @ VaultError::Unauthorized,
    )]
    pub vault: Account<'info, Vault>,

    /// System program (needed for lamport transfers via PDA)
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
    // Validate amount
    require!(amount > 0, VaultError::ZeroWithdraw);

    let vault = &mut ctx.accounts.vault;

    // Check that vault has sufficient balance
    let current_balance = vault.current_balance();
    require!(
        amount <= current_balance,
        VaultError::InsufficientBalance
    );

    // Check that withdrawal doesn't leave less than the minimum SOL reserve
    // (to keep the account alive and pay for future transactions)
    let remaining_after = current_balance
        .checked_sub(amount)
        .ok_or(VaultError::ArithmeticOverflow)?;

    let min_rent = Rent::get()?.minimum_balance(Vault::SIZE);
    let min_reserve = vault.risk_limits.min_sol_reserve;
    let total_min = min_rent
        .checked_add(min_reserve)
        .ok_or(VaultError::ArithmeticOverflow)?;

    // Only enforce reserve if user is not withdrawing everything
    // (full withdrawal = closing the vault effectively)
    if remaining_after > 0 {
        require!(
            remaining_after >= total_min,
            VaultError::InsufficientReserve
        );
    }

    // Transfer SOL from vault PDA to owner
    // For PDA-owned lamports, we directly manipulate lamport balances
    // This is safe because the vault account is a PDA we control
    let vault_info = vault.to_account_info();
    let owner_info = ctx.accounts.owner.to_account_info();

    **vault_info.try_borrow_mut_lamports()? -= amount;
    **owner_info.try_borrow_mut_lamports()? += amount;

    // Update vault state with checked arithmetic
    vault.total_withdrawn = vault
        .total_withdrawn
        .checked_add(amount)
        .ok_or(VaultError::ArithmeticOverflow)?;

    let clock = Clock::get()?;
    vault.last_action_at = clock.unix_timestamp;

    msg!(
        "Withdrew {} lamports from vault. Total withdrawn: {}",
        amount,
        vault.total_withdrawn
    );

    Ok(())
}
```

### Task 9: Build and Generate Program ID

After writing all files, run:

```bash
cd P:\solana-agent-hackathon
anchor build
```

If the build succeeds, get the actual program ID:

```bash
anchor keys list
```

This will output something like:

```
makora_vault: <ACTUAL_PROGRAM_ID>
```

Then update the program ID in two places:

1. `programs/makora_vault/src/lib.rs` -- the `declare_id!()` macro
2. `Anchor.toml` -- the `[programs.localnet]` and `[programs.devnet]` sections

### Task 10: Deploy to Localnet

Start the local validator and deploy:

```bash
# In one terminal:
solana-test-validator

# In another terminal:
cd P:\solana-agent-hackathon
anchor deploy --provider.cluster localnet
```

Verify the deployment:

```bash
solana program show <PROGRAM_ID> --url localhost
```

## Verification

1. **`anchor build` succeeds** -- `target/deploy/makora_vault.so` exists and is a valid BPF binary.
2. **`anchor keys list`** -- outputs the vault program ID.
3. **Security constraints**:
   - `Initialize` uses `seeds`, `bump`, `init`, `payer` constraints.
   - `Deposit` uses `seeds`, `bump`, `has_one = owner` constraints.
   - `Withdraw` uses `seeds`, `bump`, `has_one = owner` constraints.
   - All financial math uses `checked_add`, `checked_sub`, `saturating_sub`.
4. **Deploy to localnet** -- `anchor deploy` succeeds, program is visible via `solana program show`.
5. **Cargo.toml** -- inherits workspace settings (edition 2021, rust-version 1.75, overflow-checks = true).

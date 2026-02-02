# Pitfalls Research: Mahoraga -- Adaptive DeFi Agent on Solana with ZK Privacy

> Comprehensive risk analysis for a 10-day hackathon build.
> Last updated: 2026-02-02

---

## Table of Contents

1. [Critical Pitfalls (Will Kill the Project)](#critical-pitfalls-will-kill-the-project)
2. [DeFi Integration Pitfalls](#defi-integration-pitfalls)
3. [ZK/Privacy Pitfalls](#zkprivacy-pitfalls)
4. [Security Pitfalls](#security-pitfalls)
5. [Hackathon-Specific Pitfalls](#hackathon-specific-pitfalls)
6. [Solana-Specific Pitfalls](#solana-specific-pitfalls)
7. [Testing Pitfalls](#testing-pitfalls)
8. [UX/Dashboard Pitfalls](#uxdashboard-pitfalls)
9. [Prevention Strategies](#prevention-strategies)
10. [Which Phase Should Address Each](#which-phase-should-address-each)

---

## Critical Pitfalls (Will Kill the Project)

These are the highest-risk issues that can cause total project failure within the 10-day window.

### C1. Transaction Size Limit (1232 bytes)

**The Problem**: Solana transactions are hard-capped at 1232 bytes (1280 MTU minus 48 bytes for headers). Every account address costs 32 bytes. A complex DeFi operation touching Jupiter routing + ZK proof data + multiple token accounts can easily exceed this.

**Real-world example**: A Raydium swap transaction with 5-7 instructions is around 900 bytes. Wrapping it with additional program invocations pushes it to ~2600 bytes -- more than double the limit.

**Warning Signs**:
- Transaction serialization errors during testing
- "Transaction too large" runtime errors
- Instructions that work individually but fail when combined

**Prevention**:
- Use Address Lookup Tables (ALTs / versioned transactions v0) to compress account references from 32 bytes to 1 byte each
- Split complex operations across multiple transactions with temporary on-chain state
- Calculate transaction size before sending: `transaction.serialize().length`
- Never try to pack ZK proof submission + DeFi operation into a single transaction
- Budget 600 bytes for ZK proof data alone, leaving ~600 bytes for everything else

### C2. Compute Unit (CU) Budget Exhaustion

**The Problem**: Each Solana transaction is allocated 200,000 CU by default (max 1.4M CU). ZK proof verification alone can consume 1,100,000+ CU (78.9% of the max budget). Combining ZK verification with DeFi operations in one transaction is likely impossible.

**Real-world data**:
- ZK-STARK verify: mean 1,104,510 CU, max 1,190,982 CU
- Groth16 verification: ~200,000-400,000 CU depending on circuit
- Jupiter swap routing: ~100,000-300,000 CU depending on route complexity
- Kamino vault operations: ~150,000-250,000 CU

**Warning Signs**:
- "Computational budget exceeded" errors
- Transactions that pass on devnet but fail on mainnet under load
- Operations that work in unit tests but fail in integration

**Prevention**:
- ALWAYS set explicit CU limits with `SetComputeUnitLimit`
- Separate ZK verification from DeFi execution into distinct transactions
- Use a two-phase commit: (1) verify proof and store result, (2) execute DeFi operation referencing the verified proof
- Profile every instruction's CU consumption during testing
- Enable `overflow-checks = true` in Cargo.toml

### C3. Overscoping: Trying to Build Too Much in 10 Days

**The Problem**: Multi-protocol integration (Jupiter + Raydium + Marinade + Kamino) with full ZK privacy (stealth addresses + shielded transfers) is extremely ambitious. Each protocol integration is 1-2 days of work. Each ZK circuit is 2-3 days. Testing adds another 2-3 days.

**Warning Signs**:
- Day 5 and core features are not working
- Multiple "almost done" features, none fully functional
- ZK circuits compile but proof generation is untested end-to-end
- Demo requires manual workarounds

**Prevention**:
- Define a Minimum Viable Product (MVP) for day 5
- Prioritize depth over breadth: 1 protocol with full ZK privacy beats 4 protocols with broken privacy
- Use Jupiter as the single DeFi aggregator (it already routes through Raydium, Orca, etc.)
- Have a "demo-ready" checkpoint at day 7 with 3 days for polish
- Cut features ruthlessly if behind schedule

### C4. Account Validation Failures (The #1 Solana Exploit Vector)

**The Problem**: Solana programs are stateless -- accounts are passed in by users. If your program does not validate that every account is owned by the correct program, has the correct type, and has the correct relationships, attackers can substitute malicious accounts. This is the most frequently exploited vulnerability in Solana DeFi.

**Real-world examples**:
- Wormhole: $325M lost from inadequate signature verification
- Solend: $21M liquidation crisis from missing borrow caps
- Loopscale: $5.8M lost from flawed price calculation logic (April 2025)

**Warning Signs**:
- Anchor `has_one` and `constraint` attributes not used on every account
- Manual deserialization without ownership checks
- CPI calls without verifying the target program ID
- PDA seeds that don't include enough discriminators

**Prevention**:
- Use Anchor framework -- it automates most validation via constraints
- Every account must have: owner check, type check, relationship validation, signer verification
- Never trust accounts passed by users without verification
- Use `has_one`, `seeds`, `bump`, and `constraint` on EVERY account in your Anchor context
- Add integration tests that pass wrong/malicious accounts and verify rejection

---

## DeFi Integration Pitfalls

### D1. Jupiter API Deprecation

**The Problem**: Jupiter deprecated `lite-api.jup.ag` on January 31, 2026. If you use outdated examples or tutorials, your integration will break immediately.

**Prevention**:
- Use the latest Jupiter API from `dev.jup.ag` documentation
- Use the Ultra Swap API for the simplest integration path
- Pin API versions and test against the current endpoint

### D2. Multi-Protocol Version Conflicts

**The Problem**: Jupiter SDK, Raydium SDK, Kamino SDK, and Marinade SDK may depend on different versions of `@solana/web3.js`, `@coral-xyz/anchor`, or `borsh`. npm/pnpm will not always resolve these gracefully.

**Warning Signs**:
- `borsh` serialization/deserialization errors at runtime
- TypeScript type conflicts between different SDK versions
- `Pubkey` type mismatches between packages

**Prevention**:
- Use pnpm with strict dependency resolution
- Check all SDK dependencies before adding them to the project
- Consider using Jupiter as the sole aggregator (it already integrates Raydium and others)
- If using multiple SDKs, isolate each in its own package within the monorepo
- Test all imports and type compatibility early (day 1-2)

### D3. Rate Limiting Across Multiple Protocols

**The Problem**: Each protocol's API has its own rate limits. Jupiter, Raydium, and price oracle APIs all enforce limits. An autonomous agent making frequent price checks, route calculations, and transaction submissions will hit these limits.

**Real-world data**:
- Solana public RPC: 40 requests per 10 seconds per IP
- Jupiter API: varies by endpoint, stricter for quote/swap routes
- HTTP 429 errors ("Too Many Requests") are the most common failure mode

**Warning Signs**:
- Intermittent 429 errors in logs
- Agent decisions based on stale price data
- Transaction failures due to outdated quotes

**Prevention**:
- Use a private RPC provider (Helius, QuickNode, or Chainstack)
- Implement exponential backoff with jitter on all API calls
- Cache price data with short TTLs (5-15 seconds for DeFi)
- Use WebSocket subscriptions instead of polling where possible
- Rate-limit the agent's decision loop to prevent API spam

### D4. Slippage and Price Impact Miscalculation

**The Problem**: Devnet has no real liquidity. Slippage calculations that work on devnet will be meaningless. On mainnet, large trades can have extreme price impact, and MEV bots will sandwich transactions.

**Prevention**:
- Use Jupiter's built-in slippage protection
- Set conservative slippage tolerances (1-3% for demo)
- For the hackathon demo, use small trade amounts
- Implement slippage checks in the Solana program, not just the client

### D5. Oracle Price Feed Staleness

**The Problem**: Price feeds from Pyth, Switchboard, or on-chain DEX pools can become stale. Making DeFi decisions on stale prices leads to losses.

**Prevention**:
- Always check the timestamp of price data
- Reject prices older than 30 seconds for trading decisions
- Use multiple price sources and compare (median pricing)
- Never rely on a single pool's spot price

---

## ZK/Privacy Pitfalls

### Z1. Proof Generation Time in Browser

**The Problem**: snarkjs/Groth16 proof generation in the browser is slow. Simple circuits take 1-2 seconds. Complex circuits (like RSA) take 15+ seconds. Semaphore-style circuits can take up to 10 minutes with snarkjs in Node.js.

**Real-world benchmarks**:
- Witness generation: ~57.6 ms (consistent across circuit types)
- Proof generation: 832-1,147 ms for simple circuits
- Complex circuits: 15-60 seconds in browser/JS
- Semaphore with snarkjs: up to 10 minutes

**Warning Signs**:
- Users waiting 30+ seconds for a "Transfer" button to respond
- Browser tab becoming unresponsive during proof generation
- Mobile devices failing to generate proofs entirely

**Prevention**:
- Keep circuits as small as possible (under 10,000 constraints)
- Use `singleThread: true` and `{memorySize: 0}` options in snarkjs for browser compatibility
- Consider server-side proof generation with a relayer service
- Show clear progress indicators during proof generation
- Pre-generate proofs where possible (e.g., for stealth address derivation)
- Test on low-end hardware, not just developer machines

### Z2. Proof Size vs. Transaction Size

**The Problem**: A Groth16 proof is ~192 bytes (3 group elements). But with public inputs, circuit metadata, and serialization overhead, the on-chain footprint grows. Fitting proof data + DeFi instruction data + account references into 1232 bytes is extremely tight.

**Prevention**:
- Budget proof data carefully: ~256 bytes for proof + public inputs
- Use Address Lookup Tables to save space on account references
- Split proof verification and DeFi execution into separate transactions
- Use PDA-stored proof results that subsequent transactions reference

### Z3. Trusted Setup Ceremony

**The Problem**: Groth16 requires a trusted setup (powers of tau ceremony + circuit-specific phase 2). If you use a custom circuit, you need to run this process. It is time-consuming and the resulting files (`.zkey`, `.ptau`) can be very large (100MB+).

**Warning Signs**:
- `.ptau` files too large to include in the repo
- Phase 2 contribution taking hours for complex circuits
- Circuit changes requiring a full re-run of the setup

**Prevention**:
- Use pre-computed Hermez `.ptau` files (available up to 2^28 constraints)
- Keep circuits small enough to use existing `.ptau` files
- Automate the setup process in build scripts
- Cache `.zkey` files and only regenerate when circuits change
- For the hackathon, a single-contributor phase 2 is acceptable

### Z4. Circuit Complexity vs. On-Chain Verification Cost

**The Problem**: More complex circuits mean larger proofs, more public inputs, and higher CU costs for on-chain verification. There is a direct tradeoff between privacy features and on-chain feasibility.

**Prevention**:
- Start with the simplest circuit that provides meaningful privacy
- Stealth addresses require minimal ZK (hash preimage proofs)
- Shielded transfers require more complex circuits (Merkle proofs + nullifiers)
- Profile CU consumption of verification early and adjust circuit design
- Consider off-chain verification with on-chain attestation for demo purposes

### Z5. Concurrency with Compressed/ZK Accounts

**The Problem**: If two users try to write to the same compressed account or Merkle tree simultaneously, one transaction will fail. ZK Compression has a per-account CU limit of 12M per block, limiting concurrent operations.

**Prevention**:
- Design state trees to minimize write contention
- Use multiple Merkle trees for different privacy pools
- Implement retry logic for contention-based failures
- For the hackathon demo, sequential operations are acceptable

---

## Security Pitfalls

### S1. Private Key Exposure for Autonomous Agent

**The Problem**: An autonomous DeFi agent needs wallet access to execute transactions. Traditional approaches either expose private keys in environment variables or require centralized custody. Neither is acceptable for production, and even for a hackathon demo, a leaked key means lost funds.

**Prevention**:
- Use scoped, policy-controlled API access (Turnkey-style)
- Implement transaction limits in the Solana program itself
- Use a dedicated wallet with minimal funds for the agent
- Never store private keys in source code or environment variables that get committed
- Implement a "kill switch" that revokes agent access
- For the demo, use devnet or a mainnet wallet with <$10 of SOL

### S2. MEV / Sandwich Attack Vulnerability

**The Problem**: Over 50% of Solana transactions are failed arbitrage attempts. MEV bots actively monitor and sandwich DeFi transactions. An autonomous agent broadcasting swap transactions is a prime target.

**Real-world data**:
- Wide (multi-slot) sandwiches account for 93% of all sandwich attacks on Solana
- Over 529,000 SOL extracted by sandwich attacks in the past year
- Validator-run MEV extraction is now the dominant threat

**Prevention**:
- Use Jupiter's built-in MEV protection
- Route transactions via Jito bundles for priority inclusion
- Set tight slippage tolerances
- Avoid broadcasting large swaps in a single transaction
- For privacy features, the ZK layer itself helps mitigate MEV (transactions are shielded)

### S3. Rug Vector: Agent Making Unbounded Decisions

**The Problem**: An autonomous agent with wallet access and no constraints could drain funds through bad trades, interact with malicious tokens, or approve unlimited spending.

**Prevention**:
- Implement hard-coded constraints in the Solana program:
  - Maximum trade size per transaction
  - Maximum total exposure per time period
  - Whitelist of allowed tokens and protocols
  - Minimum position size thresholds
- The agent should propose transactions that a human (or constraint system) approves
- Log every decision and transaction for auditability
- Implement circuit breakers that pause the agent on anomalous behavior

### S4. Arithmetic Overflow in Financial Calculations

**The Problem**: Rust wraps on integer overflow in release mode (no panic). A financial calculation that overflows silently can lead to catastrophic fund loss. This is a well-documented exploit vector in Solana DeFi.

**Prevention**:
- Set `overflow-checks = true` in `Cargo.toml` under `[profile.release]`
- Use `checked_add`, `checked_sub`, `checked_mul`, `checked_div` for ALL arithmetic
- Use `u128` for intermediate calculations involving token amounts
- Write explicit tests for boundary conditions (max values, zero values, dust amounts)

### S5. Cross-Program Invocation (CPI) Risks

**The Problem**: When your program invokes another program via CPI, the called program can modify state in unexpected ways. If you don't re-validate state after a CPI call, an attacker can use a malicious program to manipulate your program's state.

**Prevention**:
- Verify the program ID of every CPI target
- Re-check account state after CPI returns
- Use Anchor's CPI helpers which enforce type safety
- Never pass writable accounts to untrusted programs

---

## Hackathon-Specific Pitfalls

### H1. Demo Day Failure

**The Problem**: The demo is the single most important artifact for hackathon judging. A project that works perfectly locally but fails during the demo presentation loses to a simpler project that demos flawlessly.

**Common demo failures**:
- RPC endpoint goes down or rate-limits during live demo
- Devnet is reset or congested during presentation
- Wallet connection fails in the demo environment
- ZK proof generation takes too long and the audience loses patience
- Transaction fails due to stale blockhash

**Prevention**:
- Record a backup demo video (mandatory)
- Use a private RPC endpoint, not public devnet
- Pre-compute all ZK proofs for the demo flow
- Have a pre-configured wallet with all necessary accounts
- Practice the demo flow 5+ times before recording
- Keep the demo under 3 minutes, showing only the highlights

### H2. Submission Format Mistakes

**The Problem**: Colosseum hackathons have specific submission requirements. Missing elements (pitch video, technical demo, repo access) can disqualify or disadvantage your submission.

**Requirements**:
- Pitch video (most important -- first thing judges review)
- Technical demo video (2-3 minutes, implementation-focused)
- GitHub repo access for judges
- Clear README with setup instructions

**Prevention**:
- Prepare submission materials starting day 8
- Pitch video: focus on "why" and the problem being solved
- Technical demo: focus on "how" and Solana-specific implementation
- Ensure repo is clean, well-documented, and builds from README instructions
- Grant access to all necessary resources before submission

### H3. Environment/Toolchain Version Conflicts

**The Problem**: Solana development requires specific compatible versions of Rust, Anchor CLI, Solana CLI, and Node.js. Version mismatches cause cryptic build errors that can waste hours.

**Common conflicts**:
- Rust compiler version vs. Solana crate requirements
- Anchor CLI version vs. `@coral-xyz/anchor` npm package
- `solana-program` crate version vs. Anchor version
- Node.js version vs. native WASM compilation requirements
- `borsh` serialization version conflicts

**Prevention**:
- Lock all versions on day 1 and document them in the README
- Use `solana --version`, `anchor --version`, `rustc --version` as a pre-build check
- Pin exact versions in `Cargo.toml` and `package.json`
- Use `rust-toolchain.toml` to enforce Rust version
- Test a clean build from scratch on day 3

### H4. Deployment Budget Exhaustion

**The Problem**: Deploying Solana programs costs SOL for rent. A ~350KB program costs ~0.76 SOL. Failed deployments can lose buffer deposits (~4 SOL each). Multiple redeploys during development add up.

**Real-world data**:
- Average deploy cost: ~0.76 SOL (post-2025 rent reduction)
- Failed deploy buffer: ~4 SOL (potentially non-recoverable)
- Only ~1% of deploys succeed on first try during congestion
- ~49% of failures result in non-recoverable buffer loss

**Prevention**:
- Use devnet for all development (free SOL from faucet)
- Only deploy to mainnet once, after thorough devnet testing
- Close unused program buffers to recover SOL: `solana program close --buffers`
- Keep 10+ SOL available for mainnet deployment attempts
- Deploy during low-congestion hours (US nighttime / early morning)

### H5. "All Code Must Be Written by AI" Rule

**The Problem**: The hackathon requires all code to be written by AI agents. Judges may scrutinize commit history and development patterns. If it looks like a human wrote significant portions, the project could be disqualified.

**Prevention**:
- Use Claude (via OpenClaw) for all code generation
- Maintain clear commit history showing agent-driven development
- Document the agent's decision-making process
- Humans configure and direct, but the agent writes the code
- Keep logs of agent sessions as evidence of autonomous development

---

## Solana-Specific Pitfalls

### SOL1. RPC Reliability and Rate Limits

**The Problem**: Public Solana RPC endpoints are rate-limited to 40 requests per 10 seconds per IP. During high traffic, shared RPC infrastructure degrades with 2-5 block slot lag, dropped transactions, stale reads, and HTTP 429 storms.

**Prevention**:
- Use a private RPC provider (Helius free tier: sufficient for hackathon)
- Implement connection pooling across multiple RPC endpoints
- Use WebSocket subscriptions for real-time data instead of polling
- Cache account data locally with short TTLs
- Handle 429 errors with exponential backoff + jitter

### SOL2. Account Space and Rent Miscalculation

**The Problem**: Solana accounts have a maximum initialization size of 10,240 bytes. Account rent is proportional to data size. Miscalculating space leads to failed initialization or wasted SOL. All accounts must be rent-exempt (2 years prepaid).

**Prevention**:
- Pre-calculate account sizes using `solana rent <bytes>` CLI command
- Use Anchor's `space` attribute with explicit calculations
- Account for the 8-byte discriminator Anchor adds automatically
- Use `realloc` if accounts need to grow beyond initial size
- Close unused accounts to recover rent SOL

### SOL3. PDA Derivation Errors

**The Problem**: Program Derived Addresses (PDAs) are the backbone of Solana program state management. Incorrect seed derivation, missing bump seeds, or inconsistent PDA usage between client and program code causes account-not-found errors that are extremely hard to debug.

**Prevention**:
- Centralize PDA derivation logic in a shared utility (used by both program and client)
- Always include enough discriminating seeds (user pubkey, protocol ID, action type)
- Store the bump seed in the account data for consistent re-derivation
- Use Anchor's `seeds` and `bump` constraints to automate PDA validation
- Write tests that verify PDA derivation matches between client and program

### SOL4. Priority Fees and Transaction Landing

**The Problem**: During network congestion, transactions without priority fees may never land. But overpaying priority fees wastes SOL. The priority fee is charged based on requested CU limit, not actual CU used.

**Prevention**:
- Always set an explicit CU limit close to actual usage (simulate first)
- Use the 80th percentile of recent priority fees as a baseline
- Implement dynamic fee estimation based on recent network conditions
- For the hackathon demo, use a fixed reasonable priority fee
- Consider Jito bundles for time-critical transactions

### SOL5. Blockhash Expiration

**The Problem**: Solana transactions include a recent blockhash that expires after ~60-90 seconds. If proof generation or user confirmation takes too long, the blockhash expires and the transaction fails.

**Prevention**:
- Fetch blockhash as late as possible (just before signing)
- For ZK operations: generate proof first, then fetch blockhash and build transaction
- Use `getLatestBlockhash` with `confirmed` commitment for the most recent hash
- Implement automatic blockhash refresh if the operation takes longer than 30 seconds

---

## Testing Pitfalls

### T1. Devnet Does Not Reflect Mainnet Conditions

**The Problem**: Devnet lacks real liquidity, real oracle data, real MEV, and real network congestion. DeFi operations that "work" on devnet may fail catastrophically on mainnet.

**Key differences**:
- No real token markets or liquidity pools
- No MEV bots or sandwich attacks
- Lower and more consistent network congestion
- Periodic resets that wipe all state
- Different fee dynamics

**Prevention**:
- Test the DeFi logic with mocked prices and liquidity on devnet
- Use mainnet-fork tools if available for realistic testing
- Test with very small amounts on mainnet before demo
- Don't rely on devnet performance as a mainnet indicator
- Document which behaviors are devnet-only vs. expected on mainnet

### T2. Mocking Multi-Protocol Interactions

**The Problem**: Jupiter, Raydium, Kamino, and Marinade don't have identical devnet deployments as mainnet. Some features may be missing, addresses are different, and pool compositions don't match.

**Prevention**:
- Use Jupiter's devnet API (if available) for swap testing
- Create your own test token pools on devnet for controlled testing
- Mock protocol responses for unit tests
- Test the integration layer separately from the protocol interaction layer
- Have a clear testing strategy document that identifies what can and cannot be tested on devnet

### T3. ZK Circuit Testing Gaps

**The Problem**: ZK circuits must be tested at multiple levels: constraint satisfaction, proof generation, proof verification, and on-chain verification. A circuit that passes constraint checks may still fail on-chain due to serialization issues or CU limits.

**Prevention**:
- Test constraint satisfaction with Circom's built-in test framework
- Test proof generation timing with realistic inputs
- Test on-chain verification CU consumption with `solana-test-validator`
- Test the full flow: generate proof off-chain, submit on-chain, verify result
- Test with edge cases: zero values, maximum values, invalid proofs (should reject)

### T4. Integration Test Brittleness

**The Problem**: Solana integration tests depend on a running test validator, network connectivity for RPC calls, and deterministic account state. Any of these can cause flaky tests.

**Prevention**:
- Use `anchor test` with a local test validator for deterministic testing
- Reset validator state between test suites
- Don't depend on external APIs in integration tests (mock them)
- Use `bankrun` or similar tools for faster, more deterministic testing
- Run the full test suite at least once per day during the hackathon

### T5. Missing Negative Tests

**The Problem**: Developers test the "happy path" but forget to test that invalid inputs, wrong accounts, and unauthorized callers are properly rejected. This is how exploits happen.

**Prevention**:
- For every instruction, write at least one test with:
  - Wrong signer
  - Wrong account owner
  - Wrong account type
  - Overflow inputs
  - Zero-value inputs
  - Invalid proof data
- Test that all error cases return specific, descriptive error codes
- Use Anchor's `#[error_code]` for custom error types

---

## UX/Dashboard Pitfalls

### U1. Wallet Connection Friction

**The Problem**: Over 55% of users abandon onboarding at the wallet connection step. Complex wallet setup processes kill adoption and demo impressions.

**Prevention**:
- Support the most popular Solana wallets (Phantom, Solflare, Backpack)
- Show a clear "Connect Wallet" button, not a jargon-filled process
- Allow users to explore the dashboard before requiring wallet connection
- Handle wallet connection errors gracefully with user-friendly messages

### U2. Blockchain Complexity Exposure

**The Problem**: Showing raw transaction hashes, lamport amounts, pubkey strings, and CU costs confuses non-technical users. DeFi dashboards that look like blockchain explorers fail to impress judges.

**Prevention**:
- Format all amounts in human-readable form (SOL, USDC, not lamports)
- Shorten addresses to `Abc1...xyz9` format with copy buttons
- Hide gas/CU details behind "Advanced" toggles
- Show transaction status as a progress timeline, not raw logs
- Use clear labels: "Swap SOL to USDC" not "Execute Jupiter IX #3"

### U3. Transaction Feedback Gaps

**The Problem**: Users click a button and nothing happens for 5-30 seconds. No loading indicator, no status update, no confirmation. They click again, submitting a duplicate transaction.

**Prevention**:
- Show immediate visual feedback on every action (loading spinner, progress bar)
- Display transaction stages: "Preparing" -> "Signing" -> "Sending" -> "Confirming" -> "Confirmed"
- Disable buttons during transaction processing to prevent duplicates
- Show clear success/failure messages with explorer links
- For ZK operations, show proof generation progress separately

### U4. Error Message Uselessness

**The Problem**: Solana error messages are cryptic (`"Transaction simulation failed: Error processing Instruction 2: custom program error: 0x1"`). Showing these to users is unacceptable.

**Prevention**:
- Map all program error codes to human-readable messages
- Use Anchor's custom error types with descriptive messages
- Log technical details to console, show user-friendly messages in UI
- Provide actionable guidance: "Insufficient balance. You need 0.5 more SOL."

### U5. Mobile Responsiveness

**The Problem**: Judges may view the demo on mobile devices. A dashboard that only works on desktop fails the UX test.

**Prevention**:
- Use responsive CSS from the start (Tailwind CSS recommended)
- Test on mobile viewport sizes during development
- Ensure wallet connection works on mobile browsers
- Keep the most important data visible without scrolling

---

## Prevention Strategies

### Strategy Matrix

| Pitfall ID | Detection Method | Prevention Action | Effort |
|-----------|-----------------|-------------------|--------|
| C1 | TX serialization test | ALTs + split transactions | Medium |
| C2 | CU profiling in tests | Separate ZK and DeFi TXs | Medium |
| C3 | Daily progress check | MVP-first, cut features early | Low |
| C4 | Negative test suite | Anchor constraints on every account | Medium |
| D1 | API response check | Use latest Jupiter API docs | Low |
| D2 | Build test on day 1 | pnpm strict resolution | Low |
| D3 | Monitor HTTP 429s | Private RPC + rate limiting | Low |
| D4 | Simulated trade test | Conservative slippage settings | Low |
| D5 | Price timestamp check | Multi-source + staleness rejection | Medium |
| Z1 | Proof timing benchmark | Keep circuits small, show progress | Medium |
| Z2 | TX size calculation | Budget bytes carefully | Medium |
| Z3 | Build script automation | Use pre-computed ptau files | Low |
| Z4 | CU profiling | Profile early, adjust circuit | High |
| Z5 | Concurrent test scenarios | Multiple trees, retry logic | Low |
| S1 | Key management audit | Scoped access, minimal funds | Medium |
| S2 | MEV simulation | Jupiter protection + Jito | Low |
| S3 | Constraint audit | Hard-coded limits in program | Medium |
| S4 | Overflow test suite | checked_* arithmetic everywhere | Medium |
| S5 | CPI test suite | Verify program IDs, re-check state | Medium |
| H1 | Demo rehearsal | Backup video + private RPC | Low |
| H2 | Submission checklist | Start materials on day 8 | Low |
| H3 | Clean build test | Lock versions on day 1 | Low |
| H4 | Budget tracking | Devnet-first, recover buffers | Low |
| H5 | Commit history review | Agent-only code generation | Low |
| SOL1 | RPC health monitoring | Private RPC + fallback | Low |
| SOL2 | Rent calculation test | Explicit space calculations | Low |
| SOL3 | PDA derivation test | Centralized PDA utility | Medium |
| SOL4 | Fee estimation test | Dynamic fee + CU simulation | Medium |
| SOL5 | Timing test | Fetch blockhash late | Low |
| T1 | Mainnet smoke test | Mock-based + small mainnet test | Medium |
| T2 | Protocol mock coverage | Isolated integration layer | Medium |
| T3 | E2E ZK test | Full pipeline test | High |
| T4 | CI test stability | Local validator + bankrun | Medium |
| T5 | Negative test count | Minimum 1 negative test per IX | Medium |
| U1 | User flow test | Multi-wallet support | Low |
| U2 | UI review | Human-readable formatting | Low |
| U3 | User action timing | Loading states + disable buttons | Low |
| U4 | Error message audit | Custom error mapping | Medium |
| U5 | Mobile viewport test | Responsive CSS from day 1 | Low |

### Top 10 "Must-Do" Preventions (Ranked by Impact)

1. **Separate ZK verification from DeFi execution** (prevents C1 + C2 + Z2)
2. **Use Anchor constraints on every account** (prevents C4 + S5)
3. **Define MVP and cut features by day 5** (prevents C3 + H1)
4. **Use private RPC endpoint** (prevents SOL1 + D3 + H1)
5. **Record backup demo video** (prevents H1)
6. **Lock toolchain versions on day 1** (prevents H3)
7. **Use checked arithmetic everywhere** (prevents S4)
8. **Keep ZK circuits under 10K constraints** (prevents Z1 + Z4)
9. **Test with wrong accounts** (prevents C4 + T5)
10. **Budget transaction bytes explicitly** (prevents C1 + Z2)

---

## Which Phase Should Address Each

### Phase 1: Foundation (Days 1-2)

| Pitfall | Action |
|---------|--------|
| H3 | Lock all toolchain versions, document in README |
| D2 | Resolve all SDK version conflicts |
| H5 | Set up agent-driven development workflow |
| SOL1 | Configure private RPC endpoint |
| C3 | Define MVP scope and daily milestones |
| H4 | Ensure sufficient devnet SOL balance |

### Phase 2: Core Architecture (Days 2-4)

| Pitfall | Action |
|---------|--------|
| C4 | Implement Anchor account validation on all instructions |
| S4 | Enable overflow checks, use checked arithmetic |
| SOL2 | Calculate and set account space for all program accounts |
| SOL3 | Build centralized PDA derivation utility |
| C1 | Design transaction splitting strategy for ZK + DeFi |
| C2 | Profile CU consumption of all instructions |
| S3 | Implement hard-coded agent constraints in program |

### Phase 3: ZK Privacy Layer (Days 3-5)

| Pitfall | Action |
|---------|--------|
| Z1 | Benchmark proof generation, optimize circuit size |
| Z2 | Test proof data fits within transaction budget |
| Z3 | Automate trusted setup, cache zkey files |
| Z4 | Profile on-chain verification CU, adjust circuits |
| Z5 | Design state trees for minimal contention |
| T3 | Build full ZK pipeline test (off-chain to on-chain) |

### Phase 4: DeFi Integration (Days 4-6)

| Pitfall | Action |
|---------|--------|
| D1 | Verify Jupiter API endpoints and SDK versions |
| D3 | Implement rate limiting and caching |
| D4 | Set slippage parameters, test with mock liquidity |
| D5 | Implement oracle staleness checks |
| S2 | Enable MEV protection on all swap transactions |
| S5 | Test all CPI calls with verification |
| S1 | Configure agent wallet with minimal funds and scoped access |

### Phase 5: Frontend / Dashboard (Days 5-7)

| Pitfall | Action |
|---------|--------|
| U1 | Implement multi-wallet connection |
| U2 | Format all blockchain data for humans |
| U3 | Add loading states and transaction progress |
| U4 | Map all error codes to user messages |
| U5 | Test responsive layout on mobile viewports |

### Phase 6: Testing and Hardening (Days 7-9)

| Pitfall | Action |
|---------|--------|
| T1 | Smoke test on mainnet with tiny amounts |
| T2 | Verify all protocol mocks match real behavior |
| T4 | Stabilize integration test suite |
| T5 | Add negative tests for every instruction |
| SOL4 | Test priority fee estimation |
| SOL5 | Test blockhash handling under slow operations |

### Phase 7: Demo and Submission (Days 9-10)

| Pitfall | Action |
|---------|--------|
| H1 | Record backup demo video, rehearse 5+ times |
| H2 | Prepare all submission materials |
| C3 | Final scope audit -- cut anything not working |
| H4 | Deploy to devnet/mainnet for final demo |

---

## Sources

- [Neodyme: Solana Common Pitfalls](https://neodyme.io/en/blog/solana_common_pitfalls/)
- [Helius: Solana Hacks History](https://www.helius.dev/blog/solana-hacks)
- [Helius: How to Build a Secure AI Agent on Solana](https://www.helius.dev/blog/how-to-build-a-secure-ai-agent-on-solana)
- [Helius: ZK Proofs Applications on Solana](https://www.helius.dev/blog/zero-knowledge-proofs-its-applications-on-solana)
- [Helius: ZK Compression](https://www.helius.dev/blog/solana-builders-zk-compression)
- [Helius: Hitchhiker's Guide to Solana Program Security](https://www.helius.dev/blog/a-hitchhikers-guide-to-solana-program-security)
- [Anza: Why CU Costs Matter](https://www.anza.xyz/blog/why-solana-transaction-costs-and-compute-units-matter-for-developers)
- [Solana: How to Optimize Compute](https://solana.com/developers/guides/advanced/how-to-optimize-compute)
- [Solana: Transaction Fees](https://solana.com/docs/core/fees)
- [Solana: Deploying Programs](https://solana.com/docs/programs/deploying)
- [RareSkills: Solana CU Price](https://rareskills.io/post/solana-compute-unit-price)
- [RareSkills: Solana Account Rent](https://rareskills.io/post/solana-account-rent)
- [RareSkills: Solana Multiple Transactions](https://rareskills.io/post/solana-multiple-transactions)
- [Jupiter Developers](https://dev.jup.ag/)
- [Light Protocol: ZK Compression](https://www.zkcompression.com/home)
- [Succinct: SP1 Solana Verifier](https://blog.succinct.xyz/solana-sp1/)
- [Colosseum: Perfecting Your Hackathon Submission](https://blog.colosseum.com/perfecting-your-hackathon-submission/)
- [Mirage Audits: Solana Native Rust Security](https://www.mirageaudits.com/blog/solana-native-rust-security-vulnerabilities)
- [Dedaub: Ethereum Developers on Solana Common Mistakes](https://dedaub.com/blog/ethereum-developers-on-solana-common-mistakes/)
- [Cantina: Securing Solana Guide](https://cantina.xyz/blog/securing-solana-a-developers-guide)
- [SlowMist: Solana Security Best Practices (GitHub)](https://github.com/slowmist/solana-smart-contract-security-best-practices)
- [Chainstack: Solana Common Development Errors](https://chainstack.com/solana-how-to-troubleshoot-common-development-errors/)
- [Chainstack: Enterprise Solana Infrastructure 2026](https://chainstack.com/enterprise-solana-infrastructure-what-matters-in-2026/)
- [RPC Fast: Real-Time RPC on Solana 2026](https://rpcfast.com/blog/real-time-rpc-on-solana)
- [QuickNode: MEV on Solana](https://www.quicknode.com/guides/solana-development/defi/mev-on-solana)
- [QuickNode: Priority Fees](https://www.quicknode.com/guides/solana-development/transactions/how-to-use-priority-fees)
- [QuickNode: Optimizing Solana Transactions](https://www.quicknode.com/guides/solana-development/transactions/how-to-optimize-solana-transactions)
- [Chorus One: Transaction Latency on Solana](https://chorus.one/reports-research/transaction-latency-on-solana-do-swqos-priority-fees-and-jito-tips-make-your-transactions-land-faster)
- [Mopro: Circom Prover Comparison](https://zkmopro.org/blog/circom-comparison/)
- [snarkjs (GitHub)](https://github.com/iden3/snarkjs)
- [Solana TX Size Limits (mina86)](https://mina86.com/2025/solana-tx-size-limits/)
- [Phenomenon: Top UI/UX Mistakes in Web3](https://phenomenonstudio.com/article/top-ui-ux-mistakes-in-web3-apps-and-how-to-avoid-them/)
- [Token Metrics: Web3 UX Challenges 2025](https://www.tokenmetrics.com/blog/why-web3-ux-poor-web2-challenges-2025)

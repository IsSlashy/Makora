# Makora -- Project State

## Current Position

Phase: 1 of 7
Status: Ready to build
Day: 1 of 10 (Feb 2, 2026)
Branch: `gsd/phase-1-foundation` (to create)

## Phase 1 Target

**Foundation** -- Monorepo, types, Solana connection, Jupiter adapter, CLI skeleton, vault program stub, toolchain lockdown.

Entry criteria: Roadmap and requirements defined (done).
Exit criteria: `pnpm build` compiles, `mahoraga status` shows balances, Jupiter swap executes on devnet, vault program builds.

## Recent Work

- [x] Initialized project repository (`P:\solana-agent-hackathon`)
- [x] Completed research phase (STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md)
- [x] Synthesized research into SUMMARY.md
- [x] Defined PROJECT.md (vision, branding, constraints, success criteria)
- [x] Defined REQUIREMENTS.md (40 requirements across 9 categories)
- [x] Created ROADMAP.md (7 phases, 10 days, all requirements mapped)
- [x] Created STATE.md (this file)

## Key Decisions

| Decision | Rationale | Status |
|----------|-----------|--------|
| Makora branding (JJK theme) | Memorable, maps to adaptive DeFi, strong visual identity with The Wheel | Confirmed |
| Advisory + Auto modes | Advisory is safe for demos, auto showcases autonomy | Confirmed |
| Both stealth + shielded privacy | Maximum differentiation, leverages full P01 expertise | Confirmed |
| 4 protocol targets (Jupiter, Marinade, Raydium, Kamino) | Breadth for judges, but Jupiter + Marinade are P0, others are P1 | Confirmed |
| CLI + Dashboard | CLI shows depth, dashboard impresses visually | Confirmed |
| TypeScript + Anchor/Rust | Matches P01 stack, proven, fast development | Confirmed |
| Modular monolith architecture | Clean boundaries without microservice overhead | Confirmed |
| Privacy is additive (feature flag) | Core DeFi works without privacy; privacy can be cut if behind | Confirmed |
| Two-phase commit for ZK + DeFi | Non-negotiable due to Solana TX size + CU limits | Confirmed |
| Helius RPC primary | Free tier (1M credits/month), reliable, with fallback option | Confirmed |

## What's Next

1. **Immediate**: Start Phase 1 -- scaffold monorepo with pnpm workspaces + Turborepo
2. **Then**: Create `@mahoraga/types` package with all shared interfaces
3. **Then**: Set up Solana connection to Helius devnet RPC
4. **Then**: Build Jupiter adapter and execute first swap
5. **Then**: Create vault program Anchor skeleton
6. **Then**: Wire up CLI `mahoraga status` command
7. **Then**: Lock all toolchain versions

## Pending Concerns

| Concern | Severity | Mitigation |
|---------|----------|------------|
| SDK version conflicts (Raydium alpha, Kamino @solana/kit dep) | HIGH | Isolate in separate workspace packages. Test imports Day 1. If conflicts persist 4h, cut Raydium + Kamino (Day 3 decision point). |
| P01 circuit porting complexity | MEDIUM | Start circuit review early (Day 3). If circuits don't compile in 8h, fall back to pre-computed proofs for demo (Day 6 decision point). |
| Helius RPC rate limits (10 RPS free tier) | MEDIUM | Implement request batching and caching in data-feed package. Consider QuickNode fallback. |
| 10-day timeline for 40 requirements | HIGH | Strict scope cut decision points defined in ROADMAP.md. P0 features are non-negotiable. P1 features cut first. Days 9-10 are polish only, no new features. |
| "All code by AI" rule compliance | LOW | All code written by Claude via sessions. Maintain commit history with agent attribution. |
| Demo day RPC/devnet failure | MEDIUM | Record backup demo video by Day 9 (mandatory). Pre-fund devnet wallet. Practice 5+ times. |

## Scope Health

- **P0 requirements**: 0/18 complete
- **P1 requirements**: 0/22 complete
- **Total**: 0/40 complete
- **Schedule**: On track (Day 1)

---

*Updated: 2026-02-02 | Next update: after Phase 1 completion*

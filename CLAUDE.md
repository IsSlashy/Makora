# SOLANA AGENT HACKATHON — CONTEXT FILE

> Ce fichier est ton brief. Lis-le en entier avant de faire quoi que ce soit.

---

## MISSION

Remporter la **1re place ($50,000 USDC)** du Solana Agent Hackathon organisé par Solana Foundation + Colosseum.

- Page officielle : https://colosseum.com/agent-hackathon
- Annonce : https://x.com/solana/status/2018420230427496753

---

## HACKATHON — REGLES CLES

| Info | Detail |
|------|--------|
| **Organisateurs** | Solana Foundation + Colosseum |
| **Plateforme agent** | OpenClaw (open-source, Node.js, powered by Claude/Anthropic) |
| **Kickoff** | 2 fevrier 2026 |
| **Submissions close** | 12 fevrier 2026 |
| **Winners announced** | 16 fevrier 2026 |
| **Duree** | 10 jours |
| **Prize pool** | $100,000 USDC total |
| **1st place** | $50,000 USDC |
| **2nd place** | $30,000 USDC |
| **3rd place** | $15,000 USDC |
| **Most Agentic** | $5,000 USDC |

### Regle critique
> **ALL code must be written by AI agents.** Humans can configure and run agents, but the project development must be autonomous.

### Flow de participation
1. Diriger un agent OpenClaw vers colosseum.com/agent-hackathon
2. L'agent s'enregistre et recoit un claim code
3. L'humain lie son compte X + wallet Solana via ce claim code
4. L'agent build le projet de maniere autonome
5. Les humains votent (1 vote par projet, retirable avant la fin)
6. Un panel de juges selectionne les gagnants (les votes aident a identifier les standout)

### Categories de projets acceptes
- DeFi : gestion de positions, yield, lending
- Trading : strategies, bots, analytics
- Services crypto : services payes en crypto
- Onchain data : insights, dashboards, analytics
- Consumer apps : pour agents ou humains
- "Anything goes as long as there's a Solana" — Solana Foundation

---

## QUI ON EST

- **Dev** : Slashy Fx (solo dev, Volta Team)
- **Agent** : Claude (Anthropic) — le moteur derriere OpenClaw
- **Projet de reference** : P01 (Protocol 01) — livre, operationnel

---

## P01 — NOTRE BASE TECHNIQUE (Reference)

P01 est un **privacy layer pour Solana** livre lors d'un hackathon precedent. Localise dans `P:\p01`.

### Tech stack P01
- **Blockchain** : Solana (Anchor framework v0.32)
- **ZK** : Circom circuits + snarkjs (zero-knowledge proofs)
- **Monorepo** : pnpm workspaces + Turborepo
- **Apps** : Web (Next.js), Mobile (Expo/React Native), Extension Chrome
- **SDKs** : p01-js, sdk, auth-sdk, zk-sdk, specter-sdk, whitelist-sdk, specter-js
- **Services** : Relayer backend
- **Programs Solana** : Anchor programs (shielded transfers, stealth addresses)
- **Langage** : TypeScript (full stack), Rust (programs Solana)
- **Tests** : Mocha/Chai, e2e tests complets (stealth, stream, auth, privacy modes, ZK)

### Ce que P01 fait
- Stealth addresses (paiements invisibles)
- Shielded transfers (transferts ZK)
- Privacy modes configurables
- Wallet integre (mobile + extension)
- Auth flow complet
- Relayer pour les transactions

### Ce qu'on sait faire grace a P01
- Solana programs (Anchor/Rust)
- ZK circuits (Circom)
- Full-stack TypeScript
- Monorepo architecture
- SDKs publishables
- Mobile apps (Expo)
- Browser extensions
- E2E testing sur Solana

---

## SETUP A FAIRE (au prochain lancement)

### 1. Installer OpenClaw
- Repo : https://github.com/peterSteiner/openclaw (verifier le nom exact)
- Node.js runtime, tourne en local
- Config pour utiliser Claude comme LLM backend
- Docs : https://medium.com/@gemQueenx/what-is-openclaw-open-source-ai-agent-in-2026-setup-features-8e020db20e5e

### 2. S'enregistrer au hackathon
- Diriger l'agent OpenClaw vers https://colosseum.com/agent-hackathon
- Recuperer le claim code
- Lier compte X (@Not_Mikuu) + wallet Solana

### 3. Choisir et builder le projet
- Decision a prendre avec Slashy au prochain lancement
- Le projet doit etre build **entierement par l'agent** (Claude via OpenClaw)
- Viser quelque chose d'ambitieux mais livrable en 10 jours

---

## STRATEGIE POUR GAGNER

### Ce qui va faire la difference
1. **Qualite technique** — Meme niveau que P01 (ZK, Anchor, tests, architecture propre)
2. **Votes humains** — Le projet doit etre impressionnant visuellement et comprehensible
3. **"Most Agentic"** — Montrer que l'agent a vraiment build le projet de A a Z
4. **Innovation Solana-native** — Pas un wrapper, quelque chose qui utilise les forces de Solana

### Avantages competitifs
- On a deja livre un projet Solana complet (P01)
- On maitrise Anchor, ZK, et le full-stack Solana
- Claude est le LLM natif d'OpenClaw — avantage technique
- Experience monorepo, SDKs, multi-platform

### Pistes de projets (a discuter)
- **Agent DeFi autonome** : un agent qui gere un portfolio Solana (yield, rebalancing)
- **Onchain analytics agent** : insights temps reel sur l'activite Solana
- **Privacy-as-a-Service agent** : leverager notre expertise ZK de P01
- **Agent marketplace** : plateforme ou des agents offrent/consomment des services onchain
- **Trading agent** : strategies automatisees avec backtesting

---

## STRUCTURE DU REPO

```
P:\solana-agent-hackathon\
├── CLAUDE.md          ← CE FICHIER (brief complet)
├── src/               ← Code source (a creer)
├── programs/          ← Solana programs Anchor (a creer)
├── tests/             ← Tests (a creer)
├── packages/          ← SDKs si necessaire (a creer)
└── ...
```

---

## NOTES IMPORTANTES

- **Deadline** : 12 fevrier 2026 — AUCUN retard possible
- **Tout le code doit etre ecrit par l'agent (Claude)** — c'est la regle du hackathon
- **Qualite > Quantite** — Mieux vaut un projet propre et fini qu'un truc ambitieux et casse
- **Les votes comptent** — Il faut un README, des screenshots, une demo si possible
- **Le projet P01 est dans `P:\p01`** — reference technique, ne pas modifier

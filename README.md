# Tide

Tide is a partially-active AMM that shows each block's arbitrageur only a fraction λ of the maker's inventory, quotes uninformed flow against an N-times deeper virtual curve backed by the idle remainder, and lets a manager agent tune λ only after a fresh World ID authentication, with the parameters living as ENSv2 records the agent may edit and nothing else.

**Whitepaper:** [WHITEPAPER.pdf](WHITEPAPER.pdf) · **Video:** _(link)_ · **Live demo (Sepolia):** dashboard `client/` (see Run), records on [eth-usdc.tide.eth](https://sepolia.app.ens.domains/eth-usdc.tide.eth), fills on [TideRouter](https://sepolia.etherscan.io/address/0x9A5883AA2068a133779cdaEB2b67Cc22f16b85B3), hook pool on [TideHook](https://sepolia.etherscan.io/address/0x45DbC91351767e2C801623C87FbD88eA2Bc36A88)

Built at ETHGlobal Tokyo 2026 on two 2026 papers with no prior implementation: *Partially Active AMMs* (Ko, [arXiv 2602.09887](https://arxiv.org/abs/2602.09887)) and *Collateralized Liquidity Scaling* (Kim & Park, [arXiv 2605.19267](https://arxiv.org/abs/2605.19267)).

## What is here

| Piece | Where | What it does |
| --- | --- | --- |
| Shared math | [`contracts/src/lib/TideMath.sol`](contracts/src/lib/TideMath.sol) | active split, N-scaled quotes, drift bound, solvency bound; checked against `research/tide_math.py` vectors |
| 1inch Aqua program | [`contracts/src/aqua/`](contracts/src/aqua) | three SwapVM opcodes on a redeployed `AquaSwapVMRouter`, shipped through the official Aqua registry |
| Uniswap v4 hook | [`contracts/src/v4/TideHook.sol`](contracts/src/v4/TideHook.sol) | same math via `beforeSwap` + `BeforeSwapDelta`, hook-owned ERC-6909 reserves |
| Governed parameters | [`contracts/src/TideParams.sol`](contracts/src/TideParams.sol) | on-chain mirror of the three ENS records; owner or manager only; revocable |
| ENSv2 (Sepolia) | [`client/scripts/ens-setup.ts`](client/scripts/ens-setup.ts), [`client/src/lib/ens/`](client/src/lib/ens) | `tide.eth` → user registry → `eth-usdc.tide.eth` (strategy) and `manager.tide.eth` (ENSIP-26 agent); per-key EAC role for the agent |
| World ID for Agents | [`client/src/lib/world.ts`](client/src/lib/world.ts), [`client/src/lib/agent.ts`](client/src/lib/agent.ts) | bind owner, RFC 9470 step-up before every write, server-side validation, denied paths |
| Dashboard + agent | [`client/`](client) | Next.js app: records, active/passive split, fills, proposals, approve/deny, agent log, frontier chart |
| Research | [`research/`](research) | frontier solver, Monte-Carlo, test vectors, figures |

## Mechanism in one paragraph

Each block the strategy exposes `active = λ · inventory`; the rest is passive and invisible to that block. The first fill of a block (the informed one in the PA-AMM model) is priced on the active constant-product curve, so the arbitrageur sees λ of the vault. Every later fill in the block is priced on the virtual curve `(N·x)(N·y) = k` over the current active reserves, so uninformed traders see slippage of about `q/(N·x)`. A guard bounds how far the virtual curve can be pushed: a fill that would move the price more than δ from the block's anchor is re-priced on the active curve, and any fill must be deliverable from active + passive (the collateral buffer); if it dips into passive, the active side is re-split from the new totals. SwapVM and v4 have no block hook, so the re-split is lazy on the first quote of a block. In steady state LVR is `(σ²/8)·E·Δ / (2 − λ)` per block: λ = 0.5 cuts it by 33 %, λ = 0.25 by 43 % (Monte-Carlo and closed form agree to three digits).

## Deployments (Sepolia)

| Contract | Address |
| --- | --- |
| Aqua registry (official 1inch) | `0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a` |
| TideRouter (redeployed AquaSwapVMRouter + Tide opcodes) | `0x9A5883AA2068a133779cdaEB2b67Cc22f16b85B3` |
| TideParams | `0xeDb9BC901D74382170CE603b23aFB5FD43d28176` |
| TideApp (program/order builder) | `0x73080e4C38021c3fE51c93D677f05898Cc357682` |
| TideHook (Uniswap v4, PoolManager `0xE03A…3543`) | `0x45DbC91351767e2C801623C87FbD88eA2Bc36A88` |
| ENS user registry for `tide.eth` | `0xC02D402724B76c1CBa8d35988CAA8F9e1E31b97C` |
| Strategy resolver (`eth-usdc.tide.eth`) | `0x42a719F03f4921783367A1017F389Ee310c16B2E` |
| Agent resolver (`manager.tide.eth`) | `0x3553ff32412FC570182b6e37935A11F8555Bd5F5` |
| Strategy hash (Aqua order hash) | `0x86a1ac9e81b0e6eb2749bce0304ede0d434dd445d93717c6035c75a2034ff15d` |

Owner `0xF23be0fbE9DEf26570278F91f3F150Af015a3ECf`, manager agent `0xedbA94c7292Aef84AC220E14ffF642aC4D749647`. All transaction hashes are in `contracts/broadcast/` and `client/data/ens.json`.

## Run it

Prerequisites: Foundry ≥ 1.3, Node 22 + pnpm, Python 3.11+ with numpy/matplotlib, an Ethereum mainnet RPC (fork only, no spend) and a Sepolia RPC. Copy `.env.example` to `.env`.

```bash
git clone --recurse-submodules git@github.com:asengupta07/tide.git && cd tide
```

Contracts and tests (43 tests: math vectors, three opcodes, hook, cross-venue parity, program-order reverts, two-swaps-in-one-block, governance):

```bash
cd contracts && forge test
```

Regenerate the reference vectors, frontier and Monte-Carlo figures:

```bash
python3 research/tide_math.py && python3 research/frontier.py && python3 research/sim.py
```

One fill on 1inch Aqua on a mainnet fork with real WETH/USDC (starts anvil, funds the maker, deploys, ships, fills twice in one block):

```bash
cd contracts && ./script/fork-demo.sh
```

Sepolia (already done, scripts are idempotent): `Deploy.s.sol`, `SepoliaDemo.s.sol` (ship + fill), `DeployHook.s.sol` (hook + pool + swap), then `pnpm ens:setup` in `client/`.

App (landing, strategies, wizard, per-strategy dashboard) and agent:

```bash
cd client && pnpm install && pnpm dev          # http://localhost:3000, connect a Sepolia wallet (RainbowKit)
# /app/new: name it (<label>.tide.eth to your wallet, own resolver, records seeded), approve, TideParams.init,
#           Aqua.ship, optional one-multicall delegation to manager.tide.eth. Four signatures.
pnpm tsx --env-file=../.env scripts/e2e-new-strategy.ts  # same flow with a throwaway wallet, end to end
pnpm agent propose --sigma 0.8 --strategy eth-usdc.tide.eth   # agent proposes λ*, prints the approval URL
pnpm tsx --env-file=../.env scripts/test-agent-flow.ts   # denied / replayed / expired / forged paths
pnpm tsx --env-file=../.env scripts/ens-agent-check.ts   # agent can set lambda, cannot touch anything else
pnpm tsx --env-file=../.env scripts/ens-revoke.ts        # one EAC call per record + drop on-chain manager
```

## Sponsor integrations

### 1inch Aqua / SwapVM

- Official contracts: Aqua registry at the canonical address; the router is the swap-vm `main` template (`lib/swap-vm` submodule) redeployed with one change, the opcode set. `contracts/src/aqua/TideRouter.sol:21`.
- Three custom opcodes in reserved third-party slots of `OpcodeList.sol`, one per family bank, no 1inch opcode overwritten: `ACTIVE_SPLIT` 0x92, `VIRTUAL_XYC` 0x52, `BUFFER_GUARD` 0x22 (`contracts/src/aqua/instructions/TideProgram.sol:24-26`). Dispatch extends `AquaOpcodes` (`contracts/src/aqua/TideOpcodes.sol:16`).
- Instruction order is security-critical and enforced on-chain: every Tide opcode scans the program and reverts unless the order is `ACTIVE_SPLIT → VIRTUAL_XYC → BUFFER_GUARD`, each exactly once (`TideProgram.sol:32`). Tests: reordered, missing and duplicated programs revert (`contracts/test/aqua/TideAqua.t.sol`, `test_ReorderedProgram_Reverts` and neighbours).
- Lazy re-split and two swaps in one block: `ActiveSplit.sol:53`, test `test_TwoSwapsInOneBlock_ThenLazyResplitNextBlock`.
- Onchain token transfers: Sepolia fill `0x4f39d7cb…52cf97` (0.02 WETH → 55.55 USDC through Aqua `pull`/`push`), plus the mainnet-fork demo above with real WETH/USDC.
- Program layout: `TideApp.program()` (`contracts/src/aqua/TideApp.sol:43`).

### Uniswap v4

- Hook: `contracts/src/v4/TideHook.sol`; pricing in `_getUnspecifiedAmount` (line 92) and `_computeWithAmounts` (line 142); JIT guard in `addLiquidity`/`removeLiquidity` (lines 197, 203). Permissions: `beforeInitialize`, `beforeSwap` + `beforeSwapReturnDelta`, `beforeAddLiquidity`, `beforeRemoveLiquidity`.
- Cross-venue parity test: `contracts/test/CrossVenue.t.sol` (same trade sequence, identical amounts on Aqua and v4).
- [FEEDBACK.md](FEEDBACK.md) at the repo root; Developer Feedback Form submitted with its link.
- Sepolia: pool `0xdbb37055…4a79b`, swap `0xef3a534a…1e2978` (0.01 WETH → 27.27 USDC, quote == fill).

### ENSv2 (Sepolia)

- `tide.eth` owns a UserRegistry proxy deployed through the VerifiableFactory; `eth-usdc.tide.eth` and `manager.tide.eth` are registered in it, each with its own PermissionedResolver proxy (`client/scripts/ens-setup.ts`).
- Records are written and read on-chain, nothing hard-coded: `lambda`, `N`, `delta`, `strategyHash`, `venue` on the strategy name; ENSIP-26 `agent-context` and `agent-endpoint[web|a2a]` on the agent name. Reads go through the Universal Resolver (`client/src/lib/ens/client.ts:52`).
- Enhanced Access Control: the agent holds `ROLE_SET_TEXT` on exactly three key resources via `grantSetterRoles` (`ens-setup.ts:278`); `scripts/ens-agent-check.ts` shows `setText(lambda)` succeeding and `setText(strategyHash)`, `setAddress`, `setResolver`, `unregister` reverting. Revoke: `scripts/ens-revoke.ts`.
- Agents as namespaces: `manager.tide.eth` is the agent's identity, endpoint and audit trail.

### World ID for Agents

- Official dev environment (`https://sandbox.auth.world.org`), discovery read at runtime. Bind → request → completion → validated result → protected action: `client/src/lib/world.ts` (`beginAuth` line 78 sets `prompt=login`, `max_age=0`; `completeAuth` line 109 verifies signature, `iss`, `aud`, `nonce`, `iat`, `auth_time`) and `client/src/lib/agent.ts` (`handleCallback` line 98, pairwise-subject match line 146).
- Denied / expired / cancelled / replayed / forged paths leave the records unchanged: `client/scripts/test-agent-flow.ts`.
- Client secret only in the server module; never in the repo (`.env.example`).
- Debrief: [docs/world-debrief.md](docs/world-debrief.md).

### Curvegrid

Dashboard (`client/`) doubles as the digital-asset dashboard; the manager agent (`client/src/lib/agent.ts`, `client/scripts/agent.ts`) as the AI-agent entry. MultiBaas not used.

## Team

_(name · GitHub · X handles: fill in)_

## Layout

```
contracts/   Foundry: src/lib, src/aqua, src/v4, TideParams, tests, scripts, deployments/
client/      Next.js app router (TypeScript): dashboard, API routes, agent, ENS + World libs, scripts/
research/    tide_math.py (vectors), frontier.py, sim.py, figures, JSON outputs
docs/        idea brief, dossier, world-debrief.md, whitepaper source
```

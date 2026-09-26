# Changelog

Dated, newest first. Addresses and transaction hashes for the current deployment live in `README.md`
and `contracts/deployments/`. How to redeploy and what to touch afterwards: `docs/DEPLOYMENT.md`.

## Sep 26, 2026 (evening)

**Side-by-side fork demo**
- `contracts/script/side-by-side.sh`: plain `FeeFlatIn XYCSwap Salt` strategy vs Tide on a mainnet fork,
  same maker, inventory, router, registry, price path. Eight blocks; each block one transaction that
  fills both pools (arbitrageur, $200 retail, once a $5,000 order). Terminal renderer reads the
  `Swapped` events from the receipts. Result: arbitrage extraction about 35 % lower on Tide, retail
  6 bp better as a follow-on fill, guard visible on the large order, first-fill cost shown honestly.

**Guardrails: autopilot inside bounds, human only outside**
- `TideParams.Bounds` per strategy: λ range, largest λ move per write, N max, cooldown. Defaults at
  `init` (1000 to 9000, 2500, 8, 3600 s); owner changes with `setBounds`; `withinBounds` view. A manager
  write outside reverts with `OutsideBounds`; owner writes are unbounded. 47 tests.
- Agent: inside bounds it applies λ/δ itself (ENS + `TideParams.set`), proposal `applied` with
  `auto: true`. Outside, the World step-up as before; on approval it writes ENS, status `approved`, and
  the owner applies on-chain from the dashboard (`/api/agent/applied` verifies before marking).
- Dashboard: guardrails card with owner edit, "Apply on-chain" button, copy updated. Landing and wizard
  copy: the human is needed where policy changes, not per tick.
- Redeployed: params `0x2Cfc…558C`, router `0xbc95…390a`, app `0x332c…7BfF`, hook `0xeC07…6A88`,
  pool `0xda22…d444`, strategy hash `0x3a21…e590`; fill `0x4087…3b95`, hook swap `0x0bce…93fb`.
  Previous strategy docked (`0xda84…8694`).
- Live on Sepolia, both paths: inside guardrails, λ 5000 → 7400, δ 20 → 8 applied by the manager alone
  (ENS `0x560b…d08e`, params `0x02d4…eb66`); outside, λ 7400 → 2000, N 4 → 3, δ 8 → 23 approved with a
  fresh World ID proof, ENS `0xf45c…bd22` by the agent, applied by the owner's wallet `0x8230…496d`.

**Whitepaper v0.2**
- Rewritten shorter (six pages): abstract, model, mechanism, three propositions (steady-state LVR,
  virtual depth and solvency, the fee-rebate bound), frontier, simulation, implementation, governance,
  limitations. Event and sponsor material removed; figure titles neutralised.

**Bind needs the wallet's signature**
- `/api/world/bind` accepted any `?owner=`: anyone could bind their World ID to another owner's strategy
  and approve its proposals. Now the owner's wallet signs `Tide: bind World ID to <owner> at <ts>`
  (EIP-191, ten-minute window) and the route verifies it before starting OIDC. Dashboard button signs
  through wagmi. One app client, many owners, each with their own pairwise `sub`.

**World ID live path**
- OIDC client `Tide manager` registered in the sandbox portal through the World ID MCP
  (`request_oidc_client_registration`, approved in the portal). `client_secret_post`, redirect
  `https://localhost:3000/api/world/callback`, sector `localhost`.
- Sandbox refuses `http://localhost` callbacks (bare `invalid_request`). Local dev is now HTTPS:
  `pnpm dev` (HTTPS by default, `dev:http` for plain) with a mkcert certificate in `client/certificates/` (gitignored). `.env.example`,
  `.claude/launch.json`, README updated.
- First secret was lost before saving; a second one was issued (secrets overlap) and revocation of the
  first staged. Nothing re-registered.
- Owner bound, then a full step-up write: proposal `3509d7d32778`, λ 5000 → 3300, δ 20 → 15 bps,
  ENS `setText` `0xfec2442d…bffdcb`, `TideParams.set` `0xe032df2b…3069a5`. Debrief updated.

**Model review: the fee-rebate bound** (`MATHEMATICS_MODEL.md` § 8, whitepaper Prop. 4)
- Found: the N-curve is a rebate paid by the LP. With fee 0 a plain-then-virtual round trip inside δ
  drains about (N − 1)·N·δ²/4 of the active side every block, no price gap needed (~USD 28/block on a
  USD 2M pool at N 4, δ 0.5 %, some 830× the LVR saved). Neither λ, N nor δ bounds it.
- Fix: flat fee on tokenIn stored in `TideParams`, applied by `ActiveSplit` and `TideHook` from the same
  record; invariant `(N − 1)·δ ≤ 2·fee` in `TideMath.checkParams`, enforced at `init`, `set`, `setFee`.
  `FeeFlatIn` dropped from the SwapVM program; `TideApp.Config` lost `feeBps`.
- Manager now proposes δ too: three one-block moves (`3·σ·√Δ`), capped by the bound; lowers N if the
  box is empty. Dashboard shows the fee as a fourth setting; wizard clamps δ to what the fee backs.
- Tests 46 (round trip loses under the bound, bound rejects bad triples, fee gross/net round trip).
- Redeployed on Sepolia: router `0xfDD5…0957`, params `0x4608…44FF`, app `0x246d…705C`,
  hook `0xEcbF…AA88`, pool `0x81e8…9ea4`, strategy hash `0xd09a…e4f8`. Old strategy docked.
  Defaults λ 5000, N 4, δ 20, fee 30 bps.
- Frontier stays at 1 bp: its first-order fee term breaks at 30 bp (drives λ* to the grid edge).
  Documented as the LVR-versus-tracking optimum, not fee-calibrated.
- Gas: first-of-block fill 118,821 (+35.6k over plain), later fill 119,551 (+36.3k).
- FEEDBACK.md: v4 `_getSwapFeeAmount` is event-only; fee has to be netted in `_getUnspecifiedAmount`.

## Sep 26, 2026 (day)

- Landing page and dashboard redesign: Paper shaders, island nav, bezels, native charts, block
  animation, readable non-technical dashboard, no network names in copy.
- Multi-tenant product: RainbowKit wallet, `/app/new` wizard (name → approve → init → ship → delegate),
  per-strategy dashboards and agent.
- Manager autopilot: realised ETH volatility from public hourly candles, 15-minute tick, proposes when
  λ* moves ≥ 500 bps; only for delegated strategies with a bound owner and no pending proposal.
- `/api/state` serves the last good snapshot with `stale: true` on RPC hiccups.
- Logo: curling crest wave; PNG icons; mobile nav.

## Sep 25, 2026

- Foundry project with swap-vm, Aqua and v4 deps. `TideMath` checked against `research/tide_math.py`
  vectors. Three opcodes (`ACTIVE_SPLIT` 0x92, `VIRTUAL_XYC` 0x52, `BUFFER_GUARD` 0x22) on a redeployed
  `AquaSwapVMRouter`; `TideApp` order builder; `TideParams`; `TideHook` (OZ `BaseCustomCurve`);
  cross-venue parity test.
- Frontier solver and Monte-Carlo (steady-state LVR 1/(2 − λ) confirmed to three digits).
- Mainnet-fork demo, Sepolia deploy, ship, fill, hook swap.
- ENSv2 on Sepolia: user registry under `tide.eth`, `eth-usdc.tide.eth` and `manager.tide.eth`,
  records, per-key EAC role for the agent, revoke script.
- World ID step-up backend (discovery, PKCE, JWKS validation, bind, denied-path harness), agent CLI,
  dashboard, whitepaper, README, FEEDBACK.md, world debrief.

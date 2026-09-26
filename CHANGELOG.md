# Changelog

Dated, newest first. Addresses and transaction hashes for the current deployment live in `README.md`
and `contracts/deployments/`. How to redeploy and what to touch afterwards: `docs/DEPLOYMENT.md`.

## Sep 27, 2026

**Example strategies and templates**
- `pnpm seed:examples` (`client/scripts/seed-examples.ts`): from the owner wallet, creates and funds three preset
  strategies on Sepolia and publishes every owner strategy on Explore as a live listing and a reusable template.
  Idempotent. Now live: `calm-eth-usdc` (λ 75%, N 2, δ 30 bp, guardrails 50 to 90%), `storm-eth-usdc`
  (λ 25%, N 8, δ 8 bp, guardrails 10 to 50%), `retail-link-usdc` (reference settings on LINK/USDC), plus
  listings for `eth-usdc` and `link-usdc-tide`. Each holds 0.1 WETH + 300 USDC or 5 LINK + 90 USDC.

**Trader entry and terminal**
- `/trade` is now a dedicated trader-facing entry page with a real live quote and route comparison.
  Execution lives at `/trade/market`, a compact terminal that keeps route liquidity, candles, price impact,
  recent fills, curve parameters, and the auto-routed order ticket visible together. Existing strategy links
  preserve their target through the new terminal URL. Dithered route waves, live water texture, execution
  bounds, and a terminal-map treatment give the entry page a stronger visual hierarchy.
- The order ticket now separates the executable full-inventory comparison from Tide's follow-on lane. It
  derives the live maximum size inside each strategy's delta guard, shows the modeled output and impact
  advantage, and offers a one-click demo size that remains eligible as the best route changes.
- A reusable Sepolia activity seeder discovers every independent funded WETH/USDC strategy and sends tiny,
  alternating fills in same-block waves. The live demo was seeded with 34 new successful swaps; the three
  LPs now expose 17, 13, and 10 verifiable fills in the terminal. Dense chart annotations are grouped by
  candle and direction into compact count markers instead of overlapping one label per transaction.
- Rewrote the trading experience in plain language: percentages replace basis points, route and
  price-impact labels explain what traders actually get, and the demo-size shortcut is gone.
- Tightened the Tide advantage into a compact, scannable callout with one output figure and clear
  eligibility details instead of the awkward split headline.
- Added real multi-market trading: the terminal now groups liquidity and routes by token pair, formats
  token decimals dynamically, and charts the selected asset. LINK/USDC launched with two independent
  Sepolia LPs and twelve successful on-chain fills alongside the existing WETH/USDC market.

**Whitepaper v0.3**
- New "Worked example" section: one block of the reference parameters on 1 WETH / 3,000 USDC with an
  arbitrageur, a small trade inside the band and a larger one the guard re-prices, as a flow diagram
  (Typst `fletcher`) plus the arithmetic. Compile needs network once to fetch the package.

**Dashboard polish**
- "Get a suggestion" opens the manager's answer in a modal (Escape, backdrop or X closes it); the
  suggestion history sits in a fixed-height scrolling list. Impact curve: legend below the chart, N-curve
  drawn only inside the δ band, axes scaled to the band. Polls that fail keep the last snapshot. Mobile
  WalletConnect wallets are offered only when `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` is set.
- `/trade` is now the dedicated Tide-only trader venue: pick a strategy, compare the live router quote
  against a same-inventory constant-product pool, and swap only from a non-owner wallet. The LP dashboard
  is explicitly for liquidity management; owners see quote previews but cannot fill their own strategy.
  Traders also get ETH/USD candles with the selected strategy's fills and a live Tide-vs-plain price-impact
  chart by order size.
  The market list discovers every initialized, funded registry strategy regardless of Explore publication,
  excludes incomplete or empty test entries, and falls back to another funded market instead of exposing a
  raw contract revert. Same-pair LPs are grouped into one market: the router multicalls every executable Tide
  strategy and sends the order to the best single-LP quote, excluding the connected wallet's own liquidity.

**Trade from the dashboard, charts**
- `TideTaker` contract: quote and fill a strategy from a wallet in one call (traits built on-chain, exact
  pull, refund on exact-out, slippage limit). Deployed `0xD02D…1c98`, test added (54 tests).
- Dashboard "Market" section: ETH/USD candles (Coinbase, proxied) with the strategy's fills marked on them,
  a trade panel with live router quotes, the plain-pool comparison and one-tx fills, and a price-impact-
  by-size curve for the plain pool, Tide's first fill and Tide's follow-on fills from the live reserves.
- Fills carry block timestamps; the router log cache dedupes and serialises scans; strategy salt is kept
  on reindex.

**Hook verification**
- Four hook tests (round trip under the fee bound, `HookSwap` fee report, exact-out gross-up, guardrails on the
  pool key); cross-venue parity extended to eight trades over three blocks with exact-out both ways. 53 tests.
  `SwapHook` script gained `HOOK_MODE=in|out|reverse`; all three ran on the Sepolia pool with quote equal to fill.

**Audit fixes**
- `TideProgram.check` refuses any opcode other than the three Tide ones and `Salt`, so a `Jump` cannot
  route around `BUFFER_GUARD`; the static order is the runtime order. Router and app redeployed.
- Planning notes, the event dossier and scratch files removed from the repo.
- Contracts: `TideParams` keys are claimed only through the venues (`TideApp.init` checks the maker,
  `TideHook` claims its PoolId at initialize for an explicit owner), closing key squatting; hook burns 1000
  dead shares on the first deposit; `setBounds` rejects cooldown 0; `withinBounds` takes delta and applies
  the fee bound; dead `TidePrepared` event removed; `TideResplit`/`TideTopUp` fields named in fill order.
  48 tests. Gas re-measured swap-only: 57,402 plain, 77,234 first fill, 76,241 later (about +19k, not +35k).
- Backend: `propose`, `strategy/create`, `bind` and the new `agent/approval` need the owner wallet's
  signature (`lib/auth.ts`); `tick` needs `AGENT_TICK_SECRET`; `/api/state` no longer exposes approval URLs
  or OIDC state; delta/N overrides clamped to the fee bound; on-chain write before ENS with receipt checks;
  `markApplied` verifies status, sender and target; one pending proposal per strategy; provider URLs
  scrubbed from errors and logs; fills scanned from `deployBlock` in the deployments file and cached
  incrementally; the scheduler survives one failing strategy and runs autopilot for unbound owners inside
  the guardrails; step-up tokens must carry `auth_time`; discovery issuer pinned.
- UI: guardrails editor keeps focus (field moved out of render), edited in percent and minutes with
  validation and a mined receipt before "Saved"; what-if slider no longer snaps back; approve and bind go
  through signed JSON calls instead of raw redirects; no `tx/undefined` links; stale-data badge; approval
  window shown; visitor wording; approved page returns to the strategy; wizard signs the naming request,
  inits through `TideApp`, approves exact amounts, validates amounts, labels its controls; touch targets
  no longer inflate the block-animation bars; tertiary text contrast raised.
- Copy and docs: per-change World ID wording replaced by guardrails wording everywhere (landing, dashboard,
  README headline, whitepaper abstract, ENS agent record, brief note); stale gas and test counts; broken
  file:line pointers replaced by symbol names; `FEEDBACK.md` function name; planning notes marked
  superseded; `.env.example` pruned to what the code reads.
- Redeployed: params `0x1685…72aD`, router `0x65a2…a31e`, app `0x47ba…D12c`, hook `0x1391…AA88`, pool
  `0xeba8…e883`, strategy hash `0xd218…da70`; fill `0x214c…c3c0`, hook swap `0xdc2c…3944`.

- **MongoDB for all off-chain state.** `client/src/lib/db.ts` (one client per process, indexes on first use);
  `store.ts` and `registry.ts` are async over six collections: `strategies`, `proposals`, `authRequests`
  (TTL one hour, deleted on use), `bound`, `log`, `ens`. Agent, scheduler, routes, approved page and the
  scripts (`ens:setup`, `ens-revoke`, `ens-agent-check`, `reindex`, `test-agent-flow`) ported. `pnpm db:import`
  loads the old `client/data/*.json` files once. `MONGODB_URI` in `.env`; the dev server must be restarted
  to pick it up. The denied-path harness now forces proposals outside the guardrails so they take the
  step-up path.
- `pnpm reindex`: rebuilds `client/data/strategies.json` from chain (`ETHRegistry.getSubregistry`,
  `LabelRegistered` events, `strategyHash` records, `findOwner`, Universal Resolver). Makes the JSON index
  disposable; `state.json` stays the agent's off-chain working memory (auth sessions, proposals, log).
- `eth_getLogs` reads go through a 45,000-block chunker (publicnode caps at 50,000).

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

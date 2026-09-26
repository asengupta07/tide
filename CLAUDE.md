# Tide — ETHGlobal Tokyo 2026

Read `docs/tide-idea-brief.md` first (product, flow, user stories, acceptance criteria), then
[`MATHEMATICS_MODEL.md`](MATHEMATICS_MODEL.md) for the implemented formulas, block-by-block state
transitions, worked examples, parameter trade-offs, and research-frontier assumptions. Use
`docs/ethglobal-tokyo-2026-dossier.html` (Product A section) for architecture, build plan, sponsor
requirements, and prior art. `docs/DEPLOYMENT.md` is the redeploy / credentials / public-host guide and
`CHANGELOG.md` the dated log: update both whenever the process or the deployment changes.

## What we are building

A partially-active AMM with a collateral buffer (arXiv 2602.09887 + arXiv 2605.19267), shipped as:
1. A 1inch Aqua SwapVM program with three custom opcodes on a redeployed `AquaSwapVMRouter`
2. A Uniswap v4 hook using the same math (`lib/TideMath.sol`)
3. A manager agent that proposes λ/N/δ, gated by World ID for Agents fresh auth, writing ENSv2 text records on Sepolia via a scoped EAC role
4. A dashboard reading ENS records and fill events

Repo layout (decided Sep 25): `contracts/` is the Foundry project (all Solidity, tests, deploy scripts);
`client/` is a Next.js app-router TypeScript app holding the dashboard and the backend (agent, World ID,
ENS writes as API routes and scripts); `research/` holds the Python reference math and simulations;
`docs/` holds the brief, dossier, world debrief and whitepaper sources. Keep the shared math in one
library (`contracts/src/lib/TideMath.sol`); both venues import it.

## Non-negotiable sponsor requirements

- 1inch: official Aqua/SwapVM contracts; onchain fills demoed on a fork; small commits from the start, no squash
- Uniswap: `FEEDBACK.md` at repo root; README points to hook file and line numbers
- ENS: ENSv2 on Sepolia, no hard-coded records, live demo link, open source
- World: official dev environment (sandbox.auth.world.org); server-side token validation; denied/expired path must leave state unchanged; write `docs/world-debrief.md` as we go
- Curvegrid: README has one-sentence summary, team + socials, setup and test instructions

## Status (Sep 26, 2026)

Done and live on Sepolia: TideMath + vectors, three opcodes on `TideRouter`, `TideApp`, `TideParams`,
`TideHook`, cross-venue parity, mainnet-fork demo (`contracts/script/fork-demo.sh`), Sepolia ship + fill +
hook swap, ENSv2 setup (registry, resolvers, subnames, records, scoped agent role, revoke script),
World ID step-up backend with denied-path harness, dashboard, README, FEEDBACK.md, world-debrief,
WHITEPAPER.pdf. Addresses in `README.md` and `contracts/deployments/`.

Sep 26 model review: the deep curve was drainable with a zero fee (sell on the active curve, buy back on
the N-curve inside δ, every block). Fixed by a flat fee on tokenIn stored in `TideParams` (read by both
venues) and the invariant `(N − 1)·δ ≤ 2·fee` enforced at init/set/setFee; the manager now proposes δ
too (three one-block moves, capped by the bound). Everything redeployed (new router, params, app, hook,
strategy hash); `MATHEMATICS_MODEL.md` § 8 has the derivation and worked example. Guardrails (Sep 26 evening): owner-set bounds
in `TideParams` bind the manager; autopilot applies inside them with no human; outside them the World
step-up, then the owner's wallet applies. World client `Tide manager`
registered via the World ID MCP (sandbox needs an HTTPS callback: `pnpm dev` (HTTPS by default), see README); live
approve path proven (proposal 3509d7d32778, ENS + TideParams txs in README). Open: team/socials in README,
video, public deployment of `client/` for the ENS live-demo link (new hostname = new World client + re-bind).

## Build order (from the dossier)

1. Foundry repo, fork script, Aqua hackathon template compiling
2. `TideMath` with unit tests against `research/frontier.py` reference values
3. `_ACTIVE_SPLIT` opcode in a test program, then `_VIRTUAL_XYC`, then `_BUFFER_GUARD`
4. Router redeploy, `TideApp.ship()`, first on-fork fill (impersonate a KycNFT resolver)
5. `TideHook` passing the same test vectors
6. Agent: propose → World step-up → ENS write; record the denied path
7. Dashboard, whitepaper, video, README checkboxes

## Conventions

- Solidity: Foundry, pinned solc, `forge fmt`, tests for every opcode including "two swaps in one block" and reordered-program-reverts
- Extend `AquaOpcodes`, claim a reserved third-party opcode slot in `OpcodeList.sol`; never overwrite a 1inch opcode
- Python research scripts live in `research/` and emit JSON the contracts' tests read
- Never commit secrets; World client secret and RPC keys in `.env`, `.env.example` checked in
- Commit messages: imperative, one change each, no AI attribution of any kind

## Known traps

- SwapVM has no block hook: the active re-split is lazy on the first quote of a new block. Document and test it.
- Live Aqua routers predate the hackathon template's opcode layout; use the template router and say why.
- Resolver gating on Aqua: fork must impersonate a KycNFT holder (ask at 1inch booth if the test resolver address is unclear).
- World ID for Agents: validate ID tokens in the backend; the pairwise `sub` must match the bound owner; a stale token must be rejected.

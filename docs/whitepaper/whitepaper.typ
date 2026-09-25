#set document(title: "Tide: a partially-active AMM with a collateral buffer, on 1inch Aqua and Uniswap v4", author: "Tide team, ETHGlobal Tokyo 2026")
#set page(paper: "a4", margin: (x: 2.2cm, y: 2.2cm), numbering: "1")
#set text(font: "New Computer Modern", size: 10.5pt)
#set par(justify: true)
#set heading(numbering: "1.1")
#set math.equation(numbering: "(1)")
#show link: underline
#show raw.where(block: false): it => box(fill: luma(240), inset: (x: 2pt), outset: (y: 2pt), radius: 2pt, it)

#align(center)[
  #text(size: 20pt, weight: "bold")[Tide]
  #v(2pt)
  #text(size: 13pt)[A partially-active AMM with a collateral buffer, shipped as a 1inch Aqua SwapVM program and a Uniswap v4 hook, governed through ENSv2 and World ID]
  #v(6pt)
  #text(size: 10pt)[ETHGlobal Tokyo 2026 · September 26, 2026 · #link("https://github.com/asengupta07/tide")[github.com/asengupta07/tide] · Sepolia]
]

#v(8pt)
#block(inset: (x: 1.2cm))[
  *Abstract.* Passive liquidity providers lose money to the first trade of every block: the pool's price is stale until someone trades, and an arbitrageur who knows the fresh price trades against the whole pool at the old one. Tide shows that arbitrageur only a fraction $lambda$ of the maker's inventory, quotes uninformed follow-on flow against an $N$-times deeper virtual curve backed by the idle remainder, and bounds how far that virtual curve can be pushed with a drift threshold $delta$. We prove that steady-state loss-versus-rebalancing falls to $1\/(2-lambda)$ of a plain constant-product pool (33% saved at $lambda = 0.5$, 43% at $lambda = 0.25$) and state the solvency invariant the buffer must satisfy; 10,000-path Monte-Carlo agrees with the closed form to three digits. The same 100-line math library prices both venues: three custom SwapVM opcodes on a redeployed Aqua router and a `beforeSwap` hook with hook-owned reserves, and a cross-venue test asserts identical fills. The three parameters live as ENSv2 text records on `eth-usdc.tide.eth`; a manager agent, `manager.tide.eth`, holds an Enhanced Access Control role for exactly those keys and may write only after the owner completes a fresh World ID authentication. Everything is live on Sepolia and reproducible on a mainnet fork.
]

= The problem in one figure

#figure(
  image("../../research/fig_wealth.png", width: 85%),
  caption: [LP wealth relative to HODL over one trading day, $sigma = 60%$ annualised, 12-second blocks, 500 paths. A fully active constant-product pool ($lambda = 1$) bleeds LVR every block; exposing half ($lambda = 0.5$) or a quarter ($lambda = 0.25$) of the reserves per block cuts the bleed. Fees are not modelled, so every curve sits below zero and the gaps are pure LVR saved.]
)

Loss-versus-rebalancing (LVR) is the cost of quoting a stale price. Milionis, Moallemi, Roughgarden and Zhang show that for a constant-product pool it accrues at $sigma^2\/8$ of pool value per unit time: at 60% annualised volatility about 4.5% of capital per year before fees. Every shipped mitigation either prices the arbitrage (dynamic and auctioned fees), removes intra-block ordering (batch clearing) or rebates it. None reduces what the arbitrageur can see. Two 2026 papers do, and neither had an implementation: Ko's partially active AMM @ko2026 and Kim and Park's collateralized liquidity scaling @kimpark2026. Tide is both, in one program.

= Model and notation

The price $P_t$ follows a geometric Brownian motion with volatility $sigma$; blocks have length $Delta$. A constant-product pool with reserves $(x, y)$ has value $E = x P + y$ and marginal price $P = y\/x$. Within a block the pool is stale; an arbitrageur trades it to the new price and keeps the difference. For a curve of value $V$ the expected per-block loss is, to first order in $Delta$,
$ "LVR" = (sigma^2)/8 dot V dot Delta. $ <eq:lvr>

Tide adds three parameters. $lambda in (0, 1]$ is the fraction of reserves exposed per block; $N >= 1$ is the virtual depth multiplier; $delta$ is the drift bound in basis points.

= Mechanism

Per block, per strategy:

1. *Active split (lazy).* On the first quote or fill of a block, `active = lambda * total` for each token; the remainder is passive and invisible to the block. Neither SwapVM nor Uniswap v4 has a block hook, so the split happens inside the first `quote()`/`swap()` of the block and is persisted only by a fill.
2. *First fill = informed.* The first fill of a block is priced on the plain constant-product curve over the active reserves ($N = 1$). The arbitrageur sees $lambda$ of the vault.
3. *Later fills = virtual curve.* Every later fill in the block is priced on $(N x_a)(N y_a) = k$ over the current active reserves $(x_a, y_a)$. A trade of size $q$ sees slippage $approx q\/(N x_a)$ instead of $q\/x_a$.
4. *Drift bound.* The reserves right after the first fill are the block's anchor. A later fill that would move the virtual price outside $[P_"anchor"(1-delta), P_"anchor"(1+delta)]$ is informed-sized and is re-priced on the active curve.
5. *Solvency and top-up.* Any fill must be deliverable from `active + passive`; passive is read live (the maker's Aqua balance, or the hook's ERC-6909 claims). A fill that dips into passive triggers a re-split from the new totals: the buffer tops the active side up at the current marginal price, which creates no arbitrage.

The SwapVM program is `[FeeFlatIn?] ACTIVE_SPLIT VIRTUAL_XYC BUFFER_GUARD Salt`. Instruction order is security-critical, so every Tide opcode parses the whole program and reverts unless the three opcodes appear once each in that order (`TideProgram.check`). The v4 hook runs the same five steps inside `beforeSwap` and returns a `BeforeSwapDelta` for the whole amount.

#figure(
  table(
    columns: (auto, auto, auto, auto),
    align: left,
    [*Opcode*], [*Slot*], [*Bank*], [*Encoding*],
    [`ACTIVE_SPLIT`], [`0x92`], [balances tuning], [`[address params]`],
    [`VIRTUAL_XYC`], [`0x52`], [swap curves], [`[address params]`],
    [`BUFFER_GUARD`], [`0x22`], [conditions and guards], [`[address params]`],
  ),
  caption: [Reserved third-party slots claimed in 1inch's `OpcodeList.sol`; no 1inch opcode is overwritten. Each opcode reads $lambda, N, delta$ from `TideParams`, keyed by the Aqua order hash (or the v4 `PoolId`).]
)

= Propositions

*Proposition 1 (activeness scales LVR).* Let a Tide strategy with total equity $E$ expose active reserves $A = lambda E$ at the top of each block. The block's first fill faces a constant-product curve of value $lambda E$, so its expected loss is $lambda$ times @eq:lvr. In steady state the passive part lags the market and the price gap the arbitrageur closes accumulates; the expected per-block loss converges to
$ EE["LVR"_"Tide"] = (sigma^2)/8 dot E dot Delta dot 1/(2-lambda). $ <eq:steady>

_Proof._ Let $g_t = ln(P_t\/P^"pool"_t)$ be the log gap between the market and the pool's marginal price at the top of block $t$, before the fill. The fill closes the gap on the active slice; after the re-split the pool's price is the reserve-weighted mix of the active part (at $P_t$) and the passive part (still at the old pool price), so the gap carried into the next block is $(1-lambda) g_t$ plus the next return $r_(t+1)$, which is $N(0, sigma^2 Delta)$. Hence $g$ is an AR(1) with coefficient $(1-lambda)$ and stationary variance $sigma^2 Delta \/ (1-(1-lambda)^2) = sigma^2 Delta \/ (lambda(2-lambda))$. The constant-product loss for closing a gap $g$ on a curve of value $lambda E$ is $lambda E g^2\/8$ to second order, so $EE["LVR"] = (lambda E\/8) dot sigma^2 Delta\/(lambda(2-lambda))$, which is @eq:steady. The first-order single-block statement is the $g$-fresh case $g_t = r_t$. $square$

Simulation confirms the ratio $1\/(2-lambda)$ to three digits (@tab:sim). The gap dynamics are exactly those of Section 3 of @ko2026; we do not re-derive them.

*Proposition 2 (the cost, solved numerically).* Because only $lambda$ of the reserves rebalance, the pool's token weight $w_t$ drifts from the invariant's target $theta = 1\/2$. The deviation follows an AR(1) with decay $(1-lambda)$ and shock $r_t\/4$. The LP chooses $lambda$ to minimise
$ "LVR"(lambda) - "Fees"(lambda) + kappa sum_t (w_t - theta)^2, $ <eq:objective>
where fees on arbitrage flow are $f dot (lambda E\/4) dot EE|r| $ per block. LVR and tracking error scale with $sigma^2$ while fees scale with $sigma$, so the optimum falls as volatility rises. `research/frontier.py` solves @eq:objective on a grid with $f = 1$ bp and $kappa$ calibrated so $lambda^* = 0.5$ at $sigma = 60%$; the manager agent reads $lambda^*$ off the resulting frontier.

#figure(
  image("../../research/fig_frontier.png", width: 80%),
  caption: [The activeness frontier: objective @eq:objective against $lambda$ for several volatilities; $lambda^*$ is 1.0 at $sigma = 20%$, 0.5 at 60%, 0.24 at 100%.]
)

*Proposition 3 (virtual depth with a buffer, solvency invariant).* Quoting follow-on flow against $(N x_a)(N y_a) = k$ reduces slippage of a trade of size $q$ from $approx q\/x_a$ to $approx q\/(N x_a)$; at $N = 4$ a trade of 1% of active reserves gets 3.97 times less slippage (@tab:slip). The virtual curve can promise up to $N y_a$, which the pool does not hold. With the drift bound $delta$ measured against the block anchor, the most the virtual curve can be asked to deliver in one block before a re-split is
$ y_max = N y_a (1 - sqrt(1-delta)), $
so the strategy is solvent whenever $ y_a + B >= N y_a (1 - sqrt(1-delta)), $ with $B$ the passive buffer. For the defaults $N = 4$, $delta = 0.5%$ the right-hand side is $1.0%$ of $y_a$, far inside the active slice; the buffer only engages for aggressive settings, and `BUFFER_GUARD` reverts any fill beyond `active + passive` regardless. `TideMath.maxOutWithinDrift` computes $y_max$ and the test suite checks it is exactly the boundary of `driftExceedsRef`.

= Simulation

10,000 GBM paths, $sigma = 60%$, 12-second blocks, one day, arbitrageur trades the active slice to the new price every block (`research/sim.py`).

#figure(
  table(
    columns: 5,
    align: (left, right, right, right, right),
    [*$lambda$*], [*LVR / day*], [*simulated ratio*], [*$1\/(2-lambda)$*], [*saved*],
    [1.00], [0.01233%], [1.000], [1.000], [0%],
    [0.50], [0.00822%], [0.667], [0.667], [33.3%],
    [0.25], [0.00705%], [0.571], [0.571], [42.9%],
  ),
  caption: [LVR per day as a fraction of capital. $lambda = 1$ reproduces $sigma^2\/8\/365 = 0.01233%$.]
) <tab:sim>

#figure(
  table(
    columns: 3,
    align: (left, right, right),
    [*$N$*], [*slippage, trade = 1% of active*], [*vs. $N = 1$*],
    [1], [0.990%], [1.0×],
    [2], [0.498%], [2.0×],
    [4], [0.249%], [3.97×],
    [8], [0.125%], [7.9×],
  ),
  caption: [Retail slippage on the virtual curve.]
) <tab:slip>

= Implementation

#figure(
  table(
    columns: 2,
    align: left,
    [*Contract*], [*Role*],
    [`contracts/src/lib/TideMath.sol`], [shared math; checked against `research/tide_math.py` vectors (24 cases)],
    [`contracts/src/aqua/instructions/*.sol`], [the three opcodes and the program-order check],
    [`contracts/src/aqua/TideOpcodes.sol`, `TideRouter.sol`], [`AquaOpcodes` + Tide dispatch; router = swap-vm `main` template, opcode set swapped],
    [`contracts/src/aqua/TideApp.sol`], [program and Aqua order builder; `ship()` is sent by the maker to the official Aqua registry],
    [`contracts/src/TideParams.sol`], [governed $lambda, N, delta$; owner or manager; manager revocable],
    [`contracts/src/v4/TideHook.sol`], [`BaseCustomCurve` hook, hook-owned ERC-6909 reserves, pro-rata shares, JIT guard],
  ),
  caption: [Contract map.]
)

#figure(
  table(
    columns: 3,
    align: (left, right, right),
    [*Path*], [*gas*], [*Δ vs plain*],
    [plain `XYCSwap` fill on the same router (taker callback + Aqua push/pull included)], [83,226], [–],
    [Tide fill, first of block (re-split, storage write)], [116,365], [+33,139],
    [Tide fill, later in block (virtual curve + guard)], [116,636], [+33,410],
    [Tide v4 hook swap via `PoolSwapTest`], [≈168,000], [n/a],
  ),
  caption: [Gas (Foundry, `test/BaselineGas.t.sol`). The Tide overhead is three `TideParams.get` calls, one Aqua balance read in the guard and the program scan; it could be halved by caching parameters per block.]
)

Tests: 43 (`forge test`): vector parity with Python, every opcode, two swaps in one block, next-block re-split, informed-sized follow-on re-pricing, exact-out beyond inventory reverts, buffer top-up re-split, quote/swap consistency in both directions and modes, reordered/missing/duplicate program reverts, governance (manager can set, stranger cannot, revoke blocks writes, new $lambda$ applies at the next re-split), hook JIT guards, and cross-venue parity.

Live on Sepolia: router `0x9A58…85B3`, params `0xeDb9…8176`, hook `0x45Db…6A88`, strategy hash `0x86a1…f15d`; Aqua fill `0x4f39…cf97`, hook swap `0xef3a…2978`. A mainnet-fork script fills against the official Aqua registry with real WETH/USDC.

= Governance: the parameters are ENS records, the human is World ID

The three parameters are text records on `eth-usdc.tide.eth` (ENSv2, Sepolia), served by a PermissionedResolver proxy that the strategy owns. `manager.tide.eth` is an ENSIP-26 agent name whose wallet holds `ROLE_SET_TEXT` on exactly three EAC resources, `keccak(lambda)`, `keccak(N)`, `keccak(delta)`, granted with `grantSetterRoles`; on-chain it is the `manager` of `TideParams`. It cannot set `strategyHash`, an address, the resolver, or unregister the name; a script demonstrates each revert. Revocation is one `revokeRoles` per key plus `setManager(0)`.

The agent proposes $lambda^*$ from the frontier. The backend then starts an OpenID Connect step-up with the World ID for Agents dev environment: `prompt=login`, `max_age=0`. The ID token is validated server-side (JWKS/RS256, `iss`, `aud`, `nonce`, `iat` ≤ 120 s, `auth_time` not before the request) and its pairwise `sub` must equal the owner bound at setup. Only then does the agent call `setText` and `TideParams.set`. Denied, cancelled, timed-out, replayed and forged responses all leave the records unchanged; a harness drives each path and asserts it.

= Sponsor integration rationale

*1inch Aqua.* The passive reserve _is_ the maker's wallet balance: Aqua pulls only at fill time and the Shared Liquidity Ratio lets one balance back several positions. Tide needed a place where "the pool does not hold what the virtual curve promises" is the normal state, and Aqua is that place. SwapVM's byte programs let the three mechanisms be composed as opcodes in reserved slots on the official router template.

*Uniswap v4.* The hook proves the mechanism is venue-agnostic: same library, identical fills. `BeforeSwapDelta` carries the custom curve; hook-owned ERC-6909 claims are the buffer. The missing block boundary callback is the main friction (see `FEEDBACK.md`).

*ENSv2.* Parameters must be readable by anyone, writable by exactly one scoped role, and auditable. Per-record EAC roles on a Permissioned Resolver and agent-as-namespace are the only primitive that gives per-key delegation with a one-call revoke.

*World ID for Agents.* Changing $lambda$ moves the owner's money; a replayed session must not be enough. Fresh authentication with a pairwise subject is the minimum assurance that _this_ human approved _this_ change now.

= Limitations and future work

- The "first fill of the block is the informed one" model is the PA-AMM assumption; a retail order that happens to be first pays the shallow curve. Priority-ordering heuristics or fee-based separation are future work.
- Steady-state LVR saving is capped at 50% as $lambda arrow 0$; the drift cost grows correspondingly. The frontier makes the trade-off explicit but the fee term is a first-order model.
- Parameters are mirrored on the trading chain by the agent after ENS approval; a cross-chain read of the ENS record would remove that step.
- Mainnet deployment, audit, fee optimisation (listed as open in @ko2026), and multi-pair rebalancing are out of scope.

#bibliography("refs.bib", style: "ieee")

#pagebreak()
= Appendix: sponsor requirements to file and line

#table(
  columns: (auto, auto),
  align: left,
  [*Requirement*], [*Where*],
  [1inch: official Aqua/SwapVM contracts, router redeployment], [`contracts/src/aqua/TideRouter.sol:21`, submodule `contracts/lib/swap-vm` (main), Aqua registry `0x1111113C…a90a`],
  [1inch: custom opcodes, slots, order], [`contracts/src/aqua/instructions/TideProgram.sol:24-32`, `ActiveSplit.sol:53`, `VirtualXYCSwap.sol:48`, `BufferGuard.sol:54`, `TideOpcodes.sol:16`],
  [1inch: onchain transfers in demo], [Sepolia tx `0x4f39d7cb…52cf97`; `contracts/script/fork-demo.sh`],
  [1inch: commit history], [small commits from Sep 25 evening, no squash],
  [Uniswap: hook + lines], [`contracts/src/v4/TideHook.sol:92,142,197,203`],
  [Uniswap: FEEDBACK.md, form], [`FEEDBACK.md` (root)],
  [ENS: Sepolia ENSv2, central, no hard-coded values], [`client/scripts/ens-setup.ts`, `client/src/lib/ens/client.ts:52,75,80`, records on `eth-usdc.tide.eth`],
  [ENS: live demo, open source], [dashboard `client/`, records readable via Universal Resolver],
  [World: dev environment, full journey, denied path, backend validation], [`client/src/lib/world.ts:78,109`, `client/src/lib/agent.ts:98,146`, `client/scripts/test-agent-flow.ts`],
  [World: debrief], [`docs/world-debrief.md`],
  [Curvegrid: README summary, team, setup and tests], [`README.md`],
)

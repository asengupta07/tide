#set document(title: "Tide: a partially active market maker with a fee-bounded virtual curve", author: "Team Tide")
#set page(paper: "a4", margin: (x: 2.3cm, y: 2.1cm), numbering: "1", footer: context [
  #set text(size: 8.5pt, fill: luma(110))
  #h(1fr) #counter(page).display() #h(1fr)
])
#set text(font: "New Computer Modern", size: 10.5pt)
#set par(justify: true, leading: 0.62em)
#set heading(numbering: "1.1")
#show heading.where(level: 1): it => block(above: 1.6em, below: 0.8em, it)
#set math.equation(numbering: "(1)")
#show link: underline
#show raw.where(block: false): it => box(fill: luma(242), inset: (x: 2pt), outset: (y: 2pt), radius: 2pt, it)

#align(center)[
  #text(size: 19pt, weight: "bold")[Tide]
  #v(4pt)
  #text(size: 12.5pt)[A partially active market maker with a fee-bounded virtual curve]
  #v(8pt)
  #text(size: 9.5pt, fill: luma(90))[Team Tide · Version 0.2 · September 26, 2026 · #link("https://github.com/asengupta07/tide")[github.com/asengupta07/tide]]
]

#v(10pt)
#block(inset: (x: 1.1cm))[
  #set text(size: 9.8pt)
  *Abstract.* A constant-product pool quotes a stale price until someone trades, and the first trader of each block is usually an arbitrageur who takes the whole pool at that price. Tide exposes only a fraction $lambda$ of a maker's inventory to that trade, quotes the block's later trades against a curve $N$ times deeper than the exposed slice, and bounds how far that deeper curve can be pushed by a drift threshold $delta$. We derive the steady-state loss-versus-rebalancing of the design, $1\/(2-lambda)$ of a plain pool, and confirm it by simulation to three digits. We then show that the deeper curve is a rebate paid by the maker: with no fee it can be drained every block by a round trip that needs no price information, and neither $lambda$, $N$ nor $delta$ bounds the loss. A flat fee $f$ does, provided $(N-1)delta <= 2f$; the contracts enforce this inequality on every parameter change. The same arithmetic library prices two venues, a 1inch Aqua SwapVM program and a Uniswap v4 hook, and a cross-venue test asserts identical fills. Parameters are ENS text records; a manager agent may change them only after the owner completes a fresh World ID authentication.
]

= Introduction

Loss-versus-rebalancing (LVR) is the cost a liquidity provider pays for quoting a price that is stale between blocks @mmrz2022. For a constant-product pool it accrues at $sigma^2\/8$ of pool value per unit time; at 60% annualised volatility that is about 4.5% of capital per year before fees. Deployed mitigations either price the arbitrage (dynamic or auctioned fees @amamm2024), remove intra-block ordering (batch clearing) or rebate part of the loss. None of them changes what the arbitrageur can see.

Two recent proposals do. Ko's partially active market maker @ko2026 exposes only a fraction of the reserves to each block; Kim and Park's collateralised liquidity scaling @kimpark2026 quotes uninformed flow against a virtual curve deeper than the reserves that back it. Tide combines both, adds the drift and solvency guards the combination needs, and, in the course of implementing it, finds and closes an economic hole in the virtual curve that neither proposal addresses.

#figure(
  image("../../research/fig_wealth.png", width: 72%),
  caption: [LP wealth relative to holding, one trading day, $sigma = 60%$, 12-second blocks, 500 paths, no fees. The fully active pool ($lambda = 1$) loses LVR every block; exposing half or a quarter of the reserves per block cuts the loss.],
)

= Model

The market price $P_t$ follows a geometric Brownian motion with volatility $sigma$; blocks have length $Delta$. A constant-product pool with reserves $(x, y)$ has marginal price $P = y\/x$ and value $E = x P + y$. For a curve of value $V$ the expected per-block loss to an arbitrageur who trades it to the new price is, to first order in $Delta$,
$ "LVR" = (sigma^2)/8 dot V dot Delta. $ <eq:lvr>

Tide has three governed parameters and a fee. $lambda in (0, 1]$ is the fraction of reserves exposed per block; $N >= 1$ the virtual depth multiplier; $delta$ the drift bound; $f$ a flat fee on the input token, set by the owner and tied to $N$ and $delta$ by Proposition 3.

= Mechanism

Per block and per strategy:

1. *Active split.* On the first quote or fill of a block, `active = lambda * total` for each token. The remainder is passive: it stays in the maker's wallet (or the hook's reserves) and is not quoted in this block. Neither venue has a block-boundary callback, so the split is lazy: it happens inside the first quote of the block and is persisted by the first fill.
2. *First fill.* The first fill of a block is priced on the plain constant-product curve over the active reserves ($N = 1$). The arbitrageur sees $lambda$ of the inventory.
3. *Later fills.* Every later fill is priced on $(N x_a)(N y_a) = k$ over the current active reserves $(x_a, y_a)$. A trade of size $q$ sees slippage of order $q\/(N x_a)$ instead of $q\/x_a$.
4. *Drift bound.* The reserves right after the first fill are the block's anchor. A later fill that would move the virtual price outside $[P_"anchor"(1-delta), P_"anchor"(1+delta)]$ is re-priced on the active curve.
5. *Solvency.* Any fill must be deliverable from active plus passive. A fill that dips into the passive part triggers a re-split from the new totals at the current marginal price, which creates no arbitrage.
6. *Fee.* Every fill pays $f$ on the input token. The curve and the drift guard see the net input; the taker pays gross; the fee rests in the passive part until the next re-split. Both venues read $f$ from the same parameter record as $lambda$, $N$ and $delta$, so a fill always pays the fee its parameters were checked against.

= Analysis

*Proposition 1 (activeness scales LVR).* A strategy of equity $E$ that exposes $lambda E$ per block loses, in steady state,
$ EE["LVR"_"Tide"] = (sigma^2)/8 dot E dot Delta dot 1/(2-lambda). $ <eq:steady>

_Proof sketch._ Let $g_t$ be the log gap between the market and the pool's marginal price at the top of block $t$. The first fill closes the gap on the active slice; after the re-split the pool price is the reserve-weighted mix of the active part (at the market) and the passive part (at the old price), so the gap carried forward is $(1-lambda) g_t + r_(t+1)$ with $r_(t+1) tilde N(0, sigma^2 Delta)$. Thus $g$ is AR(1) with stationary variance $sigma^2 Delta \/ (lambda(2-lambda))$. Closing a gap $g$ on a curve of value $lambda E$ costs $lambda E g^2\/8$ to second order, and taking expectations gives @eq:steady. The gap dynamics are those of @ko2026, Section 3. $square$

The saving is 33% at $lambda = 0.5$ and 43% at $lambda = 0.25$; it is capped at 50% as $lambda arrow 0$, at which point the pool no longer tracks the market. Section 5 confirms the ratio numerically.

*Proposition 2 (virtual depth and solvency).* Quoting against $(N x_a)(N y_a) = k$ reduces the slippage of a trade of size $q$ from about $q\/x_a$ to about $q\/(N x_a)$ (Table 2). The virtual curve promises up to $N y_a$, which the pool does not hold. With the drift bound measured against the block anchor, the most it can be asked to deliver in one block is
$ y_max = N y_a (1 - sqrt(1-delta)), $
so the strategy is solvent whenever $y_a + B >= y_max$, with $B$ the passive buffer. At $N = 4$, $delta = 0.2%$ the bound is 0.4% of $y_a$, far inside the active slice; the solvency check remains as a hard invariant regardless.

*Proposition 3 (the virtual curve is a rebate; the fee bound).* A fill on the virtual curve moves the virtual price by some amount and moves the real active reserves by the same tokens, which on the real curve is $N$ times that price move. After a within-band fill the real active price therefore sits up to $(N-1)delta$ from the virtual one, and the next block's first fill collects the gap. Every unit of execution improvement the virtual curve grants is a unit of the maker's inventory at the next re-split; inside the band the improvement over the active curve is at most $(N-1)delta\/2$ per unit traded.

With $f = 0$ this rebate is extractable at will. Let a taker be first in the block. On the active curve she sells $x$ to move the price by $delta' >= delta$; on the virtual curve she buys $x$ back up to the guard. A sale on a shallow curve followed by a purchase on a deep one nets, to first order,
$ (N-1) N delta^2 \/ 4 $
of one side of the active reserves per block, with no price gap and no information, and leaves the real reserves $(N-1)delta$ mispriced for the following arbitrageur besides. Simulated with the contract arithmetic on a USD 2 million pool at $lambda = 0.5$, $N = 4$, $delta = 0.5%$, the loop takes about USD 28 per block, roughly 830 times the LVR that $lambda$ saves in that block at $sigma = 60%$. Neither $lambda$, $N$ nor $delta$ bounds the sum over blocks.

A flat fee on every input does. The round trip pays $f$ twice and gains at most the rebate; honest one-directional flow pays $f$ once and the maker keeps it. The rebate cannot be farmed if it never exceeds the fee that pays for it:
$ (N-1) delta <= 2 f. $ <eq:feebound>
The contracts enforce @eq:feebound at initialisation and on every change to $lambda$, $N$, $delta$ or $f$. Numerically the round trip stays unprofitable up to $4f\/(N-1)$, so the bound keeps a factor of two, and the largest admissible one-directional flow leaves the maker whole after the following arbitrage. A test performs the round trip on the Aqua venue and asserts that the attacker loses and the maker's inventory is worth no less at the old price.

The bound also settles the stale-anchor question. A dust first fill anchors the block at the pool's current price, which arbitrageurs keep within $f$ of the market plus one block of drift, $sigma sqrt(Delta)$ (3.7 bp at $sigma = 60%$ and 12 s). A follower on the virtual curve gains at most the gap less $f$ less $delta\/2$, so once $delta$ exceeds two one-block moves the stale anchor is worth nothing. The manager therefore keeps
$ 3 sigma sqrt(Delta) <= delta <= (2f)/(N-1), $ <eq:box>
lowering $N$ when the interval is empty. At $sigma = 60%$, $f = 30$ bp, $N = 4$ this is $11 "bp" <= delta <= 20 "bp"$; the deployed strategy uses 20 bp. $square$

*Choosing $lambda$.* Exposing less of the reserves lowers LVR but lets the pool's token weight $w_t$ drift from its target $theta = 1\/2$; the deviation is AR(1) with decay $(1-lambda)$ and shock $r_t\/4$. The maker minimises
$ "LVR"(lambda) - "Fees"(lambda) + kappa sum_t (w_t - theta)^2, $ <eq:objective>
where the fee term is first order in $f$ and $kappa$ prices tracking error. LVR and tracking error scale with $sigma^2$ and fees with $sigma$, so $lambda^*$ falls as volatility rises. We solve @eq:objective on a grid at $f = 1$ bp with $kappa$ calibrated to $lambda^* = 0.5$ at $sigma = 60%$ (Figure 2); the manager reads $lambda^*$ from this frontier and $delta$ from @eq:box.

#figure(
  image("../../research/fig_frontier.png", width: 70%),
  caption: [Objective @eq:objective against $lambda$ for several volatilities. $lambda^*$ is 1.0 at $sigma = 20%$, 0.5 at 60%, 0.24 at 100%.],
)

= Simulation

10,000 GBM paths, $sigma = 60%$, 12-second blocks, one day; the arbitrageur trades the active slice to the new price every block.

#figure(
  table(
    columns: 5,
    align: (left, right, right, right, right),
    stroke: (x, y) => if y == 0 { (bottom: 0.6pt) } else { none },
    [*$lambda$*], [*LVR per day*], [*simulated ratio*], [*$1\/(2-lambda)$*], [*saved*],
    [1.00], [0.01233%], [1.000], [1.000], [0%],
    [0.50], [0.00822%], [0.667], [0.667], [33.3%],
    [0.25], [0.00705%], [0.571], [0.571], [42.9%],
  ),
  caption: [LVR per day as a fraction of capital. $lambda = 1$ reproduces $sigma^2\/8\/365 = 0.01233%$.],
) <tab:sim>

#figure(
  table(
    columns: 3,
    align: (left, right, right),
    stroke: (x, y) => if y == 0 { (bottom: 0.6pt) } else { none },
    [*$N$*], [*slippage, trade of 1% of active*], [*relative to $N = 1$*],
    [1], [0.990%], [1.0×],
    [2], [0.498%], [2.0×],
    [4], [0.249%], [3.97×],
    [8], [0.125%], [7.9×],
  ),
  caption: [Slippage of a follow-on trade on the virtual curve.],
) <tab:slip>

= Implementation

One Solidity library, `TideMath`, holds the split, the $N$-scaled quotes, the drift test, the solvency bound, the fee arithmetic and the parameter box @eq:feebound. It is checked against an integer Python reference on 24 vectors, and both venues import it.

*1inch Aqua.* Tide is a SwapVM program of three custom opcodes in reserved third-party slots, `ACTIVE_SPLIT` (0x92), `VIRTUAL_XYC` (0x52) and `BUFFER_GUARD` (0x22), dispatched by a router that is the swap-vm template with the opcode set extended. Instruction order is security-critical; every Tide opcode scans the program and reverts unless the three appear once each in that order. The maker's inventory never leaves the wallet: Aqua records balances at `ship` and pulls only at fill time, which is the natural home for a design in which the pool does not hold what the virtual curve promises.

*Uniswap v4.* The same steps run inside `beforeSwap` of a `BaseCustomCurve` hook that returns a `BeforeSwapDelta` for the whole amount, holds its reserves as ERC-6909 claims, mints pro-rata shares and refuses liquidity changes in any block that already saw a swap. A cross-venue test runs one trade sequence on both venues and asserts identical amounts.

*Parameters.* `TideParams` stores $lambda$, $N$, $delta$ and $f$ per strategy, keyed by the Aqua order hash or the v4 pool id, together with owner-set guardrails for the manager: a $lambda$ range, the largest $lambda$ move per write, the largest $N$ and a cooldown between writes. The owner's writes are unbounded; a manager write outside the guardrails reverts; every write is checked against @eq:feebound.

#figure(
  table(
    columns: 3,
    align: (left, right, right),
    stroke: (x, y) => if y == 0 { (bottom: 0.6pt) } else { none },
    [*Path*], [*gas*], [*vs. plain*],
    [plain constant-product fill on the same router, transfers included], [83,226], [–],
    [Tide fill, first of block (re-split, fee, state write)], [118,821], [+35,595],
    [Tide fill, later in block (virtual curve, guard, fee)], [119,551], [+36,325],
    [Tide v4 hook swap through a test router], [≈168,000], [n/a],
  ),
  caption: [Gas measured in Foundry. The overhead is three parameter reads, one balance read and the program scan; caching parameters per block would roughly halve it.],
)

The suite has 47 tests: vector parity, every opcode, two swaps in one block, the lazy re-split, re-pricing of an informed-sized follow-on trade, exact-output beyond inventory, buffer top-up, fee netting, quote-equals-fill in both directions and modes, program-order reverts, governance and guardrails, the round trip of Proposition 3, hook liquidity guards and cross-venue parity.

The reference deployment is on Sepolia (router `0xbc95…390a`, parameters `0x2Cfc…558C`, hook `0xeC07…6A88`) with a WETH/USDC strategy at $lambda = 0.5$, $N = 4$, $delta = 20$ bp, $f = 30$ bp, one filled Aqua order and one hook swap in which the quote equalled the fill. A fork script reproduces the flow against the mainnet Aqua registry with real WETH and USDC.

= Governance

The parameters of a strategy are text records on an ENS name the maker owns (`eth-usdc.tide.eth` for the reference strategy), so anyone can read them and the chain of custody is public. A manager agent with its own name, `manager.tide.eth`, holds a resolver role scoped to exactly the `lambda`, `N` and `delta` records and is the `manager` of the on-chain parameters; it cannot touch the fee, the guardrails, the strategy hash, addresses or the name itself, and the owner revokes it with one call per record.

The agent computes $lambda^*$ from the frontier and $delta$ from @eq:box at the realised volatility. Inside the owner's guardrails it writes the records and the on-chain parameters on its own: the rule is deterministic and the contract bounds what the key can do, so no human is needed per change. A change outside the guardrails is where authority matters, and there the owner must complete a fresh World ID authentication (`prompt=login`, `max_age=0`); the ID token is validated server-side and its pairwise subject must match the one the owner bound to the wallet, which itself required a signed message from that wallet. The agent then writes the records, and the owner's wallet applies the change on-chain, since the contract refuses the manager. Denied, expired, replayed and forged responses leave everything unchanged, and a harness asserts each path. Both paths have run on the reference deployment: a change inside the guardrails applied by the agent alone, and one outside them approved with a fresh proof and applied by the owner.

= Limitations

- The model assumes the block's first fill is the informed one. A retail order that happens to be first pays the shallow curve. Proposition 3 removes the profit from taking that slot deliberately, not the cost of taking it by accident.
- The frontier's fee term is first order and solved at 1 bp. At the deployed 30 bp the fee changes when arbitrage happens, since the gap must exceed $f$ first, which the LVR model does not capture; $lambda^*$ is the LVR-versus-tracking optimum, not a fee-calibrated one.
- The lower edge of @eq:box has a proven safe side and a heuristic target; the optimal band for a given mix of flow is open.
- Parameters are mirrored on the trading chain by the agent after approval; a cross-chain read of the record would remove that step.
- Mainnet deployment, audit and multi-pair rebalancing are out of scope for this version.

#bibliography("refs.bib", title: "References", style: "ieee")

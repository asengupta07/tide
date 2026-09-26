# Tide Mathematical Model

This guide explains Tide's mathematics from first principles and matches the behavior currently
implemented by both the 1inch Aqua program and the Uniswap v4 hook.

The short version:

- **lambda (λ)** decides how much real inventory is active at the beginning of a block.
- The first trade uses an ordinary constant-product curve over that active inventory.
- **N** offers a smoother proposed price to later trades using a deeper virtual curve.
- **delta (δ)** decides whether that proposed N quote is close enough to the block's reference price.
- The buffer guard checks that real inventory can deliver the quoted output.

N does not create tokens. Delta does not normally reject the whole trade: if the special N quote
exceeds delta, Tide falls back to ordinary N = 1 pricing.

## 1. People used in the examples

The contracts do not know whether an address is a person or a bot. These are explanatory personas:

| Name | Role |
| --- | --- |
| Alice | Liquidity provider (LP) who owns the inventory |
| ArbBot | Likely first trader after an external price movement |
| Carol | Ordinary trader arriving later in the same block |
| MalloryBot | Large or potentially informed later trader |
| Tide manager | Agent that proposes parameter changes |

Tide's assumption is about **trade order**, not identity. It treats the first fill in a block as the
possibly informed fill. It cannot prove that the first address is a bot or that later addresses are
ordinary users.

## 2. Symbols and units

Suppose a trader sends token IN and receives token OUT.

| Symbol | Meaning |
| --- | --- |
| X, Y | Total real reserves of IN and OUT |
| x, y | Current active real reserves of IN and OUT |
| q | Real amount of IN sent by the trader (amountIn) |
| z | Real amount of OUT received by the trader (amountOut) |
| λ | Fraction of total inventory made active on a new block |
| N | Integer virtual-depth multiplier for later fills |
| δ | Maximum permitted virtual-price drift from the block anchor |
| p | Price in units of OUT per one unit of IN |

The examples use readable amounts. Solidity uses integer base units: usually 10^18 units per ETH and
10^6 units per USDC.

Lambda and delta are stored on-chain in basis points:

~~~text
100 basis points   = 1%
50 basis points    = 0.5%
5,000 basis points = 50%
~~~

Current parameter bounds:

~~~text
0 < lambda <= 100%
1 <= N <= 64
0 <= delta < 50%
0 <= fee   < 100%   (flat fee on tokenIn, also in basis points; the owner sets it, both venues read it)
(N - 1) * delta <= 2 * fee   (the fee-rebate bound, Section 8)
~~~

## 3. Ordinary constant-product pricing

An ordinary constant-product AMM uses:

~~~text
x * y = k
~~~

If a trader adds q units of IN and receives z units of OUT:

~~~text
(x + q) * (y - z) = x * y
~~~

Solving for output:

~~~text
z = q * y / (x + q)
~~~

The pre-trade spot rate and hypothetical no-impact output are:

~~~text
p_spot = y / x
z_spot = q * y / x
~~~

The real output is smaller because the trade changes the reserve ratio while it executes. That
difference is price impact or slippage.

## 4. Lambda: active and passive inventory

At the first quote or fill observed in a new block, Tide calculates:

~~~text
active IN  = floor(lambda * total IN)
active OUT = floor(lambda * total OUT)

passive IN  = total IN  - active IN
passive OUT = total OUT - active OUT
~~~

Only the active reserves set the first trade's price. The passive tokens still exist and still belong
to Alice, but they are withheld from that first pricing curve.

### Example: split 600 INR and 1,000 JPY

Alice supplies:

~~~text
total = 600 INR and 1,000 JPY
lambda = 0.5
~~~

The new-block split is:

~~~text
active  = 300 INR and 500 JPY
passive = 300 INR and 500 JPY
~~~

There are now two products worth distinguishing:

~~~text
whole-pool product = 600 * 1,000 = 600,000
active product     = 300 *   500 = 150,000
~~~

Tide's first trade uses the active product 150,000. Therefore x*y is **not always the entire pool** in
Tide; x and y mean the reserves used by the current pricing curve.

## 5. First fill of a block: always N = 1

Tide ignores the configured N for the first fill and uses:

~~~text
z = q * y / (x + q)
~~~

This is intended to limit the inventory available to the first likely arbitrage trade.

### ArbBot sends 20 INR

Starting active reserves:

~~~text
x = 300 INR
y = 500 JPY
k = 150,000
q = 20 INR
~~~

Output:

~~~text
z = 20 * 500 / (300 + 20)
  = 10,000 / 320
  = 31.25 JPY
~~~

After the fill:

~~~text
active  = 320 INR and 468.75 JPY
passive = 300 INR and 500 JPY
total   = 620 INR and 968.75 JPY
~~~

The active constant product is preserved:

~~~text
320 * 468.75 = 150,000
~~~

Tide stores the post-first-fill active pair as the fixed block anchor:

~~~text
anchor price = 468.75 / 320
             = 1.46484375 JPY per INR
~~~

## 6. Later fills: the proposed N-scaled quote

For a later fill in the same block, Tide first proposes a quote using:

~~~text
virtual IN reserve  = N * x
virtual OUT reserve = N * y
~~~

For that one quote:

~~~text
(N*x + q) * (N*y - z) = N^2 * x * y
~~~

Solving for output gives the implemented exact-input formula:

~~~text
z = q * N * y / (N*x + q)
~~~

An equivalent form is:

~~~text
z = q * y / (x + q/N)
~~~

### Why N does not cancel

The denominator is N*x + q, not N*(x + q). The real input q was not multiplied by N:

~~~text
N*x + q = N * (x + q/N)

z = q * N * y / [N * (x + q/N)]
  = q * y / (x + q/N)
~~~

N remains inside the denominator as q/N. A larger N makes the input look smaller relative to the
pricing reserves, reducing its calculated price impact.

### Slippage formula

For an exact-input virtual quote, slippage relative to the pre-trade spot rate is:

~~~text
slippage = 1 - virtual output / no-impact output
         = q / (N*x + q)
~~~

For a small trade where q is much smaller than N*x:

~~~text
slippage is approximately q / (N*x)
~~~

This is why N = 4 gives about one-quarter of the N = 1 slippage for small eligible trades. Four is a
tuning example, not a law of AMMs.

## 7. Delta: the virtual-price guard

N produces only a candidate quote. Tide computes the candidate marginal price after the trade:

~~~text
p_proposed = (N*y - z) / (N*x + q)
~~~

The reference is the price stored immediately after the first fill:

~~~text
p_anchor = anchor OUT / anchor IN
~~~

Human-readable drift:

~~~text
drift = abs(p_proposed / p_anchor - 1) * 100%
~~~

The N quote is allowed only inside this band:

~~~text
p_anchor * (1 - delta) <= p_proposed <= p_anchor * (1 + delta)
~~~

Solidity performs an equivalent cross-multiplied integer comparison to avoid floating-point numbers.

When drift exceeds delta, Tide discards the N quote and recalculates using current active reserves
with N = 1. It is more accurate to say **the special quote is rejected**, not the entire trade.

Delta bounds one fill. It does not, on its own, bound what a sequence of fills can take from Alice;
Section 8 shows why and adds the fee that does.

### Simplified drift formula

If the anchor equals the current pre-trade reserve ratio, drift simplifies to:

~~~text
drift = 1 - [N*x / (N*x + q)]^2
~~~

This shortcut is not valid after other later-in-block trades have moved the current active ratio away
from the fixed anchor. The general anchor formula must then be used.

Under that same simplifying condition:

~~~text
maximum input:
q_max = N*x * [1 / sqrt(1 - delta) - 1]

maximum output:
z_max = N*y * [1 - sqrt(1 - delta)]
~~~

These are drift boundaries, not extra available tokens. The real-inventory check still applies.

## 8. Fee: who pays for the deep curve, and the bound that keeps it honest

Sections 6 and 7 describe a quote that is better than the active curve for later fills. Nothing is
free, so the first question is who pays for that improvement. The answer decides whether the design
works at all.

### Where the improvement comes from

A fill on the N-curve moves the **virtual** price by some amount. The **real** active reserves move by
the same token amounts, and on the real curve that is N times the price move. After a within-delta fill
on the N-curve the real active price therefore sits up to `(N - 1) * delta` away from the virtual
price. Nobody trades the real active curve for the rest of the block, but at the next block the active
slice is re-split from the totals and the block's first fill (an arbitrageur) takes that gap. Every unit
of improvement the deep curve hands out inside a block is a unit of Alice's inventory at the next
re-split. The deep curve is a **rebate**, paid by the LP.

### The round trip (why zero fee cannot work)

Start from the fresh split of Section 4, no fee, `N = 4`, `delta = 0.5%`:

~~~text
active = 300 INR and 500 JPY,   price 1.66667 JPY per INR
~~~

MalloryBot is first in the block and does two trades in the same block.

Leg 1, first fill, N = 1. Mallory sells INR to push the active price down 1% (twice delta):

~~~text
sells 1.5113 INR, receives 2.5063 JPY
active = 301.5113 INR and 497.4937 JPY,   anchor 1.65000 JPY per INR
~~~

Leg 2, later fill, N = 4. Mallory buys INR back with JPY on the deep curve, the largest amount the
guard admits (virtual price may move delta = 0.5% above the anchor):

~~~text
sends 4.9687 JPY, receives 3.0039 INR
active = 298.5075 INR and 502.4624 JPY
~~~

Mallory's net position is +1.4926 INR and -2.4624 JPY. At the untouched market price of 1.66667 that is

~~~text
1.4926 * 1.66667 - 2.4624 = +0.0251 JPY
~~~

profit, with no price gap and no information. The real active price is now 1.68325 JPY per INR, 0.99%
above the market; the next block's first fill collects that as well. Nothing in lambda, N or delta
stops this: delta only caps the size of one loop, and the loop can run every block.

First order, one loop extracts about

~~~text
(N - 1) * N * delta^2 / 4     of one side of the active reserves, per block
~~~

Exact simulation with the contract formulas, USD 2,000,000 pool, `lambda = 0.5, N = 4,
delta = 0.5%`: about USD 28 per block leaves the LP, roughly 830 times the LVR that lambda saves in
that block at 60% volatility. At `delta = 0.05%` it is still 8 times.

### The fee closes it

Every fill pays a flat fee `f` on tokenIn (Section 16). Inside the drift band the deep curve improves
the price by at most `(N - 1) * delta / 2` per unit traded relative to the active curve. Mallory pays
`f` on both legs; an honest follower pays `f` once and the LP keeps it. So the rebate can never be
farmed if it never exceeds the fee that pays for it:

~~~text
(N - 1) * delta <= 2 * f
~~~

This is enforced on-chain in `TideMath.checkParams`, at `init`, at every `set` and at every `setFee`.
Under it, the numeric search that found the USD 28 loop finds no profitable loop at all (the round trip
above with the 0.75% fee that `N = 4, delta = 0.5%` would need loses 0.0316 JPY), and one-directional
honest flow of the largest admissible size leaves the LP whole after the next arbitrage.

| Fee | N = 2 | N = 4 | N = 8 |
| ---: | ---: | ---: | ---: |
| 5 bp | delta <= 10 bp | 3 bp | 1 bp |
| 30 bp | 60 bp | 20 bp | 8 bp |
| 100 bp | 200 bp | 66 bp | 28 bp |

The reference strategy shipped with `fee = 30 bp, N = 4, delta = 20 bp`; the manager moves N and delta with volatility inside the guardrails, so the live values drift from these. The INR/JPY examples elsewhere in this
document keep `N = 4, delta = 0.5%` for legible numbers; under the bound that pair needs a fee of at
least 75 bp.

### The other side: how small delta may be

A dust first fill anchors the block at a stale price. Arbitrageurs keep the pool within `f` of the
market plus one block of drift, `sigma * sqrt(dt)` (about 3.7 bp at 60% annual volatility and 12 s
blocks). A follower on the deep curve gains at most `gap - f - delta / 2`, so once `delta` exceeds two
one-block moves the stale anchor is worth nothing to anyone. The manager targets three:

~~~text
3 * sigma * sqrt(dt)  <=  delta  <=  2 * f / (N - 1)
~~~

At 60% volatility, `f = 30 bp`, `N = 4`: `11 bp <= delta <= 20 bp`. If the box is empty the manager
lowers N until it is not (N = 1 turns the deep curve off).

One consequence worth stating: under the bound the deep curve never delivers more than about
`N * delta / 2` of the active slice per block (0.4% at the deployed values), so the passive buffer
top-up of Section 12 is only reachable with extreme settings such as `delta = 45%, fee = 67.5%`. The
solvency check stays as a hard invariant regardless.

## 9. INR/JPY: two alternative second trades

Return to the state immediately after ArbBot's first fill:

~~~text
active = 320 INR and 468.75 JPY
anchor = 1.46484375 JPY per INR
N = 4
delta = 0.5%
~~~

The next two cases are alternatives starting from this same state; they are not sequential.

### Case A: Carol sends a small 3 INR

Candidate N = 4 output:

~~~text
z = 3 * 4 * 468.75 / (4*320 + 3)
  = 5,625 / 1,283
  = 4.3843 JPY
~~~

Candidate price:

~~~text
p_proposed = (4*468.75 - 4.3843) / (4*320 + 3)
           = approximately 1.4580 JPY per INR
~~~

Drift:

~~~text
drift = (1.46484375 - 1.4580) / 1.46484375
      = approximately 0.467%
~~~

Because 0.467% is below 0.5%, Tide accepts N = 4.

For comparison:

~~~text
N = 4 output = 4.3843 JPY
N = 1 output = 3 * 468.75 / (320 + 3)
             = 4.3537 JPY
~~~

Carol receives slightly more with the accepted virtual quote.

### Case B: MalloryBot sends a larger 20 INR

Candidate N = 4 output:

~~~text
z = 20 * 4 * 468.75 / (4*320 + 20)
  = 37,500 / 1,300
  = 28.8462 JPY
~~~

Candidate virtual balances:

~~~text
virtual INR = 4*320 + 20           = 1,300
virtual JPY = 4*468.75 - 28.8462   = 1,846.1538
~~~

Candidate price and drift:

~~~text
p_proposed = 1,846.1538 / 1,300
           = 1.4201 JPY per INR

drift = (1.46484375 - 1.4201) / 1.46484375
      = approximately 3.05%
~~~

Because 3.05% is greater than 0.5%, Tide discards N = 4 and returns the N = 1 quote:

~~~text
z = 20 * 468.75 / (320 + 20)
  = 9,375 / 340
  = 27.5735 JPY
~~~

The three parameters now have distinct jobs:

~~~text
lambda limited what the first fill could access.
N tried to give the later fill smoother pricing.
delta prevented a large later fill from receiving that pricing.
~~~

## 10. ETH/USDC: comparing slippage

Assume the post-first-fill active state and anchor are:

~~~text
30,000 USDC and 10 ETH
anchor price = 10 / 30,000 ETH per USDC
N = 4
delta = 0.5%
~~~

Carol sends 300 USDC to buy ETH.

~~~text
no-impact output = 300 * 10 / 30,000
                 = 0.1 ETH

N = 1 output = 300 * 10 / (30,000 + 300)
             = 0.0990099 ETH

N = 4 output = 300 * 4 * 10 / (4*30,000 + 300)
             = 0.0997506 ETH
~~~

Slippage relative to 0.1 ETH:

~~~text
N = 1: approximately 0.9901%
N = 4: approximately 0.2494%
~~~

The N = 4 candidate moves the virtual price by approximately 0.4981%, just inside delta = 0.5%, so
Tide accepts it.

If MalloryBot instead sends 3,000 USDC, the candidate drift is approximately 4.82%. Tide discards the
N = 4 price and uses the ordinary active curve.

## 11. Exact-output trades

A trader may specify the desired output z and ask how much input q is required. Solving the virtual
formula gives:

~~~text
q = ceil[z * N*x / (N*y - z)]
~~~

The candidate requires:

~~~text
z < N*y
~~~

Solidity rounds exact-input output down and exact-output input up. Both choices favor the LP and stop
the contract from promising fractions of base units it cannot transfer.

### Carol wants exactly 0.1 ETH

Using x = 30,000 USDC, y = 10 ETH, and N = 4:

~~~text
q = 0.1 * 4 * 30,000 / (4*10 - 0.1)
  = 12,000 / 39.9
  = approximately 300.752 USDC
~~~

Its candidate drift is approximately 0.4994%, just inside a 0.5% limit when the current ratio equals
the anchor.

## 12. Real inventory and the passive buffer

Virtual reserves are numbers used for pricing. They are not real tokens.

After pricing, Tide checks:

~~~text
quoted output <= active OUT + passive OUT
~~~

Equivalently:

~~~text
z <= total real OUT inventory
~~~

There are three outcomes:

1. If z is no greater than active OUT, active inventory delivers the fill.
2. If z exceeds active OUT but not total OUT, passive inventory supplies the difference. Tide then
   re-splits the new totals according to lambda.
3. If z exceeds total OUT, the transaction reverts as insolvent.

### Deliberately extreme buffer example

These aggressive values make the buffer behavior visible:

~~~text
total = 1,000 Coins and 1,000 Apples
lambda = 0.2
active = 200 Coins and 200 Apples
passive = 800 Coins and 800 Apples
N = 64
delta = 45%
~~~

If an accepted quote delivers 250 Apples, the active side supplies 200 and the passive buffer supplies
50. After the transfer, Tide makes 20% of each new real total active again.

If a quote asks for 1,100 Apples, that output is below the fictional virtual reserve N*y = 12,800 but
above Alice's real total of 1,000. The buffer guard reverts.

That is why N cannot create money: the price calculation may use large virtual numbers, but the final
transfer is limited by Alice's real inventory.

## 13. State changes across blocks

There is no automatic callback at the start of a block. The first quote or fill Tide observes performs
a lazy re-split:

~~~text
New block
  -> active = lambda * current real totals
  -> first fill uses N = 1
  -> post-first-fill active price becomes the anchor
  -> later fills propose N-scaled quotes
  -> delta keeps N or causes fallback to N = 1
  -> next block repeats using the then-current real totals
~~~

If Carol lands in the next block instead of ArbBot's block, Carol becomes that new block's first fill
and receives N = 1 pricing even if she is an ordinary human.

### Implementation detail: virtual reserves are reconstructed

Tide does not store a separate virtual token balance. For each later quote it reconstructs virtual
reserves as N times the **current active real balances**. The trade updates real balances by the actual
input and output. The next quote constructs a fresh virtual curve from those updated balances while
still comparing its candidate price with the fixed block anchor.

## 14. Choosing lambda, N, and delta

No single parameter triple is correct for every pool.

### Lambda: first-fill exposure

- Lower lambda exposes less inventory to the first likely arbitrage fill, but worsens tracking and
  reduces immediately active liquidity.
- Higher lambda behaves more like a conventional AMM, but exposes more inventory to stale-price
  arbitrage.

### N: later-fill smoothness

- N = 1 is ordinary active constant-product pricing.
- Larger N reduces calculated slippage for eligible later fills but gives more generous quotes backed
  by passive inventory.

Immediately after a fresh split, nominal virtual depth relative to total depth is roughly:

~~~text
virtual depth / total depth = N * lambda
~~~

For lambda = 0.5:

~~~text
N = 2 -> virtual depth is approximately one original whole pool
N = 4 -> virtual depth is approximately two original whole pools
~~~

N = 4 is an aggressive but visually clear demo value. It is not mathematically privileged. N = 2 is
an easier starting value to defend when lambda = 0.5.

### Delta: permission to use N

- Small delta means only small, close-to-anchor later trades receive virtual pricing.
- Large delta lets more trades use N, and hands out a larger rebate that the fee must cover.

Delta is boxed on both sides (Section 8): at least about three one-block price moves, at most
`2 * fee / (N - 1)`. The lower edge depends on volatility, so the manager re-proposes it with lambda.

### Guardrails: what the manager may do alone

The rule for lambda and delta is deterministic, so the manager applies it on its own as long as the
result stays inside bounds Alice set on-chain: a lambda range, a largest lambda move per change, a
largest N, and a cooldown between changes (defaults 10% to 90%, 25 points, N <= 8, one hour). The
contract refuses a manager write outside them. Only a change beyond the guardrails needs Alice: a fresh
World ID sign-in, then her wallet. Authority sits where policy is chosen, not on every tick.

### Fee: what backs the deep curve

The flat fee on tokenIn is set by the owner at `init`, changeable by the owner only, and read by both
venues on every fill. It is not a free parameter: `(N - 1) * delta <= 2 * fee` must hold, and the
contracts refuse any triple that breaks it.

| Purpose | lambda | N | delta | fee | Interpretation |
| --- | ---: | ---: | ---: | ---: | --- |
| Conservative start | 0.5 | 2 | 0.2% | 0.3% | Virtual depth is roughly the original total depth; wide room under the bound |
| Reference strategy at launch | 0.5 | 4 | 0.2% | 0.3% | Strong slippage contrast; delta sits exactly at the bound |
| Ordinary AMM comparison | 1.0 | 1 | any | any | No partial activation or virtual-depth benefit |

These are test configurations, not claims that the values are economically optimal.

## 15. LP-loss and manager-frontier model

The preceding swap formulas run on-chain. Tide also has a separate research model that helps the
manager propose lambda. It does not currently optimize N or delta.

Let:

~~~text
sigma = annualized market volatility
E     = total pool value
dt    = block duration as a fraction of a year
~~~

The modeled constant-product LVR per block is:

~~~text
LVR_baseline = (sigma^2 / 8) * E * dt
~~~

An isolated first-order loss scales approximately with lambda. In the research model's steady state,
passive inventory also carries a price-tracking lag:

~~~text
LVR_Tide = (sigma^2 / 8) * E * dt / (2 - lambda)
~~~

Relative to lambda = 1:

~~~text
lambda = 0.50 -> ratio 1/1.50 = 0.6667 -> about 33.3% less modeled LVR
lambda = 0.25 -> ratio 1/1.75 = 0.5714 -> about 42.9% less modeled LVR
~~~

Lower lambda has a tracking cost. The simulation models token-weight deviation as:

~~~text
deviation_t = (1 - lambda) * deviation_(t-1) + return_t / 4
~~~

The strategy-selection objective is:

~~~text
minimize over lambda:

LVR(lambda) - fee_income(lambda) + kappa * tracking_error(lambda)
~~~

The approximate annual fee-income term is:

~~~text
fee income = fee_rate
           * (lambda / 4)
           * sigma
           * sqrt(dt)
           * sqrt(2/pi)
           * blocks_per_year
~~~

Kappa expresses how much tracking accuracy matters relative to LVR and fees. The research script
calibrates it so lambda = 0.5 is selected at 60% annualized volatility under its assumptions.

### Current frontier limitation

research/frontier.py treats the fee as a first-order income term on arbitrage notional and is solved
at 1 basis point, where that approximation holds. The deployed strategies charge 30 basis points. At
that level the fee changes *when* arbitrage happens (the gap must exceed the fee before anyone trades),
which the LVR model does not capture; plugging 30 bp into the current income term simply drives
lambda* to the top of the grid. The frontier is therefore the LVR-versus-tracking optimum, a research
and presentation model, not a fee-calibrated controller. The manager's second output, delta, does not
depend on the frontier: it is three one-block moves capped by the fee bound (Section 8).

## 16. Fees, rounding, and model boundaries

The worked quotes above omit the fee for legibility. On-chain every fill pays a flat fee on tokenIn,
read from TideParams by both venues (so the fee a fill pays is the one the parameter box was checked
against):

~~~text
exact input:   net = gross - ceil(gross * fee / 10,000)
               the curve and the drift guard see net; the taker pays gross
exact output:  the curve returns net; gross = net + ceil(net * fee / (10,000 - fee))
~~~

The fee lands in the maker's Aqua balance (or the hook's claims) immediately but enters the active
slice only at the next re-split: within the block only the net input is added to the active reserves.
Rounding always favours the maker; grossing a net amount back up reproduces the original input to
within one wei either way.

The model now proves, by construction, that the deep curve cannot be farmed by a round trip and that a
stale first fill is worth nothing to a follower once delta exceeds two one-block moves (Section 8).
It does not by itself prove:

- which trader is informed; a retail order that happens to be first still pays the active curve;
- that fixed N and delta values are optimal for every pair; the manager's delta rule is a heuristic
  with a proven safe side, not an optimum;
- that modeled LVR savings survive gas, latency and the fee's effect on arbitrage timing (Section 15).

These remain simulation and adversarial-testing targets.

## 17. Formula reference

~~~text
Active reserve:
    active = floor(total * lambda)

Ordinary or N-scaled exact-input output:
    amountOut = amountIn * N * activeOut / (N * activeIn + amountIn)

Ordinary curve:
    set N = 1

Exact-output required input:
    amountIn = ceil(amountOut * N * activeIn / (N * activeOut - amountOut))

Virtual candidate price:
    p_after = (N * activeOut - amountOut) / (N * activeIn + amountIn)

Reference price:
    p_anchor = anchorOut / anchorIn

Drift:
    abs(p_after / p_anchor - 1)

Solvency:
    amountOut <= activeOut + passiveOut

Simplified drift when anchor equals current reserve ratio:
    drift = 1 - [N*activeIn / (N*activeIn + amountIn)]^2

Maximum output inside delta under that condition:
    maxOut = N * activeOut * [1 - sqrt(1 - delta)]

Steady-state research LVR:
    LVR = (sigma^2 / 8) * E * dt / (2 - lambda)

Fee on a gross input:
    fee = ceil(gross * feeBps / BPS);   net = gross - fee

Fee on a net input (exact output):
    fee = ceil(net * feeBps / (BPS - feeBps));   gross = net + fee

Deep-curve rebate per unit, inside the band:
    <= (N - 1) * delta / 2

Round-trip extraction without the bound, per block, first order:
    (N - 1) * N * delta^2 / 4   of one side of the active reserves

Fee-rebate bound (enforced in checkParams):
    (N - 1) * delta <= 2 * fee

Manager's delta box:
    3 * sigma * sqrt(dt) <= delta <= 2 * fee / (N - 1)
~~~

## 18. Implementation references

| Concern | Source |
| --- | --- |
| Shared formulas and bounds, fee-rebate bound | [contracts/src/lib/TideMath.sol](contracts/src/lib/TideMath.sol) |
| Governed parameters and fee, bound enforced at init / set / setFee | [contracts/src/TideParams.sol](contracts/src/TideParams.sol) |
| Aqua active split and fee | [contracts/src/aqua/instructions/ActiveSplit.sol](contracts/src/aqua/instructions/ActiveSplit.sol) |
| Aqua virtual quote | [contracts/src/aqua/instructions/VirtualXYCSwap.sol](contracts/src/aqua/instructions/VirtualXYCSwap.sol) |
| Aqua drift and solvency guard | [contracts/src/aqua/instructions/BufferGuard.sol](contracts/src/aqua/instructions/BufferGuard.sol) |
| Uniswap v4 implementation | [contracts/src/v4/TideHook.sol](contracts/src/v4/TideHook.sol) |
| Solidity math tests | [contracts/test/TideMath.t.sol](contracts/test/TideMath.t.sol) |
| Cross-venue parity tests | [contracts/test/CrossVenue.t.sol](contracts/test/CrossVenue.t.sol) |
| Round trip loses under the bound; bound rejects bad triples | [contracts/test/aqua/TideAqua.t.sol](contracts/test/aqua/TideAqua.t.sol) (`test_RoundTrip_ActiveThenVirtual_LosesMoneyUnderFeeBound`, `test_Params_FeeBound_RejectsDeltaTheFeeCannotBack`) |
| Integer reference model | [research/tide_math.py](research/tide_math.py) |
| Lambda frontier | [research/frontier.py](research/frontier.py) |
| Monte Carlo LVR checks | [research/sim.py](research/sim.py) |


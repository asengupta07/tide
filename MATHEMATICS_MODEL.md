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

## 8. INR/JPY: two alternative second trades

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

## 9. ETH/USDC: comparing slippage

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

## 10. Exact-output trades

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

## 11. Real inventory and the passive buffer

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

## 12. State changes across blocks

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

## 13. Choosing lambda, N, and delta

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
- Large delta lets more trades use N but exposes Alice to more inventory and adverse-selection risk.

Delta = 0.5% is a conservative MVP value. It is useful in a demo because a small trade can show the
accepted path and a large trade can show the fallback path.

| Purpose | lambda | N | delta | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Conservative start | 0.5 | 2 | 0.5% | Virtual depth is roughly the original total depth |
| Clear hackathon demo | 0.5 | 4 | 0.5% | Strong slippage contrast, tightly guarded |
| Ordinary AMM comparison | 1.0 | 1 | any | No partial activation or virtual-depth benefit |

These are test configurations, not claims that the values are economically optimal.

## 14. LP-loss and manager-frontier model

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

research/frontier.py assumes a 1 basis point fee. The current Tide v4 hook returns zero fee, and the
deployed Aqua strategy is also configured with zero fee. The frontier is therefore a research and
presentation model, not yet a production-optimal controller for the deployed fee setup. Those
assumptions must be aligned before treating its lambda proposal as financially calibrated.

## 15. Fees, rounding, and model boundaries

The worked quotes omit fees because the current shared Tide swap paths charge zero. If a fee is added,
the usual approach is to calculate input after fees and use that effective amount in the quote.

The current model does not by itself prove:

- which trader is informed;
- that transaction ordering cannot be manipulated;
- that a dust transaction cannot take the first-fill position before the real arbitrage trade;
- that fixed N and delta values are optimal for every pair;
- that modeled LVR savings survive fees, gas, latency, and adversarial ordering.

These are simulation, mechanism-design, and adversarial-testing targets for the MVP.

## 16. Formula reference

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
~~~

## 17. Implementation references

| Concern | Source |
| --- | --- |
| Shared formulas and bounds | [contracts/src/lib/TideMath.sol](contracts/src/lib/TideMath.sol) |
| Aqua active split | [contracts/src/aqua/instructions/ActiveSplit.sol](contracts/src/aqua/instructions/ActiveSplit.sol) |
| Aqua virtual quote | [contracts/src/aqua/instructions/VirtualXYCSwap.sol](contracts/src/aqua/instructions/VirtualXYCSwap.sol) |
| Aqua drift and solvency guard | [contracts/src/aqua/instructions/BufferGuard.sol](contracts/src/aqua/instructions/BufferGuard.sol) |
| Uniswap v4 implementation | [contracts/src/v4/TideHook.sol](contracts/src/v4/TideHook.sol) |
| Solidity math tests | [contracts/test/TideMath.t.sol](contracts/test/TideMath.t.sol) |
| Cross-venue parity tests | [contracts/test/CrossVenue.t.sol](contracts/test/CrossVenue.t.sol) |
| Integer reference model | [research/tide_math.py](research/tide_math.py) |
| Lambda frontier | [research/frontier.py](research/frontier.py) |
| Monte Carlo LVR checks | [research/sim.py](research/sim.py) |


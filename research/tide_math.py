"""Reference implementation of the Tide quoting math.

Every function here mirrors a function in `src/lib/TideMath.sol` using exact
integer arithmetic so that the Solidity unit tests can be checked against
`research/vectors.json` produced by `python3 research/tide_math.py`.

Conventions
-----------
* All amounts are integers (token base units).
* lambda, delta are in basis points (1e4 = 100%).
* N is an integer depth multiplier (1 = plain constant product).
"""

from __future__ import annotations

import json
import math
import os
import random
from dataclasses import dataclass, asdict

BPS = 10_000


def ceil_div(a: int, b: int) -> int:
    return -(-a // b)


def active_reserve(total: int, lambda_bps: int) -> int:
    """Active slice of a reserve: floor(total * lambda / 1e4)."""
    return total * lambda_bps // BPS


def quote_exact_in(amount_in: int, bal_in: int, bal_out: int, n: int) -> int:
    """Output for an exact-in trade on the virtual curve (N*bal_in)(N*bal_out)=k.

    Floor division favours the maker. With n == 1 this is XYCSwap.
    """
    return amount_in * n * bal_out // (n * bal_in + amount_in)


def quote_exact_out(amount_out: int, bal_in: int, bal_out: int, n: int) -> int:
    """Input for an exact-out trade on the virtual curve. Ceil favours the maker."""
    assert amount_out < n * bal_out, "exceeds virtual reserve"
    return ceil_div(amount_out * n * bal_in, n * bal_out - amount_out)


def drift_exceeds(bal_in: int, bal_out: int, amount_in: int, amount_out: int, n: int, delta_bps: int) -> bool:
    """True when the post-trade marginal price deviates from the pre-trade price by more than delta.

    Price is expressed as tokenOut per tokenIn. Before the trade it is bal_out/bal_in
    (the virtual curve has the same ratio). After the trade it is
    (n*bal_out - amount_out) / (n*bal_in + amount_in). The trade always lowers this
    price, so the check is  p_after < p_before * (1 - delta), done with cross
    multiplication to stay in integers:

        (n*bal_out - amount_out) * bal_in * BPS  <  bal_out * (n*bal_in + amount_in) * (BPS - delta)
    """
    lhs = (n * bal_out - amount_out) * bal_in * BPS
    rhs = bal_out * (n * bal_in + amount_in) * (BPS - delta_bps)
    return lhs < rhs


def drift_exceeds_ref(
    ref_in: int, ref_out: int, bal_in: int, bal_out: int, amount_in: int, amount_out: int, n: int, delta_bps: int
) -> bool:
    """Two-sided drift check against the block's reference price.

    p_ref = ref_out/ref_in, p_after = (n*bal_out - amount_out)/(n*bal_in + amount_in).
    Exceeds when p_after < p_ref*(1-d) or p_after > p_ref*(1+d). Cross-multiplied:

        num = (n*bal_out - amount_out) * ref_in * BPS
        den = ref_out * (n*bal_in + amount_in)
        exceeds  <=>  num < den*(BPS-d)  or  num > den*(BPS+d)
    """
    num = (n * bal_out - amount_out) * ref_in * BPS
    den = ref_out * (n * bal_in + amount_in)
    return num < den * (BPS - delta_bps) or num > den * (BPS + delta_bps)


def fee_on_input(amount_in: int, fee_bps: int) -> int:
    """Flat fee taken from a gross input: ceil(amount_in * fee / BPS). The curve sees the rest."""
    return ceil_div(amount_in * fee_bps, BPS)


def fee_on_net(net_in: int, fee_bps: int) -> int:
    """Fee added on top of a net input so the taker pays gross: ceil(net * fee / (BPS - fee))."""
    return ceil_div(net_in * fee_bps, BPS - fee_bps)


def check_params(lambda_bps: int, n: int, delta_bps: int, fee_bps: int) -> None:
    """Parameter box, mirrors TideMath.checkParams.

    The fee-rebate bound (N - 1) * delta <= 2 * fee: inside the drift band the N-curve improves execution
    over the active curve by at most (N - 1) * delta / 2 per unit, and that rebate must never exceed the
    fee the fill pays for it. Without it, sell on the active curve then buy back on the N-curve inside
    delta extracts (N - 1) * N * delta^2 / 4 of the active reserves per block with no price gap at all.
    """
    assert 0 < lambda_bps <= BPS, "lambda"
    assert 1 <= n <= 64, "n"
    assert delta_bps < BPS // 2, "delta"
    assert fee_bps < BPS, "fee"
    assert (n - 1) * delta_bps <= 2 * fee_bps, "delta exceeds what the fee backs"


def max_out_within_drift(bal_out: int, n: int, delta_bps: int) -> int:
    """Largest exact-in output that keeps the virtual price within delta of the start.

    Solving p_after = p_before*(1-d) on the curve gives the closed form
    out = n*bal_out*(1 - sqrt(1-d)) with d = delta_bps/BPS.
    Returned as an integer floor; it is the solvency bound the buffer must cover.
    """
    d = delta_bps / BPS
    return int(math.floor(n * bal_out * (1 - math.sqrt(1 - d))))


@dataclass
class Vector:
    name: str
    amount_in: int
    amount_out: int
    bal_in: int
    bal_out: int
    n: int
    lambda_bps: int
    delta_bps: int
    exact_in_out: int
    exact_out_in: int
    active_in: int
    active_out: int
    drift_exceeds: bool
    drift_exceeds_ref: bool
    max_out_within_drift: int


def make_vectors(seed: int = 7, count: int = 24) -> list[Vector]:
    rng = random.Random(seed)
    vectors: list[Vector] = []

    # Hand-picked cases first so the Solidity tests have readable names.
    picked = [
        ("eth_usdc_small_retail", 1 * 10**18, 100 * 10**18, 300_000 * 10**6, 4, 5000, 50),
        ("eth_usdc_one_pct_of_active", 10**18, 100 * 10**18, 300_000 * 10**6, 4, 5000, 50),
        ("plain_xyc_n1", 5 * 10**18, 100 * 10**18, 300_000 * 10**6, 1, 10000, 50),
        ("large_informed_trade", 40 * 10**18, 100 * 10**18, 300_000 * 10**6, 4, 5000, 50),
        ("lambda_quarter", 2 * 10**18, 100 * 10**18, 300_000 * 10**6, 2, 2500, 100),
        ("tiny_amounts", 1000, 10**9, 10**9, 4, 5000, 50),
    ]
    for name, amount_in, bal_in, bal_out, n, lam, delta in picked:
        vectors.append(_vector(name, amount_in, bal_in, bal_out, n, lam, delta))

    while len(vectors) < count:
        bal_in = rng.randrange(10**6, 10**24)
        bal_out = rng.randrange(10**6, 10**24)
        amount_in = rng.randrange(1, bal_in)
        n = rng.choice([1, 2, 3, 4, 8])
        lam = rng.choice([1000, 2500, 5000, 7500, 10000])
        delta = rng.choice([10, 50, 100, 500])
        vectors.append(_vector(f"random_{len(vectors)}", amount_in, bal_in, bal_out, n, lam, delta))
    return vectors


def _vector(name, amount_in, bal_in, bal_out, n, lam, delta) -> Vector:
    active_in = active_reserve(bal_in, lam)
    active_out = active_reserve(bal_out, lam)
    out = quote_exact_in(amount_in, active_in, active_out, n)
    # Round-trip: ask for `out` exactly and expect an input >= amount_in
    back_in = quote_exact_out(out, active_in, active_out, n) if out > 0 else 0
    return Vector(
        name=name,
        amount_in=amount_in,
        amount_out=out,
        bal_in=bal_in,
        bal_out=bal_out,
        n=n,
        lambda_bps=lam,
        delta_bps=delta,
        exact_in_out=out,
        exact_out_in=back_in,
        active_in=active_in,
        active_out=active_out,
        drift_exceeds=drift_exceeds(active_in, active_out, amount_in, out, n, delta),
        # reference = active balances before a prior in-block trade of size amount_in/16 in this direction
        drift_exceeds_ref=drift_exceeds_ref(
            active_in + amount_in // 16, active_out - out // 16, active_in, active_out, amount_in, out, n, delta
        ),
        max_out_within_drift=max_out_within_drift(active_out, n, delta),
    )


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    vectors = [asdict(v) for v in make_vectors()]
    # Solidity's vm.parseJson needs numbers that fit in uint256 and bools; large ints are fine as JSON numbers
    # but forge parses numbers > 2^53 only when they are strings, so stringify every integer.
    for v in vectors:
        for k, val in list(v.items()):
            if isinstance(val, bool):
                continue
            if isinstance(val, int):
                v[k] = str(val)
    with open(os.path.join(here, "vectors.json"), "w") as f:
        json.dump({"count": len(vectors), "vectors": vectors}, f, indent=2)
    print(f"wrote {len(vectors)} vectors")


if __name__ == "__main__":
    main()

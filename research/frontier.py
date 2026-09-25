"""Solve the activeness frontier (Proposition 2) and emit `frontier.json` for the manager agent.

Model (Ko 2026, arXiv 2602.09887; Milionis et al. 2022 for LVR):
  * price follows GBM with annualised volatility sigma, blocks of length dt seconds
  * per-block expected LVR of a constant-product pool of value E:   (sigma^2 / 8) * E * dt
  * a PA-AMM exposing lambda of E: within one block the arbitrageur faces a curve of value lambda*E, so
    the single-block loss is lambda times the baseline (Prop. 1, first order). In steady state the
    passive part lags the market, the price gap the arbitrageur closes accumulates, and the loss per
    block converges to  (sigma^2 / 8) * E * dt / (2 - lambda)  (see sim.py, which reproduces this to
    three digits). We use the steady-state form here.
  * the cost is tracking error: with only lambda of reserves rebalancing each block, the realised
    token weight w_t drifts from the invariant's target theta = 1/2. The weight deviation follows an
    AR(1) with decay (1 - lambda) and shock r/4 per block; we simulate it and take the squared
    deviation summed over a year (an index-tracking objective).

  * fee income from the arbitrage flow itself: the arbitrageur's notional per block on the active
    slice is about (lambda*E/4)*|r|, E|r| = sigma*sqrt(dt)*sqrt(2/pi), and the maker charges f on it.
    Fees scale with sigma while LVR and tracking error scale with sigma^2, which is what makes the
    optimal lambda fall when volatility rises (the manager agent's job).

Objective (3):   min_lambda   LVR(lambda) - Fees(lambda) + kappa * sum_t (w_t - theta)^2
kappa is calibrated so that lambda* = 0.5 at sigma = 60% with f = 1 bp, and reported in the output.

Output: frontier.json with the curve {lambda -> (lvr, tracking_error, objective)} for a grid of
volatilities so the agent can read lambda* off it for the current realised volatility.
"""

from __future__ import annotations

import json
import math
import os

import numpy as np

SECONDS_PER_YEAR = 365 * 24 * 3600


def lvr_per_year(sigma: float, lam: float) -> float:
    """Steady-state expected LVR as a fraction of pool value per year."""
    return sigma**2 / 8 / (2 - lam)


FEE = 0.0001  # 1 bp flat fee on tokenIn


def fee_income_per_year(sigma: float, lam: float, dt: float = 12.0, fee: float = FEE) -> float:
    """Fee revenue from arbitrage flow as a fraction of pool value per year."""
    dt_years = dt / SECONDS_PER_YEAR
    blocks = SECONDS_PER_YEAR / dt
    notional_per_block = lam / 4 * sigma * math.sqrt(dt_years) * math.sqrt(2 / math.pi)
    return fee * notional_per_block * blocks


def tracking_error(sigma: float, lam: float, dt: float, n_blocks: int = 20_000, seed: int = 1) -> float:
    """Stationary mean-square deviation of the pool's token weight from 1/2.

    Each block the price moves by a log-return r ~ N(0, sigma^2 dt). A fully active CP pool re-balances
    to weight 1/2 every block; a PA-AMM only rebalances the active fraction, so the weight deviation
    decays by (1 - lambda) per block and receives a fresh shock of r/4 (dw/dlnP = 1/4 at w = 1/2).
    """
    rng = np.random.default_rng(seed)
    r = rng.normal(0.0, sigma * math.sqrt(dt / SECONDS_PER_YEAR), n_blocks)
    dev = np.empty(n_blocks)
    x = 0.0
    a = 1.0 - lam
    for i in range(n_blocks):
        x = a * x + r[i] / 4
        dev[i] = x
    burn = n_blocks // 10
    per_block = float(np.mean(dev[burn:] ** 2))
    return per_block * (SECONDS_PER_YEAR / dt)  # summed over a year of blocks


def frontier(sigma: float, kappa: float, dt: float = 12.0, grid=None) -> list[dict]:
    grid = grid if grid is not None else [i / 100 for i in range(5, 101, 1)]
    rows = []
    for lam in grid:
        lvr = lvr_per_year(sigma, lam)
        fees = fee_income_per_year(sigma, lam, dt)
        te = tracking_error(sigma, lam, dt)
        rows.append(
            {
                "lambda": round(lam, 4),
                "lambda_bps": int(round(lam * 10_000)),
                "lvr_per_year": lvr,
                "fees_per_year": fees,
                "tracking_error": te,
                "objective": lvr - fees + kappa * te,
            }
        )
    return rows


def calibrate_kappa(sigma: float = 0.6, target: float = 0.5, dt: float = 12.0) -> float:
    """kappa such that the objective is minimised at lambda = target: first-order condition
    dLVR/dlambda + kappa * dTE/dlambda = 0 at lambda = target."""
    h = 0.01
    dlvr = (lvr_per_year(sigma, target + h) - lvr_per_year(sigma, target - h)) / (2 * h)
    dfee = (fee_income_per_year(sigma, target + h, dt) - fee_income_per_year(sigma, target - h, dt)) / (2 * h)
    dte = (tracking_error(sigma, target + h, dt) - tracking_error(sigma, target - h, dt)) / (2 * h)
    return -(dlvr - dfee) / dte


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    sigmas = [0.2, 0.3, 0.45, 0.6, 0.8, 1.0, 1.2]
    kappa = calibrate_kappa()
    print(f"kappa calibrated so lambda* = 0.5 at sigma = 60%: {kappa:.4f}")
    out = {"kappa": kappa, "fee": FEE, "block_seconds": 12, "lvr_model": "sigma^2/8/(2-lambda)", "curves": []}
    for sigma in sigmas:
        rows = frontier(sigma, kappa)
        best = min(rows, key=lambda r: r["objective"])
        out["curves"].append({"sigma": sigma, "lambda_star": best["lambda"], "lambda_star_bps": best["lambda_bps"], "rows": rows})
        print(f"sigma={sigma:.2f}  lambda*={best['lambda']:.2f}  LVR/yr={best['lvr_per_year']:.4f}  TE={best['tracking_error']:.3e}")
    with open(os.path.join(here, "frontier.json"), "w") as f:
        json.dump(out, f, indent=2)
    print("wrote frontier.json")


if __name__ == "__main__":
    main()

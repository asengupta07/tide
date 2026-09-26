"""Monte-Carlo: LP wealth vs HODL for lambda in {0.25, 0.5, 1}, plus the LVR-reduction headline number.

Setup: 10,000 GBM price paths, sigma = 60% annualised, 12-second blocks, one trading day (7,200 blocks).
Each block an arbitrageur trades the active slice of a constant-product pool to the new price and keeps the
profit; that profit is the block's LVR. Retail flow is not modelled (fees are outside the paper's scope),
so all curves sit below HODL and the gap between them is pure LVR saved.

Outputs: sim.json (numbers used in the whitepaper) and, if matplotlib is available, fig_wealth.png and
fig_frontier.png used in the whitepaper and the video.
"""

from __future__ import annotations

import json
import math
import os

import numpy as np

SECONDS_PER_YEAR = 365 * 24 * 3600


def simulate(lam: float, sigma: float = 0.6, dt: float = 12.0, blocks: int = 7200, paths: int = 10_000, seed: int = 42):
    rng = np.random.default_rng(seed)
    vol = sigma * math.sqrt(dt / SECONDS_PER_YEAR)
    logret = rng.normal(-0.5 * vol**2, vol, size=(paths, blocks))
    price = np.exp(np.cumsum(logret, axis=1))  # P_0 = 1

    # Pool starts with x = 1 unit of risky asset and y = 1 unit of numeraire (P0 = 1): value 2.
    x = np.ones(paths)
    y = np.ones(paths)
    hodl = np.ones(paths) * 2.0
    lvr = np.zeros(paths)

    p_prev = np.ones(paths)
    for t in range(blocks):
        p = price[:, t]
        # active slice at the top of the block
        xa = lam * x
        ya = lam * y
        # constant-product arbitrage on the active slice: new reserves keep k, match price p
        k = xa * ya
        xa_new = np.sqrt(k / p)
        ya_new = np.sqrt(k * p)
        # arbitrageur's profit valued at p (what the pool lost)
        dx = xa - xa_new
        dy = ya_new - ya
        lvr += dx * p - dy
        x = x - xa + xa_new
        y = y - ya + ya_new
        p_prev = p

    p_end = price[:, -1]
    pool_value = x * p_end + y
    hodl_value = 1.0 * p_end + 1.0
    return {
        "lambda": lam,
        "mean_pool_value": float(pool_value.mean()),
        "mean_hodl_value": float(hodl_value.mean()),
        "mean_lvr": float(lvr.mean()),
        "lvr_pct_of_capital": float(lvr.mean() / 2.0 * 100),
        "wealth_vs_hodl_pct": float(((pool_value - hodl_value) / hodl_value).mean() * 100),
        "series_pool_minus_hodl": None,
    }


def wealth_paths(lam: float, sigma: float = 0.6, dt: float = 12.0, blocks: int = 7200, paths: int = 500, seed: int = 7):
    """Mean (pool - HODL) / HODL over time for the chart."""
    rng = np.random.default_rng(seed)
    vol = sigma * math.sqrt(dt / SECONDS_PER_YEAR)
    logret = rng.normal(-0.5 * vol**2, vol, size=(paths, blocks))
    price = np.exp(np.cumsum(logret, axis=1))
    x = np.ones(paths)
    y = np.ones(paths)
    out = np.empty(blocks)
    for t in range(blocks):
        p = price[:, t]
        xa, ya = lam * x, lam * y
        k = xa * ya
        xa_new, ya_new = np.sqrt(k / p), np.sqrt(k * p)
        x = x - xa + xa_new
        y = y - ya + ya_new
        out[t] = np.mean((x * p + y - (p + 1)) / (p + 1)) * 100
    return out


def main() -> None:
    here = os.path.dirname(os.path.abspath(__file__))
    results = [simulate(l) for l in (0.25, 0.5, 1.0)]
    base = next(r for r in results if r["lambda"] == 1.0)
    for r in results:
        lam = r["lambda"]
        r["lvr_reduction_vs_lambda1_pct"] = (1 - r["mean_lvr"] / base["mean_lvr"]) * 100
        # closed form: steady-state LVR(lambda) = baseline / (2 - lambda)
        r["closed_form_ratio"] = 1 / (2 - lam)
        r["simulated_ratio"] = r["mean_lvr"] / base["mean_lvr"]
        r["analytic_lvr_pct_per_day"] = 0.6**2 / 8 / 365 * 100 / (2 - lam)
        r.pop("series_pool_minus_hodl")
        print(
            f"lambda={lam:.2f}  LVR={r['lvr_pct_of_capital']:.4f}% of capital/day (analytic {r['analytic_lvr_pct_per_day']:.4f}%)  "
            f"ratio sim {r['simulated_ratio']:.3f} vs 1/(2-lambda) {r['closed_form_ratio']:.3f}  "
            f"reduction {r['lvr_reduction_vs_lambda1_pct']:.1f}%"
        )

    # Retail slippage table (whitepaper table 2): trade of 1% of active reserves
    q, xa = 0.01, 1.0
    slip = {}
    for n in (1, 2, 4, 8):
        out = q * n * 1.0 / (n * xa + q)
        slip[str(n)] = (q - out) / q * 100  # % slippage vs spot
    slip_improvement_n4 = slip["1"] / slip["4"]

    with open(os.path.join(here, "sim.json"), "w") as f:
        json.dump(
            {
                "sigma": 0.6,
                "block_seconds": 12,
                "blocks": 7200,
                "paths": 10_000,
                "results": results,
                "retail_slippage_pct_by_n": slip,
                "slippage_improvement_n4_vs_n1": slip_improvement_n4,
            },
            f,
            indent=2,
        )
    print(f"retail slippage improvement at N=4: {slip_improvement_n4:.2f}x")

    # downsampled wealth-vs-HODL series for the web chart (client/public/research/wealth_series.json)
    series = {str(l): [round(float(v), 5) for v in wealth_paths(l)[::100]] for l in (1.0, 0.5, 0.25)}
    with open(os.path.join(here, "wealth_series.json"), "w") as f:
        json.dump({"hours_per_point": 100 * 12 / 3600, "series": series}, f)

    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        fig, ax = plt.subplots(figsize=(8, 4.5))
        for lam, color in ((1.0, "#c0392b"), (0.5, "#2980b9"), (0.25, "#27ae60")):
            ax.plot(np.arange(7200) * 12 / 3600, wealth_paths(lam), label=f"λ = {lam}", color=color, lw=2)
        ax.axhline(0, color="black", lw=0.8, ls="--", label="HODL")
        ax.set_xlabel("hours")
        ax.set_ylabel("LP wealth vs HODL (%)")
        ax.set_title("LP wealth relative to holding, σ = 60%, 12 s blocks")
        ax.legend()
        fig.tight_layout()
        fig.savefig(os.path.join(here, "fig_wealth.png"), dpi=160)

        fp = os.path.join(here, "frontier.json")
        if os.path.exists(fp):
            fr = json.load(open(fp))
            fig, ax = plt.subplots(figsize=(8, 4.5))
            for c in fr["curves"]:
                lams = [r["lambda"] for r in c["rows"]]
                ax.plot(lams, [r["objective"] for r in c["rows"]], label=f"σ = {int(c['sigma']*100)}%  (λ* = {c['lambda_star']})", lw=2)
            ax.set_xlabel("λ (share of reserves exposed per block)")
            ax.set_ylabel("LVR + κ · tracking error  (per year, fraction of value)")
            ax.set_title("Activeness frontier")
            ax.legend()
            fig.tight_layout()
            fig.savefig(os.path.join(here, "fig_frontier.png"), dpi=160)
        print("wrote figures")
    except Exception as e:  # pragma: no cover
        print("matplotlib unavailable:", e)


if __name__ == "__main__":
    main()

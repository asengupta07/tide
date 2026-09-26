#!/usr/bin/env python3
"""Render the side-by-side run from the transaction receipts: plain Aqua strategy vs Tide strategy.

Reads deployments/sidebyside.json (written by SideBySide.s.sol) and the broadcast receipts, decodes every
`Swapped` event the router emitted, and prints the two strategies next to each other, block by block.
Flags: --fast (no animation).
"""
import json, os, statistics, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
FAST = "--fast" in sys.argv
SWAPPED = "0x54bc5c027d15d7aa8ae083f994ab4411d2f223291672ecd3a344f3d92dcaf8b2"

R = "\033[0m"; B = "\033[1m"; D = "\033[2m"
TIDE = "\033[38;5;80m"; PLAIN = "\033[38;5;246m"; GOOD = "\033[38;5;114m"; BAD = "\033[38;5;203m"; ACC = "\033[38;5;222m"
LW, CW = 24, 40  # label width, column width
W = LW + 2 * CW + 22

def pause(s):
    if not FAST: time.sleep(s)

def line(txt=""):
    print(txt); pause(0.045)

def usd(v6, sign=False):
    v = v6 / 1e6
    body = f"${abs(v):,.0f}" if abs(v) >= 1000 and abs(v) == int(abs(v)) else f"${abs(v):,.2f}"
    return (("+" if v >= 0 else "-") if sign else ("-" if v < 0 else "")) + body

def eth(wei): return f"{wei / 1e18:.5f} ETH"
def bps(x, sign=True): return f"{x:+.1f} bp" if sign else f"{x:.1f} bp"
def pct(x): return f"{x:+.1f}%"
def short(h): return h[:10] + "…" + h[-4:]
def vis(s):  # printable length without ANSI
    import re; return len(re.sub(r"\033\[[0-9;]*m", "", s))
def col(s, w):  # pad coloured text to a visible width
    return s + " " * max(0, w - vis(s))

# ---- load ----------------------------------------------------------------------------------------
cfg = json.load(open(os.path.join(ROOT, "deployments", "sidebyside.json")))
run = json.load(open(os.path.join(ROOT, "broadcast", "SideBySide.s.sol", "31337", "run-latest.json")))
router = cfg["router"].lower(); usdc = cfg["usdc"].lower()
plainHash = cfg["plainHash"].lower(); tideHash = cfg["tideHash"].lower()
prices = [int(p) for p in cfg["prices"]]
P0 = int(cfg["startPrice"]); X0 = int(cfg["invWeth"]); Y0 = int(cfg["invUsdc"]); fee = int(cfg["feeBps"])
retailIn = int(cfg["retailIn"]); bigIn = int(cfg["bigIn"])

def word(data, i): return data[2 + 64 * i: 2 + 64 * (i + 1)]

rounds = []
for rc in run["receipts"]:
    fills = {"plain": [], "tide": []}
    for lg in rc["logs"]:
        if lg["address"].lower() != router or lg["topics"][0].lower() != SWAPPED: continue
        d = lg["data"]
        oh = "0x" + word(d, 0); tin = "0x" + word(d, 3)[24:]; tout = "0x" + word(d, 4)[24:]
        key = "plain" if oh.lower() == plainHash else "tide" if oh.lower() == tideHash else None
        if key: fills[key].append({"in": tin.lower(), "out": tout.lower(), "ain": int(word(d, 5), 16), "aout": int(word(d, 6), 16)})
    if fills["plain"] or fills["tide"]:
        rounds.append({"tx": rc["transactionHash"], "block": int(rc["blockNumber"], 16), "gas": int(rc["gasUsed"], 16), "fills": fills})
assert len(rounds) == len(prices), f"{len(rounds)} rounds in receipts, {len(prices)} prices"

# ---- metrics -------------------------------------------------------------------------------------
state = {k: {"X": X0, "Y": Y0, "arb": 0, "fees": 0, "retail": [], "retail_follow": [], "big": []} for k in ("plain", "tide")}
rows = []
for r, (rd, P) in enumerate(zip(rounds, prices)):
    row = {"P": P, "tx": rd["tx"], "block": rd["block"], "gas": rd["gas"], "nfills": sum(len(v) for v in rd["fills"].values())}
    for k in ("plain", "tide"):
        st = state[k]
        row[k + "_arb"] = 0
        row[k + "_had_arb"] = any(not (f["in"] == usdc and f["ain"] in (retailIn, bigIn)) for f in rd["fills"][k])
        for f in rd["fills"][k]:
            val_in = f["ain"] if f["in"] == usdc else f["ain"] * P // 10**18
            val_out = f["aout"] if f["out"] == usdc else f["aout"] * P // 10**18
            if f["in"] == usdc: st["Y"] += f["ain"]; st["X"] -= f["aout"]
            else: st["X"] += f["ain"]; st["Y"] -= f["aout"]
            st["fees"] += val_in * fee // 10_000
            is_retail = f["in"] == usdc and f["ain"] == retailIn
            is_big = f["in"] == usdc and f["ain"] == bigIn
            if is_retail or is_big:
                slip = (f["ain"] * 10**18 / f["aout"] / P - 1) * 1e4
                tag = "retail" if is_retail else "big"
                row[f"{k}_{tag}"] = (f["aout"], slip); st[tag].append(slip)
                if is_retail and row[k + "_had_arb"]: st["retail_follow"].append(slip)
            else:
                pnl = val_out - val_in
                st["arb"] += pnl; row[k + "_arb"] += pnl
        row[k + "_arb_cum"] = st["arb"]
    rows.append(row)

Pf = prices[-1]
def lp(k):
    st = state[k]; return st["X"] * Pf // 10**18 + st["Y"], X0 * Pf // 10**18 + Y0

# ---- render --------------------------------------------------------------------------------------
os.system("")
print()
line(f"  {B}{ACC}TIDE × AQUA{R}   {D}two SwapVM programs, one maker, one router, one registry, one price path{R}")
line(f"  {D}mainnet fork · Aqua registry {short(cfg['aqua'])} · router {short(cfg['router'])} · maker {short(cfg['maker'])}{R}")
line(f"  {D}{'─' * (W - 4)}{R}")
line("  " + " " * LW + col(f"{PLAIN}{B}PLAIN AQUA{R}", CW) + col(f"{TIDE}{B}TIDE{R}", CW))
line("  " + " " * LW + col(f"{PLAIN}{D}FeeFlatIn · XYCSwap · Salt{R}", CW) + col(f"{TIDE}{D}ACTIVE_SPLIT · VIRTUAL_XYC · BUFFER_GUARD{R}", CW))
line("  " + " " * LW + col(f"{PLAIN}{D}whole pool quoted, fee {fee} bp{R}", CW) + col(f"{TIDE}{D}λ {cfg['lambdaBps']/100:.0f}% · N {cfg['n']}× · δ {cfg['deltaBps']} bp · fee {fee} bp{R}", CW))
line("  " + col(f"{D}inventory{R}", LW) + col(f"{eth(X0)} + {usd(Y0)}", CW) + col(f"{eth(X0)} + {usd(Y0)}", CW))
line()
pause(0.4)

for i, row in enumerate(rows):
    P = row["P"]; chg = (P / (P0 if i == 0 else prices[i - 1]) - 1) * 100
    line(f"  {B}block {i+1}{R}  {D}ETH {pct(chg)} → ${P/1e6:,.2f}{R}")
    pc_, tc_ = row["plain_arb_cum"], row["tide_arb_cum"]
    top = max(pc_, tc_, 1)
    bar_p = "█" * max(1, round(26 * pc_ / top)); bar_t = "█" * max(1, round(26 * tc_ / top))
    saved = (1 - tc_ / pc_) * 100 if pc_ > 0 else 0
    line("  " + col(f"  arbitrage, running", LW) + col(f"{PLAIN}{usd(pc_):>11}  {D}{usd(row['plain_arb'], True)} this block{R}", CW) + col(f"{TIDE}{usd(tc_):>11}  {D}{usd(row['tide_arb'], True)} this block{R}", CW))
    line("  " + " " * LW + col(f"{PLAIN}{bar_p}{R}", CW) + col(f"{TIDE}{bar_t}{R}", CW) + f"{GOOD if saved > 0 else BAD}{pct(-saved)}{R} {D}taken from the LP so far{R}")
    (po, ps), (to, ts) = row["plain_retail"], row["tide_retail"]
    better = (to / po - 1) * 1e4
    note = f"{GOOD}{better:+.1f} bp{R} {D}for the trader{R}" if better > 0 else f"{BAD}{better:+.1f} bp{R} {D}no arbitrage this block on Tide, so the retail order was the first fill and met the active curve{R}" if not row["tide_had_arb"] else f"{BAD}{better:+.1f} bp{R} {D}for the trader{R}"
    line("  " + col(f"  retail buys ${retailIn // 10**6:,}", LW) + col(f"{PLAIN}{eth(po):>15}  {bps(ps)}{R}", CW) + col(f"{TIDE}{eth(to):>15}  {bps(ts)}{R}", CW) + note)
    if "plain_big" in row:
        (bpo, bs), (bto, bts) = row["plain_big"], row["tide_big"]
        line("  " + col(f"  ${bigIn // 10**6:,} order", LW) + col(f"{PLAIN}{eth(bpo):>15}  {bps(bs)}{R}", CW) + col(f"{TIDE}{eth(bto):>15}  {bps(bts)}{R}", CW) + f"{D}informed-sized: the guard re-prices it on the active curve{R}")
    line(f"  {D}  block {row['block']} · {short(row['tx'])} · {row['nfills']} fills in one transaction · {row['gas']:,} gas{R}")
    line()
    pause(0.3)

line(f"  {D}{'─' * (W - 4)}{R}")
line(f"  {B}after {len(rows)} blocks{R}")
pa, ta = state["plain"]["arb"], state["tide"]["arb"]
line("  " + col("  arbitrage extracted", LW) + col(f"{PLAIN}{usd(pa):>11}{R}", CW) + col(f"{TIDE}{usd(ta):>11}{R}", CW) + f"{GOOD}{B}{pct(-(1 - ta / pa) * 100)}{R}  {D}steady-state theory: 1/(2 − λ) = −33%{R}")
fp, hp = lp("plain"); ft, ht = lp("tide")
line("  " + col("  LP value vs holding", LW) + col(f"{PLAIN}{usd(fp - hp, True):>11}{R}", CW) + col(f"{TIDE}{usd(ft - ht, True):>11}{R}", CW) + f"{D}at ${Pf/1e6:,.2f}, fees included; Tide lags the market by design, so this swings both ways{R}")
line("  " + col("  fees earned", LW) + col(f"{PLAIN}{usd(state['plain']['fees']):>11}{R}", CW) + col(f"{TIDE}{usd(state['tide']['fees']):>11}{R}", CW))
rp = statistics.mean(state["plain"]["retail"]); rt = statistics.mean(state["tide"]["retail"])
fp_ = statistics.mean(state["plain"]["retail_follow"]) if state["plain"]["retail_follow"] else rp
ft_ = statistics.mean(state["tide"]["retail_follow"]) if state["tide"]["retail_follow"] else rt
line("  " + col("  retail slippage, avg", LW) + col(f"{PLAIN}{bps(rp, False):>11}{R}", CW) + col(f"{TIDE}{bps(rt, False):>11}{R}", CW) + f"{D}${retailIn // 10**6:,} orders, fee included, all blocks{R}")
line("  " + col("    as a follow-on fill", LW) + col(f"{PLAIN}{bps(fp_, False):>11}{R}", CW) + col(f"{TIDE}{bps(ft_, False):>11}{R}", CW) + f"{GOOD}{ft_ - fp_:+.1f} bp{R} {D}blocks where the arbitrageur went first: the deep curve{R}")
line("  " + col("  final inventory", LW) + col(f"{PLAIN}{eth(state['plain']['X'])} + {usd(state['plain']['Y'])}{R}", CW) + col(f"{TIDE}{eth(state['tide']['X'])} + {usd(state['tide']['Y'])}{R}", CW))
line()
line(f"  {D}Every number above is decoded from a Swapped event on the fork: real Aqua.push / Aqua.pull transfers against the maker's wallet.{R}")
line(f"  {D}The two strategies differ in one thing, the SwapVM program. Tide's three opcodes live in contracts/src/aqua/instructions/.{R}")
print()

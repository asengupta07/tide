> Planning notes from Sep 25, kept for history. They predate the fee bound, the guardrails and MongoDB; the shipped design is in `MATHEMATICS_MODEL.md`, `docs/DEPLOYMENT.md` and the whitepaper.

# Tide × 1inch Aqua

## Simple role

**Aqua is Tide's trading engine.** It keeps the market maker's tokens in their wallet and moves them only when a swap is completed. Tide adds custom trading rules that decide how much inventory is exposed during each block.

## How Tide integrates Aqua

Tide uses the official Aqua registry and a modified SwapVM router with three custom instructions:

1. **Active Split** — exposes only `lambda` percent of the maker's inventory for the block.
2. **Virtual Depth** — gives bounded later trades a deeper price curve so reduced exposure does not automatically mean poor execution.
3. **Buffer Guard** — rejects unsafe outputs and reprices trades that move too far from the block's reference price.

`TideParams` supplies the three strategy settings:

- `lambda`: percentage of inventory exposed per block.
- `N`: virtual depth multiplier.
- `delta`: maximum permitted price drift.

## What is working

- Official Aqua settlement is used.
- Tide has three custom SwapVM opcodes.
- Real token `pull` and `push` settlement has been demonstrated.
- Active/passive splitting, virtual pricing, buffer protection, and multi-trade behavior are implemented.
- Contract tests cover Aqua behavior and parity with the Uniswap v4 implementation.

## What needs to be fixed or added

- Align the deployed swap fee with the fee assumed by the optimization model.
- Add a visible standard-Aqua-versus-Tide comparison.
- Test hostile ordering such as dust-first and split-trade attacks.
- Make fill indexing reliable and show RPC/indexing failures instead of displaying them as zero fills.
- Show LP loss, arbitrage profit, fees, inventory drift, and net performance in the dashboard.

## Prize target

**Primary target: Build an Aqua App.**

Tide fits this track because it implements a sophisticated Aqua position, modifies SwapVM with original instructions, and executes real on-chain token transfers.

## Winning demo

Run a standard Aqua strategy and Tide with identical reserves and the same price movement. Show:

| Result | Standard Aqua | Tide |
| --- | ---: | ---: |
| Arbitrageur profit | `$X` | `$Y` |
| LP loss | `$X` | `$Y` |
| Later-trade slippage | `X%` | `Y%` |
| Inventory remaining | `$X` | `$Y` |
| Gas used | `X` | `Y` |

Finish by opening the transaction trace and showing the real Aqua token transfers.

## One-line pitch

> Tide is a loss-budgeted Aqua market maker: it limits how much of a wallet the market can access per block while passive inventory supports bounded, deeper execution.

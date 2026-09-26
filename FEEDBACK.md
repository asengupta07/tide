# Uniswap v4 developer feedback

Written while building `contracts/src/v4/TideHook.sol`, a hook that replaces the standard concentrated-liquidity pricing path with a
partially-active constant-product curve (PA-AMM, arXiv 2602.09887) plus an N-scaled virtual curve with a
collateral buffer (HLCP, arXiv 2605.19267). Same math as our 1inch Aqua SwapVM program; a cross-venue
test asserts identical amounts on both venues.

## What we built

Tide is a Uniswap v4 custom-curve hook that protects LP inventory from arbitrage without sacrificing
execution quality for follow-on flow. At the beginning of each block, only `lambda` of the hook's total
reserves is exposed to the active constant-product curve. Later swaps use an `N`-times deeper virtual
curve. A `delta` drift bound falls back to the active curve when a virtual quote moves too far from the
block anchor, and every output is capped by the hook's real active plus passive reserves.

`TideHook` owns liquidity as ERC-6909 claims and issues ERC-20 `TIDE-LP` shares. It supports exact-input
and exact-output swaps in both directions, applies a token-input fee, blocks JIT liquidity changes around
swaps, and burns minimum liquidity on the first deposit. `beforeSwap` returns the complete
`BeforeSwapDelta`, so Tide owns the pricing path rather than attempting to modify the standard curve.

The hook imports the same `TideMath` library as our Aqua SwapVM implementation. `CrossVenueTest` executes
the same eight trades over three blocks against both venues and requires identical input and output amounts
at every step.

An automated manager may adjust `lambda`, `N`, and `delta`, keyed by the v4 `PoolId`, but `TideParams`
enforces the LP's range, maximum step, `N` limit, cooldown, and the fee-safety condition
`(N - 1) * delta <= 2 * fee`. The manager cannot transfer liquidity, replace the owner, change the fee,
or weaken its own guardrails.

The deployed Sepolia hook is
[`0x1391EC676d47884a1A4837Dc6F108aBfEf6cAA88`](https://sepolia.etherscan.io/address/0x1391EC676d47884a1A4837Dc6F108aBfEf6cAA88).
A demonstrated swap is
[`0xdc2ccf75a2c29c630e54f329235a7d17708225959f5d988f34e804843b413944`](https://sepolia.etherscan.io/tx/0xdc2ccf75a2c29c630e54f329235a7d17708225959f5d988f34e804843b413944).

## What was easy

- **`beforeSwap` + `BeforeSwapDelta` is the right primitive for a custom curve.** Returning a delta for
  the full specified amount means the PoolManager never touches the standard pool curve; we only needed
  `beforeSwapReturnDelta`. OpenZeppelin's `BaseCustomCurve` (uniswap-hooks v1.2.1) reduced our hook to one
  pricing function, `_getUnspecifiedAmount`, and two share-accounting functions.
- **ERC-6909 claims as the hook's own reserve** made the "passive buffer" trivial: the hook's claim
  balance is the total, `lambda` of it is the active slice, the rest is the buffer. No token transfers
  inside the swap path.
- **`deployCodeTo` + `HookMiner`** made address-flag mining a non-issue in tests and scripts.

## Biggest blocker faced

The largest integration blocker was compiler and build-tool compatibility around `PoolManager`, rather
than the hook logic itself. `PoolManager.sol` is pinned to Solidity `=0.8.26`, while Tide and the SwapVM
side of our repository compile with Solidity `0.8.30`. Importing common deployment helpers pulled
PoolManager into the wrong compiler unit. Compiling it with `via_ir` also required the upstream
`optimizer_runs = 44444444` setting to avoid a Yul stack-too-deep failure.

We solved this with Foundry compilation restrictions, a separate 0.8.26 PoolManager artifact, and
artifact-bytecode deployment from the 0.8.30 tests. A documented mixed-compiler setup or published
PoolManager artifacts would have saved more time than any other single improvement.

## What was hard

- **There is no block boundary callback.** The PA-AMM re-split happens "at the top of every block" in
  the paper. A hook only sees `beforeSwap`, so the re-split is lazy: the first swap of a block detects
  `blockNumber != lastBlock` and recomputes the active slice. It works, but a `beforeBlock`-style hook,
  or an exposed "first interaction in this block" flag on the PoolManager, would remove a storage read and
  a branch from every swap and make the semantics obvious to integrators. We document the lazy split and
  test the "two swaps in one block" and "next block re-splits" cases explicitly.
- **Solc pinning.** `PoolManager.sol` is pinned to `=0.8.26` while our contracts (and 1inch SwapVM) need
  `0.8.30`. Any test that imports `Deployers.sol` pulls in `PoolManager.sol` and fails the version check.
  We ended up compiling `PoolManager` in a separate 0.8.26 unit and deploying it from the artifact bytes in
  tests. A `^0.8.26` pragma on the core, or a published artifact package, would save every hook author an
  afternoon.
- **`via_ir` + default optimizer settings cannot compile `PoolManager`** ("stack too deep" in Yul). It
  needs the upstream `optimizer_runs = 44444444`. We used Foundry's `compilation_restrictions` to give
  that one file its own settings. Worth a line in the hooks quickstart.
- **`BaseCustomAccounting` forces liquidity through the hook** (`modifyLiquidity` reverts). That is the
  correct design for a custom curve, but it means a passive LP cannot use the standard PositionManager
  flow. A recommended UI pattern for hook-owned liquidity would help adoption.
- **`_getSwapFeeAmount` is informational.** `BaseCustomCurve` calls it after `_getUnspecifiedAmount`
  and uses the value only for the `HookSwap` event; it does not net the fee out of the swap. A custom
  curve that charges a fee has to apply it inside `_getUnspecifiedAmount` and then report the same
  number from `_getSwapFeeAmount` (we keep it in a transient variable between the two calls). Either a
  line in the docs, or letting `_getUnspecifiedAmount` return the fee alongside the amount, would save
  the round trip through storage.
- **Dynamic fee flag is required even for a zero-fee custom curve.** Initialising with a static fee still
  routes through fee logic that has no meaning when the hook returns the whole delta. A `NO_FEE`
  sentinel for full-delta hooks would be clearer than `DYNAMIC_FEE_FLAG` with `_getSwapFeeAmount = 0`.

## Hardest part of building an agentic application

The hardest part was giving an agent useful autonomy without making it an unrestricted pool admin.
Market state can change between proposal, simulation, and execution, so an off-chain policy is not a
sufficient safety boundary.

We restricted the agent to three parameters and enforce its authority in `TideParams`:

- `lambda` must remain inside the LP's range;
- one adjustment cannot exceed the LP's maximum step;
- `N` has an LP-defined maximum;
- manager writes have a cooldown;
- `delta` must remain compatible with the fee-safety bound; and
- only the owner may change the manager, fee, or guardrails.

The hook reads these parameters on every quote and swap, so the contracts—not the agent—remain the final
authority. The difficult engineering was handling stale proposals, cooldowns, failed transactions, and
synchronized parameter state without letting any off-chain state bypass the on-chain limits. Our main
lesson was that an agent should manage a narrow, contract-enforced strategy surface, not own the pool or
hold arbitrary liquidity permissions.

## Suggestions

1. Expose `block.number` of the pool's last state change (or a per-block counter) on `PoolManager` so
   hooks can implement block-scoped logic without their own storage.
2. Relax the `=0.8.26` pragma on `PoolManager.sol` or publish compiled artifacts for test use.
3. Add a `BaseCustomCurve` example with hook-owned reserves and pro-rata shares (ours is
   `contracts/src/v4/TideHook.sol`, functions `_getUnspecifiedAmount` / `_compute`), since most custom curves
   need exactly that.
4. Document JIT-liquidity guards for hook-owned liquidity; the pattern we used (reject add/remove in a
   block that already swapped, and remove in the block of the add) took a few iterations to get right.
5. Add a `BeforeSwapDelta` truth table covering both token directions and exact-input versus exact-output.
6. Add an explicit fee lifecycle example for full-delta hooks, including the relationship between
   `_getUnspecifiedAmount` and `_getSwapFeeAmount`.

The single improvement with the greatest impact would be an official, production-shaped custom-curve
template that compiles with the documented toolchain and includes fee accounting plus LP-share management.

## Verification

Run:

```bash
cd contracts
forge test
```

At submission time, all **54 Foundry tests pass**. This includes 17 hook-specific tests covering quote/fill
equality, both token directions, exact-input and exact-output, first and follow-on block behavior, drift
fallback, passive-buffer top-up, fee reporting, round-trip safety, LP accounting, JIT protection, and
manager guardrails. The cross-venue suite additionally proves exact Aqua/v4 parity over an eight-trade,
three-block sequence. No mainnet funds are required to reproduce these tests.

## Pointers

- Hook: `contracts/src/v4/TideHook.sol` (`_getUnspecifiedAmount`, `_compute`, JIT guard in
  `addLiquidity` / `removeLiquidity`)
- Shared math: `contracts/src/lib/TideMath.sol`
- Tests: `contracts/test/v4/TideHook.t.sol`, `contracts/test/CrossVenue.t.sol`
- Sepolia deployment script: `contracts/script/DeployHook.s.sol`
- Guarded parameters: `contracts/src/TideParams.sol`
- Sepolia deployment record: `contracts/deployments/11155111-hook.json`

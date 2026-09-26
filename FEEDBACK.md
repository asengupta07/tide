# Uniswap v4 developer feedback

Written while building `contracts/src/v4/TideHook.sol`, a hook that replaces the v3 curve with a
partially-active constant-product curve (PA-AMM, arXiv 2602.09887) plus an N-scaled virtual curve with a
collateral buffer (HLCP, arXiv 2605.19267). Same math as our 1inch Aqua SwapVM program; a cross-venue
test asserts identical amounts on both venues.

## What was easy

- **`beforeSwap` + `BeforeSwapDelta` is the right primitive for a custom curve.** Returning a delta for
  the full specified amount means the PoolManager never touches the v3 curve; we only needed
  `beforeSwapReturnDelta`. OpenZeppelin's `BaseCustomCurve` (uniswap-hooks v1.2.1) reduced our hook to one
  pricing function, `_getUnspecifiedAmount`, and two share-accounting functions.
- **ERC-6909 claims as the hook's own reserve** made the "passive buffer" trivial: the hook's claim
  balance is the total, `lambda` of it is the active slice, the rest is the buffer. No token transfers
  inside the swap path.
- **`deployCodeTo` + `HookMiner`** made address-flag mining a non-issue in tests and scripts.

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

## Suggestions

1. Expose `block.number` of the pool's last state change (or a per-block counter) on `PoolManager` so
   hooks can implement block-scoped logic without their own storage.
2. Relax the `=0.8.26` pragma on `PoolManager.sol` or publish compiled artifacts for test use.
3. Add a `BaseCustomCurve` example with hook-owned reserves and pro-rata shares (ours is
   `contracts/src/v4/TideHook.sol`, functions `_getAmountIn` / `_getAmountOut`), since most custom curves
   need exactly that.
4. Document JIT-liquidity guards for hook-owned liquidity; the pattern we used (reject add/remove in a
   block that already swapped, and remove in the block of the add) took a few iterations to get right.

## Pointers

- Hook: `contracts/src/v4/TideHook.sol` (`_getUnspecifiedAmount`, `_computeWithAmounts`, JIT guard in
  `addLiquidity` / `removeLiquidity`)
- Shared math: `contracts/src/lib/TideMath.sol`
- Tests: `contracts/test/v4/TideHook.t.sol`, `contracts/test/CrossVenue.t.sol`
- Sepolia deployment script: `contracts/script/DeployHook.s.sol`

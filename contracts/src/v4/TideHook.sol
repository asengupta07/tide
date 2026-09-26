// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

import { BaseHook } from "@openzeppelin/uniswap-hooks/src/base/BaseHook.sol";
import { BaseCustomCurve } from "@openzeppelin/uniswap-hooks/src/base/BaseCustomCurve.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId } from "@uniswap/v4-core/src/types/PoolId.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";

import { TideMath } from "../lib/TideMath.sol";
import { TideParams } from "../TideParams.sol";

/// @title TideHook
/// @notice Uniswap v4 hook running the Tide partially-active AMM with the same `TideMath` as the Aqua
///         SwapVM program, so the two venues quote identically for identical reserves and parameters.
///
///         The hook owns the pool's liquidity as ERC-6909 claims (OpenZeppelin `BaseCustomCurve`): LPs add
///         through {addLiquidity} and receive ERC-20 shares; `PoolManager.modifyLiquidity` is rejected. Per
///         block the hook exposes `lambda` of its claims as the active slice; the remainder is the passive
///         buffer. `beforeSwap` returns a `BeforeSwapDelta` for the full amount, so the v3 curve is never used.
///
///         Block semantics (identical to the SwapVM opcodes):
///         1. First swap of a block: lazy re-split, active = lambda * total, priced on the active curve (N = 1).
///         2. Later swaps in the block: priced on the N-scaled curve over the current active reserves; a swap
///            that would move the virtual price more than `delta` from the block anchor is re-priced on the
///            active curve.
///         3. Solvency: output <= active + passive; dipping into passive re-splits from the new totals.
///         4. Fee: a flat fee on tokenIn read from `TideParams`; the curve and the guard see the net input,
///            the fee stays in the hook's reserves (passive) until the next re-split.
///
///         JIT protection: liquidity cannot be added or removed in a block in which a swap already happened,
///         and a position cannot be removed in the block it was added.
contract TideHook is BaseCustomCurve, ERC20 {
    using Math for uint256;

    error TideJitLiquidity();
    error TideInsufficientLiquidity(uint256 amountOut, uint256 active, uint256 passive);
    error TideZeroShares();

    event TideResplit(PoolId indexed poolId, uint64 blockNumber, uint256 active0, uint256 active1);
    event TideTopUp(PoolId indexed poolId, uint256 active0, uint256 active1);

    struct BlockState {
        uint64 blockNumber;
        uint256 active0;
        uint256 active1;
        uint256 anchor0;
        uint256 anchor1;
    }

    TideParams public immutable PARAMS;

    BlockState private _state;
    mapping(address => uint256) public lastAddBlock;

    constructor(IPoolManager poolManager_, TideParams params) BaseHook(poolManager_) ERC20("Tide LP", "TIDE-LP") {
        PARAMS = params;
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    function paramsKey() public view returns (bytes32) {
        return PoolId.unwrap(poolKey().toId());
    }

    function state() external view returns (BlockState memory) {
        return _state;
    }

    /// @notice Total reserves held by the hook as ERC-6909 claims.
    function reserves() public view returns (uint256 total0, uint256 total1) {
        PoolKey memory key = poolKey();
        total0 = poolManager.balanceOf(address(this), key.currency0.toId());
        total1 = poolManager.balanceOf(address(this), key.currency1.toId());
    }

    /// @notice Read-only quote with the same logic as `beforeSwap`. Used by the dashboard and tests.
    ///         Exact-in returns the output; exact-out returns the gross input including the fee.
    function quote(bool zeroForOne, bool exactInput, uint256 amount) external view returns (uint256 unspecified) {
        Fill memory f = _compute(zeroForOne, exactInput, amount);
        unspecified = exactInput ? f.amountOut : f.amountIn;
    }

    // ---------------------------------------------------------------------------------------------
    // Swap
    // ---------------------------------------------------------------------------------------------

    /// @dev One priced fill. `amountIn` is what the taker pays (gross); `netIn` is what the curve saw.
    struct Fill {
        uint256 amountIn;
        uint256 netIn;
        uint256 amountOut;
        bool first;
        bool topUp;
        uint32 lambdaBps;
    }

    /// @dev Fee of the fill being executed, reported to `HookSwap` through `_getSwapFeeAmount`.
    uint256 private transient _lastFee;

    function _getUnspecifiedAmount(SwapParams calldata params) internal override returns (uint256 unspecified) {
        bool exactInput = params.amountSpecified < 0;
        uint256 specified = exactInput ? uint256(-params.amountSpecified) : uint256(params.amountSpecified);

        Fill memory f = _compute(params.zeroForOne, exactInput, specified);
        unspecified = exactInput ? f.amountOut : f.amountIn;
        _lastFee = f.amountIn - f.netIn;

        // Post-fill bookkeeping, mirrors ActiveSplit.exec in the SwapVM program. The whole gross input lands
        // in the hook's claims; only the net part enters the active slice, the fee waits in the buffer.
        (uint256 total0, uint256 total1) = reserves();
        (uint256 in0, uint256 in1, uint256 out0, uint256 out1) = params.zeroForOne
            ? (f.amountIn, uint256(0), uint256(0), f.amountOut)
            : (uint256(0), f.amountIn, f.amountOut, uint256(0));

        uint256 active0;
        uint256 active1;
        if (f.topUp) {
            active0 = TideMath.activeReserve(total0 + in0 - out0, f.lambdaBps);
            active1 = TideMath.activeReserve(total1 + in1 - out1, f.lambdaBps);
        } else {
            (active0, active1) = _activeNow(f.first, f.lambdaBps, total0, total1);
            (in0, in1) = params.zeroForOne ? (f.netIn, uint256(0)) : (uint256(0), f.netIn);
            active0 = active0 + in0 - out0;
            active1 = active1 + in1 - out1;
        }
        _state.active0 = active0;
        _state.active1 = active1;
        if (f.first) {
            _state.blockNumber = uint64(block.number);
            _state.anchor0 = active0;
            _state.anchor1 = active1;
            emit TideResplit(poolKey().toId(), uint64(block.number), active0, active1);
        }
        if (f.topUp) emit TideTopUp(poolKey().toId(), active0, active1);
    }

    function _getSwapFeeAmount(SwapParams calldata, uint256) internal view override returns (uint256) {
        return _lastFee;
    }

    /// @dev Pure pricing path shared by `quote` and `beforeSwap`.
    function _compute(bool zeroForOne, bool exactInput, uint256 specified) internal view returns (Fill memory f) {
        (uint32 l, uint32 n, uint32 deltaBps, uint32 feeBps) = PARAMS.get(paramsKey());
        f.lambdaBps = l;
        f.first = _state.blockNumber != block.number;

        (uint256 total0, uint256 total1) = reserves();
        (uint256 active0, uint256 active1) = _activeNow(f.first, l, total0, total1);
        (uint256 balIn, uint256 balOut, uint256 totalOut) =
            zeroForOne ? (active0, active1, total1) : (active1, active0, total0);

        uint256 curveN = f.first ? 1 : n;
        if (exactInput) {
            f.amountIn = specified;
            f.netIn = specified - TideMath.feeOnInput(specified, feeBps);
            f.amountOut = TideMath.quoteExactIn(f.netIn, balIn, balOut, curveN);
        } else {
            f.amountOut = specified;
            f.netIn = TideMath.quoteExactOut(specified, balIn, balOut, curveN);
        }

        if (!f.first) {
            (uint256 refIn, uint256 refOut) =
                zeroForOne ? (_state.anchor0, _state.anchor1) : (_state.anchor1, _state.anchor0);
            if (TideMath.driftExceedsRef(refIn, refOut, balIn, balOut, f.netIn, f.amountOut, n, deltaBps)) {
                if (exactInput) f.amountOut = TideMath.quoteExactIn(f.netIn, balIn, balOut, 1);
                else f.netIn = TideMath.quoteExactOut(specified, balIn, balOut, 1);
            }
        }
        if (!exactInput) f.amountIn = f.netIn + TideMath.feeOnNet(f.netIn, feeBps);

        uint256 passiveOut = totalOut > balOut ? totalOut - balOut : 0;
        require(f.amountOut <= balOut + passiveOut, TideInsufficientLiquidity(f.amountOut, balOut, passiveOut));
        f.topUp = f.amountOut > balOut;
    }

    function _activeNow(bool first, uint256 lambdaBps, uint256 total0, uint256 total1)
        internal
        view
        returns (uint256 active0, uint256 active1)
    {
        if (first) {
            active0 = TideMath.activeReserve(total0, lambdaBps);
            active1 = TideMath.activeReserve(total1, lambdaBps);
        } else {
            active0 = _state.active0;
            active1 = _state.active1;
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Liquidity: pro-rata shares, JIT guard
    // ---------------------------------------------------------------------------------------------

    function addLiquidity(AddLiquidityParams calldata params) public payable override returns (BalanceDelta delta) {
        if (_state.blockNumber == block.number) revert TideJitLiquidity();
        lastAddBlock[msg.sender] = block.number;
        return super.addLiquidity(params);
    }

    function removeLiquidity(RemoveLiquidityParams calldata params) public override returns (BalanceDelta delta) {
        if (_state.blockNumber == block.number || lastAddBlock[msg.sender] == block.number) revert TideJitLiquidity();
        return super.removeLiquidity(params);
    }

    function _getAmountIn(AddLiquidityParams memory params)
        internal
        view
        override
        returns (uint256 amount0, uint256 amount1, uint256 shares)
    {
        (uint256 total0, uint256 total1) = reserves();
        uint256 supply = totalSupply();
        if (supply == 0 || total0 == 0 || total1 == 0) {
            amount0 = params.amount0Desired;
            amount1 = params.amount1Desired;
            shares = Math.sqrt(amount0 * amount1);
        } else {
            // Keep the reserve ratio: scale the desired amounts down to the binding side.
            uint256 amount1Optimal = params.amount0Desired * total1 / total0;
            if (amount1Optimal <= params.amount1Desired) {
                (amount0, amount1) = (params.amount0Desired, amount1Optimal);
            } else {
                (amount0, amount1) = (params.amount1Desired * total0 / total1, params.amount1Desired);
            }
            shares = Math.min(amount0 * supply / total0, amount1 * supply / total1);
        }
        if (shares == 0) revert TideZeroShares();
    }

    function _getAmountOut(RemoveLiquidityParams memory params)
        internal
        view
        override
        returns (uint256 amount0, uint256 amount1, uint256 shares)
    {
        (uint256 total0, uint256 total1) = reserves();
        uint256 supply = totalSupply();
        shares = params.liquidity;
        amount0 = shares * total0 / supply;
        amount1 = shares * total1 / supply;
    }

    function _mint(AddLiquidityParams memory, BalanceDelta, BalanceDelta, uint256 shares) internal override {
        _mint(msg.sender, shares);
    }

    function _burn(RemoveLiquidityParams memory, BalanceDelta, BalanceDelta, uint256 shares) internal override {
        _burn(msg.sender, shares);
    }
}

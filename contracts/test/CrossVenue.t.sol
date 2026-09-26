// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ISwapVM } from "@1inch/swap-vm/interfaces/ISwapVM.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { BaseCustomAccounting } from "@openzeppelin/uniswap-hooks/src/base/BaseCustomAccounting.sol";

import { TideAquaBase } from "./aqua/TideAquaBase.sol";
import { TideHook } from "../src/v4/TideHook.sol";

/// @dev Venue independence: the same reserves, parameters and trade sequence produce identical amounts on
///      the Aqua SwapVM program and on the Uniswap v4 hook, block by block.
contract CrossVenueTest is TideAquaBase {
    using PoolIdLibrary for PoolKey;

    IPoolManager internal poolManager;
    PoolSwapTest internal swapRouter;
    TideHook internal hook;
    PoolKey internal key;

    function setUp() public override {
        super.setUp();

        // v4 side: same tokens (tokenA = currency0), same params contract, same lambda / N / delta
        string memory json = vm.readFile("out/PoolManager.sol/PoolManager.json");
        bytes memory init = bytes.concat(vm.parseJsonBytes(json, ".bytecode.object"), abi.encode(address(this)));
        address pm;
        assembly ("memory-safe") {
            pm := create(0, add(init, 0x20), mload(init))
        }
        poolManager = IPoolManager(pm);
        swapRouter = new PoolSwapTest(poolManager);

        address flags = address(
            uint160(
                Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
                    | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
            ) ^ (0x71de << 144)
        );
        deployCodeTo("TideHook.sol:TideHook", abi.encode(poolManager, params, address(this)), flags);
        hook = TideHook(payable(flags));
        params.setHook(address(hook));
        key = PoolKey(
            Currency.wrap(address(tokenA)),
            Currency.wrap(address(tokenB)),
            LPFeeLibrary.DYNAMIC_FEE_FLAG,
            60,
            IHooks(hook)
        );
        poolManager.initialize(key, 79_228_162_514_264_337_593_543_950_336);
        params.setManager(PoolId.unwrap(key.toId()), manager); // claimed by the hook at initialize

        tokenA.mint(address(this), 1e30);
        tokenB.mint(address(this), 1e30);
        tokenA.approve(address(hook), type(uint256).max);
        tokenB.approve(address(hook), type(uint256).max);
        tokenA.approve(address(swapRouter), type(uint256).max);
        tokenB.approve(address(swapRouter), type(uint256).max);
        hook.addLiquidity(
            BaseCustomAccounting.AddLiquidityParams(BAL_A, BAL_B, 0, 0, type(uint256).max, -887_220, 887_220, 0)
        );
        vm.roll(block.number + 1);
    }

    function _hookSwap(bool aToB, bool exactIn, uint256 amount)
        internal
        returns (uint256 amountIn, uint256 amountOut)
    {
        BalanceDelta d = swapRouter.swap(
            key,
            SwapParams({
                zeroForOne: aToB,
                amountSpecified: exactIn ? -int256(amount) : int256(amount),
                sqrtPriceLimitX96: aToB ? 4_295_128_740 : 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            ""
        );
        (int128 dIn, int128 dOut) = aToB ? (d.amount0(), d.amount1()) : (d.amount1(), d.amount0());
        amountIn = uint256(-int256(dIn));
        amountOut = uint256(int256(dOut));
    }

    function test_SameSequence_SameAmounts_AcrossVenues() public {
        (ISwapVM.Order memory order,) = _ship();

        // block 1: informed fill, retail follow-on, an informed-sized follow-on, an exact-out reverse trade
        uint256[5] memory amounts = [uint256(1e18), 0.1e18, 3e18, 1500e18, 0.4e18];
        bool[5] memory exactIn = [true, true, true, true, false];
        bool[5] memory aToB = [true, true, true, false, true];

        for (uint256 i; i < 5; i++) {
            if (i == 3) vm.roll(block.number + 1); // new block: lazy re-split on both venues
            (uint256 aIn, uint256 aOut) = _swap(order, amounts[i], exactIn[i], aToB[i]);
            (uint256 hIn, uint256 hOut) = _hookSwap(aToB[i], exactIn[i], amounts[i]);
            assertEq(aIn, hIn, string.concat("amountIn step ", vm.toString(i)));
            assertEq(aOut, hOut, string.concat("amountOut step ", vm.toString(i)));
        }
    }
}

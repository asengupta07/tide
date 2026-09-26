// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { PoolModifyLiquidityTest } from "@uniswap/v4-core/src/test/PoolModifyLiquidityTest.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { ModifyLiquidityParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { BaseCustomAccounting } from "@openzeppelin/uniswap-hooks/src/base/BaseCustomAccounting.sol";

import { TideHook } from "../../src/v4/TideHook.sol";
import { TideParams } from "../../src/TideParams.sol";
import { TideMath } from "../../src/lib/TideMath.sol";

contract TideHookTest is Test {
    using PoolIdLibrary for PoolKey;

    uint160 internal constant SQRT_PRICE_1_1 = 79_228_162_514_264_337_593_543_950_336;

    IPoolManager internal manager;
    PoolSwapTest internal swapRouter;
    PoolModifyLiquidityTest internal modifyLiquidityRouter;
    Currency internal currency0;
    Currency internal currency1;
    PoolKey internal key;

    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_DEADLINE = 12_329_839_823;
    int24 internal constant MIN_TICK = -887_220;
    int24 internal constant MAX_TICK = 887_220;

    uint256 internal constant BAL_0 = 100e18;
    uint256 internal constant BAL_1 = 300_000e18;
    uint32 internal constant LAMBDA = 5000;
    uint32 internal constant N = 4;
    uint32 internal constant DELTA = 20;
    uint32 internal constant FEE = 30;

    TideHook internal hook;
    TideParams internal params;
    PoolId internal poolId;
    address internal manager_ = address(0xBEEF);

    function setUp() public {
        manager = IPoolManager(_deployPoolManager());
        swapRouter = new PoolSwapTest(manager);
        modifyLiquidityRouter = new PoolModifyLiquidityTest(manager);

        MockERC20 t0 = new MockERC20("Wrapped Ether", "WETH", 18);
        MockERC20 t1 = new MockERC20("USD Coin", "USDC", 18);
        if (address(t0) > address(t1)) (t0, t1) = (t1, t0);
        currency0 = Currency.wrap(address(t0));
        currency1 = Currency.wrap(address(t1));
        t0.mint(address(this), 1e30);
        t1.mint(address(this), 1e30);
        t0.approve(address(swapRouter), type(uint256).max);
        t1.approve(address(swapRouter), type(uint256).max);
        t0.approve(address(modifyLiquidityRouter), type(uint256).max);
        t1.approve(address(modifyLiquidityRouter), type(uint256).max);

        params = new TideParams(IAqua(address(0)));

        address flags = address(
            uint160(
                Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
                    | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
            ) ^ (0x71de << 144)
        );
        deployCodeTo("TideHook.sol:TideHook", abi.encode(manager, params, address(this)), flags);
        hook = TideHook(payable(flags));
        params.setHook(address(hook));

        key = PoolKey(currency0, currency1, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(hook)));
        poolId = key.toId();
        manager.initialize(key, SQRT_PRICE_1_1);

        MockERC20(Currency.unwrap(currency0)).approve(address(hook), type(uint256).max);
        MockERC20(Currency.unwrap(currency1)).approve(address(hook), type(uint256).max);

        params.setManager(PoolId.unwrap(poolId), manager_); // the hook claimed the key for us at initialize

        vm.roll(1000);
        _add(BAL_0, BAL_1);
        vm.roll(1001);
    }

    /// @dev PoolManager is pinned to solc 0.8.26 and compiled from `PoolManagerArtifact.sol`; deploy it from
    ///      the artifact bytes so this 0.8.30 test never imports it.
    function _deployPoolManager() internal returns (address deployed) {
        string memory json = vm.readFile("out/PoolManager.sol/PoolManager.json");
        bytes memory creation = vm.parseJsonBytes(json, ".bytecode.object");
        bytes memory init = bytes.concat(creation, abi.encode(address(this)));
        assembly ("memory-safe") {
            deployed := create(0, add(init, 0x20), mload(init))
        }
        require(deployed != address(0), "PoolManager deploy failed");
        vm.label(deployed, "PoolManager");
    }

    function _add(uint256 a0, uint256 a1) internal {
        hook.addLiquidity(
            BaseCustomAccounting.AddLiquidityParams(a0, a1, 0, 0, MAX_DEADLINE, MIN_TICK, MAX_TICK, bytes32(0))
        );
    }

    function swap(PoolKey memory k, bool zeroForOne, int256 amountSpecified, bytes memory hookData)
        internal
        returns (BalanceDelta)
    {
        return swapRouter.swap(
            k,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: amountSpecified,
                sqrtPriceLimitX96: zeroForOne
                    ? 4_295_128_740
                    : 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            hookData
        );
    }

    function _swapExactIn(bool zeroForOne, uint256 amountIn) internal returns (uint256 amountOut) {
        BalanceDelta d = swap(key, zeroForOne, -int256(amountIn), "");
        int128 out = zeroForOne ? d.amount1() : d.amount0();
        amountOut = uint256(int256(out));
    }

    function _swapExactOut(bool zeroForOne, uint256 amountOut) internal returns (uint256 amountIn) {
        BalanceDelta d = swap(key, zeroForOne, int256(amountOut), "");
        int128 inn = zeroForOne ? d.amount0() : d.amount1();
        amountIn = uint256(-int256(inn));
    }

    function _xyc(uint256 amountIn, uint256 balIn, uint256 balOut) internal pure returns (uint256) {
        return amountIn * balOut / (balIn + amountIn);
    }

    // ---------------------------------------------------------------------------------------------

    function test_Reserves_HeldAsClaims() public view {
        (uint256 t0, uint256 t1) = hook.reserves();
        assertEq(t0, BAL_0);
        assertEq(t1, BAL_1);
        assertGt(hook.balanceOf(address(this)), 0, "LP shares minted");
    }

    function _net(uint256 amountIn) internal pure returns (uint256) {
        return amountIn - TideMath.feeOnInput(amountIn, FEE);
    }

    function test_FirstSwap_QuotesAgainstActiveSliceOnly() public {
        uint256 amountIn = 1e18;
        uint256 expected = _xyc(_net(amountIn), BAL_0 * LAMBDA / BPS, BAL_1 * LAMBDA / BPS);
        assertEq(hook.quote(true, true, amountIn), expected, "view quote");
        uint256 out = _swapExactIn(true, amountIn);
        assertEq(out, expected, "swap == quote");
        assertLt(out, _xyc(amountIn, BAL_0, BAL_1), "worse than full-pool XYC for the arb");
    }

    function test_SecondSwapInBlock_QuotesOnVirtualCurve() public {
        _swapExactIn(true, 0.1e18);
        TideHook.BlockState memory s = hook.state();
        uint256 q = s.active0 / 4000;
        uint256 out = hook.quote(true, true, q);
        assertEq(out, TideMath.quoteExactIn(_net(q), s.active0, s.active1, N));
        assertEq(_swapExactIn(true, q), out, "swap == quote");
    }

    function test_Guard_RepricesInformedSizedFollowOnTrade() public {
        _swapExactIn(true, 0.1e18);
        TideHook.BlockState memory s = hook.state();
        uint256 q = s.active0 / 20;
        uint256 out = hook.quote(true, true, q);
        assertEq(out, TideMath.quoteExactIn(_net(q), s.active0, s.active1, 1), "re-priced on active curve");
    }

    function test_Guard_ExactOut_BeyondTotalReverts() public {
        _swapExactIn(true, 0.1e18);
        vm.expectRevert();
        hook.quote(true, false, BAL_1 + 1);
    }

    function test_Guard_TopUp_ResplitsFromPassiveBuffer() public {
        params.setFee(PoolId.unwrap(poolId), 6750); // owner = this test
        params.set(PoolId.unwrap(poolId), 2000, 4, 4500); // owner: a 30-point jump the manager's guardrails refuse
        _swapExactIn(true, 0.01e18);
        TideHook.BlockState memory s = hook.state();
        uint256 q = 84e18;
        uint256 out = hook.quote(true, true, q);
        assertGt(out, s.active1, "dips into passive buffer");
        vm.expectEmit(true, false, false, false, address(hook));
        emit TideHook.TideTopUp(poolId, 0, 0);
        _swapExactIn(true, q);
        (uint256 t0, uint256 t1) = hook.reserves();
        s = hook.state();
        assertEq(s.active0, t0 * 2000 / BPS);
        assertEq(s.active1, t1 * 2000 / BPS);
    }

    function test_TwoSwapsInOneBlock_ThenLazyResplitNextBlock() public {
        uint256 in1 = 1e18;
        uint256 out1 = _swapExactIn(true, in1);
        TideHook.BlockState memory s = hook.state();
        assertEq(s.blockNumber, block.number);
        assertEq(s.active0, BAL_0 * LAMBDA / BPS + _net(in1), "net input enters the active slice");
        assertEq(s.active1, BAL_1 * LAMBDA / BPS - out1);
        assertEq(s.anchor0, s.active0);

        uint256 in2 = 0.05e18;
        uint256 out2 = _swapExactIn(true, in2);
        s = hook.state();
        assertEq(s.active0, BAL_0 * LAMBDA / BPS + _net(in1) + _net(in2));
        assertEq(s.active1, BAL_1 * LAMBDA / BPS - out1 - out2);
        assertEq(s.anchor0, BAL_0 * LAMBDA / BPS + _net(in1), "anchor unchanged");

        vm.roll(block.number + 1);
        (uint256 t0, uint256 t1) = hook.reserves();
        assertEq(t0, BAL_0 + in1 + in2, "fees stay in the reserves");
        assertEq(hook.quote(true, true, 1e18), _xyc(_net(1e18), t0 * LAMBDA / BPS, t1 * LAMBDA / BPS), "fresh split");
    }

    function test_QuoteEqualsSwap_BothDirections_BothModes() public {
        _swapExactIn(true, 0.1e18);
        uint256 q1 = hook.quote(true, true, 0.02e18);
        assertEq(_swapExactIn(true, 0.02e18), q1);
        uint256 q2 = hook.quote(false, true, 30e18);
        assertEq(_swapExactIn(false, 30e18), q2);
        uint256 q3 = hook.quote(true, false, 45e18);
        assertEq(_swapExactOut(true, 45e18), q3);
        uint256 q4 = hook.quote(false, false, 0.03e18);
        assertEq(_swapExactOut(false, 0.03e18), q4);
    }

    function test_Params_NewLambda_AppliesAtNextResplit() public {
        _swapExactIn(true, 0.1e18);
        vm.prank(manager_);
        params.set(PoolId.unwrap(poolId), 2500, N, DELTA);
        vm.roll(block.number + 1);
        (uint256 t0, uint256 t1) = hook.reserves();
        assertEq(hook.quote(true, true, 1e18), _xyc(_net(1e18), t0 * 2500 / BPS, t1 * 2500 / BPS));
    }

    // Story 11: liquidity goes through the hook, JIT is rejected

    function test_DirectModifyLiquidity_Reverts() public {
        vm.expectRevert();
        modifyLiquidityRouter.modifyLiquidity(
            key, ModifyLiquidityParams({ tickLower: MIN_TICK, tickUpper: MAX_TICK, liquidityDelta: 1e18, salt: 0 }), ""
        );
    }

    function test_AddLiquidity_AfterSwapInSameBlock_Reverts() public {
        _swapExactIn(true, 0.1e18);
        vm.expectRevert(TideHook.TideJitLiquidity.selector);
        hook.addLiquidity(
            BaseCustomAccounting.AddLiquidityParams(1e18, 3000e18, 0, 0, MAX_DEADLINE, MIN_TICK, MAX_TICK, bytes32(0))
        );
    }

    function test_RemoveLiquidity_SameBlockAsAdd_Reverts() public {
        _add(1e18, 3000e18);
        uint256 shares = hook.balanceOf(address(this)) / 10;
        vm.expectRevert(TideHook.TideJitLiquidity.selector);
        hook.removeLiquidity(
            BaseCustomAccounting.RemoveLiquidityParams(shares, 0, 0, MAX_DEADLINE, MIN_TICK, MAX_TICK, bytes32(0))
        );
    }

    function test_RemoveLiquidity_NextBlock_ProRata() public {
        uint256 shares = hook.balanceOf(address(this));
        uint256 b0 = key.currency0.balanceOf(address(this));
        vm.roll(block.number + 1);
        hook.removeLiquidity(
            BaseCustomAccounting.RemoveLiquidityParams(shares / 2, 0, 0, MAX_DEADLINE, MIN_TICK, MAX_TICK, bytes32(0))
        );
        // MINIMUM_SHARES sit with the dead address, so half of the LP's shares is a hair under half the reserves
        uint256 expected = (shares / 2) * BAL_0 / (shares + 1000);
        assertApproxEqAbs(key.currency0.balanceOf(address(this)) - b0, expected, 1, "half of reserves back");
        assertEq(
            hook.balanceOf(0x000000000000000000000000000000000000dEaD), 1000, "dead shares burned on first deposit"
        );
        (uint256 t0,) = hook.reserves();
        assertApproxEqAbs(t0, BAL_0 - expected, 1);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ISwapVM } from "@1inch/swap-vm/interfaces/ISwapVM.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { Opcode } from "@1inch/swap-vm/libs/OpcodeList.sol";
import { SwapVM } from "@1inch/swap-vm/SwapVM.sol";

import { Vm } from "forge-std/Vm.sol";

import { TideAquaBase } from "./TideAquaBase.sol";
import { TideMath } from "../../src/lib/TideMath.sol";
import { TideProgram } from "../../src/aqua/instructions/TideProgram.sol";
import { ActiveSplit } from "../../src/aqua/instructions/ActiveSplit.sol";
import { BufferGuard } from "../../src/aqua/instructions/BufferGuard.sol";
import { TideParams } from "../../src/TideParams.sol";

contract TideAquaTest is TideAquaBase {
    // ---------------------------------------------------------------------------------------------
    // Opcode slots
    // ---------------------------------------------------------------------------------------------

    function test_OpcodeSlots_AreReservedThirdPartySlots() public pure {
        assertEq(uint8(TideProgram.ACTIVE_SPLIT), 0x92);
        assertEq(uint8(TideProgram.VIRTUAL_XYC), 0x52);
        assertEq(uint8(TideProgram.BUFFER_GUARD), 0x22);
        // The slots are unallocated placeholders in the official list
        assertEq(uint8(Opcode._92), 0x92);
        assertEq(uint8(Opcode._52), 0x52);
        assertEq(uint8(Opcode._22), 0x22);
    }

    // ---------------------------------------------------------------------------------------------
    // Story 1: ship without depositing; inventory pulled only at fill time
    // ---------------------------------------------------------------------------------------------

    function test_Ship_LeavesInventoryInWallet_UntilFill() public {
        (ISwapVM.Order memory order, bytes32 orderHash) = _ship();
        assertEq(tokenA.balanceOf(maker), BAL_A, "wallet A untouched by ship");
        assertEq(tokenB.balanceOf(maker), BAL_B, "wallet B untouched by ship");
        (uint256 a, uint256 b) = _aquaBalances(orderHash);
        assertEq(a, BAL_A);
        assertEq(b, BAL_B);

        vm.recordLogs();
        (uint256 amountIn, uint256 amountOut) = _swap(order, 1e18, true, true);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bool sawPulled;
        bool sawSwapped;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(aqua) && logs[i].topics[0] == IAqua.Pulled.selector) sawPulled = true;
            if (logs[i].emitter == address(router) && logs[i].topics[0] == SwapVM.Swapped.selector) sawSwapped = true;
        }
        assertTrue(sawPulled, "Aqua Pulled at fill time");
        assertTrue(sawSwapped, "router Swapped");

        assertEq(tokenA.balanceOf(maker), BAL_A + amountIn, "maker received tokenIn in wallet");
        assertEq(tokenB.balanceOf(maker), BAL_B - amountOut, "maker paid tokenOut from wallet");
        assertEq(tokenB.balanceOf(address(taker)), amountOut, "taker got tokenOut");
    }

    // ---------------------------------------------------------------------------------------------
    // Story 3: first fill of a block only sees the active slice
    // ---------------------------------------------------------------------------------------------

    function test_FirstFill_QuotesAgainstActiveSliceOnly() public {
        (ISwapVM.Order memory order,) = _ship();
        uint256 amountIn = 1e18;
        (, uint256 out) = _quote(order, amountIn, true, true);
        uint256 activeA = BAL_A * LAMBDA / BPS;
        uint256 activeB = BAL_B * LAMBDA / BPS;
        assertEq(out, _xyc(amountIn, activeA, activeB), "N=1 over active reserves");
        assertLt(out, _xyc(amountIn, BAL_A, BAL_B), "worse than full-pool XYC for the arb");
    }

    /// @dev Same stale price, arbitrageur trades to the true price. Profit at lambda = 0.5 is about half
    ///      the profit at lambda = 1 (Proposition 1, first order in the price gap).
    function test_Arbitrage_ExtractsLambdaFractionOfBaseline() public {
        uint256 profitFull = _arbProfit(10_000);
        uint256 profitHalf = _arbProfit(5000);
        // profit(0.5) / profit(1) in [0.48, 0.52]
        assertApproxEqRel(profitHalf * 1e18 / profitFull, 0.5e18, 0.04e18, "lambda scales arb profit");
    }

    /// @dev Arb: the true price of A rose 2% (one A is now worth 1.02x more B). The pool still sells A at
    ///      the stale price, so the arb sells B for A until the pool's marginal price matches, then values
    ///      the A at the true price. Optimal constant-product input: y*(sqrt(1.02) - 1).
    function _arbProfit(uint32 lambdaBps) internal returns (uint256 profitInB) {
        (ISwapVM.Order memory order,) = _ship(lambdaBps, 1, DELTA);
        uint256 activeB = BAL_B * lambdaBps / BPS;
        uint256 sqrtRatio = 1_009_950_493; // sqrt(1.02) * 1e9
        uint256 amountInB = activeB * (sqrtRatio - 1e9) / 1e9;
        (, uint256 amountOutA) = _swap(order, amountInB, true, false);
        uint256 truePriceBperA = BAL_B * 102 / 100 * 1e18 / BAL_A;
        uint256 valueInB = amountOutA * truePriceBperA / 1e18;
        profitInB = valueInB - amountInB;
        vm.roll(block.number + 1);
    }

    // ---------------------------------------------------------------------------------------------
    // Story 4: uninformed follow-on flow sees the N-scaled curve
    // ---------------------------------------------------------------------------------------------

    function test_SecondFillInBlock_QuotesOnVirtualCurve() public {
        (ISwapVM.Order memory order, bytes32 orderHash) = _ship();
        // First fill (informed) sets the block anchor
        _swap(order, 0.1e18, true, true);
        uint256 activeA = router.tideActive(orderHash, address(tokenA));
        uint256 activeB = router.tideActive(orderHash, address(tokenB));

        uint256 q = activeA / 400; // 0.25% of active: well inside delta on the N=4 curve
        (, uint256 out) = _quote(order, q, true, true);
        assertEq(out, TideMath.quoteExactIn(q, activeA, activeB, N), "N-scaled quote");

        // Slippage within 5% of q/(N x)
        uint256 spot = q * activeB / activeA;
        uint256 slipVirtual = spot - out;
        uint256 slipPlain = spot - _xyc(q, activeA, activeB);
        assertApproxEqRel(slipPlain * 1e18 / slipVirtual, uint256(N) * 1e18, 0.05e18, "slippage / N");
    }

    // ---------------------------------------------------------------------------------------------
    // Story 5: guard bounds the virtual curve and keeps the pool solvent
    // ---------------------------------------------------------------------------------------------

    function test_Guard_RepricesInformedSizedFollowOnTrade() public {
        (ISwapVM.Order memory order, bytes32 orderHash) = _ship();
        _swap(order, 0.1e18, true, true);
        uint256 activeA = router.tideActive(orderHash, address(tokenA));
        uint256 activeB = router.tideActive(orderHash, address(tokenB));

        uint256 q = activeA / 20; // 5% of active moves the N=4 virtual price ~1.2% > delta 0.5%
        (, uint256 out) = _quote(order, q, true, true);
        assertEq(out, TideMath.quoteExactIn(q, activeA, activeB, 1), "re-priced on active curve");
        assertLt(out, TideMath.quoteExactIn(q, activeA, activeB, N), "cheaper than the virtual quote");
    }

    function test_Guard_ExactOut_BeyondVirtualReserveReverts() public {
        (ISwapVM.Order memory order, bytes32 orderHash) = _ship(5000, 64, 4000);
        _swap(order, 0.1e18, true, true);
        uint256 activeB = router.tideActive(orderHash, address(tokenB));
        // Ask for more B than the maker holds in total: virtual curve would promise it, guard refuses.
        uint256 askOut = BAL_B + 1;
        assertLt(askOut, 64 * activeB, "virtual reserve would allow it");
        ISwapVM view_ = router.asView();
        bytes memory td = _takerData(false, true);
        vm.expectRevert();
        view_.quote(order, askOut, td);
    }

    function test_Guard_TopUp_ResplitsFromPassiveBuffer() public {
        // Wide delta and deep virtual curve so a within-delta trade exceeds the active slice.
        (ISwapVM.Order memory order, bytes32 orderHash) = _ship(2000, 64, 4500);
        _swap(order, 0.01e18, true, true);
        uint256 activeB = router.tideActive(orderHash, address(tokenB));
        uint256 q = 25e18; // on the N=64 curve this delivers more than the active slice, within delta
        (, uint256 out) = _quote(order, q, true, true);
        assertGt(out, activeB, "fill dips into the passive buffer");
        assertLe(out, BAL_B, "but never beyond total inventory");

        tokenA.mint(address(taker), q);
        bytes memory td = _takerData(true, true);
        vm.expectEmit(true, false, false, false, address(router));
        emit ActiveSplit.TideTopUp(orderHash, 0, 0);
        taker.swap(order, q, td);

        (uint256 a, uint256 b) = _aquaBalances(orderHash);
        assertEq(router.tideActive(orderHash, address(tokenA)), a * 2000 / BPS, "active re-split from new totals");
        assertEq(router.tideActive(orderHash, address(tokenB)), b * 2000 / BPS, "active re-split from new totals");
    }

    // ---------------------------------------------------------------------------------------------
    // Lazy re-split and two swaps in one block
    // ---------------------------------------------------------------------------------------------

    function test_TwoSwapsInOneBlock_ThenLazyResplitNextBlock() public {
        (ISwapVM.Order memory order, bytes32 orderHash) = _ship();
        assertEq(router.tideBlockNumber(orderHash), 0, "no state before first fill");

        (uint256 in1, uint256 out1) = _swap(order, 1e18, true, true);
        assertEq(router.tideBlockNumber(orderHash), block.number);
        assertEq(router.tideActive(orderHash, address(tokenA)), BAL_A * LAMBDA / BPS + in1);
        assertEq(router.tideActive(orderHash, address(tokenB)), BAL_B * LAMBDA / BPS - out1);
        assertEq(router.tideAnchor(orderHash, address(tokenA)), BAL_A * LAMBDA / BPS + in1, "anchor = post first fill");

        (uint256 in2, uint256 out2) = _swap(order, 0.05e18, true, true);
        assertEq(router.tideActive(orderHash, address(tokenA)), BAL_A * LAMBDA / BPS + in1 + in2);
        assertEq(router.tideActive(orderHash, address(tokenB)), BAL_B * LAMBDA / BPS - out1 - out2);
        assertEq(router.tideAnchor(orderHash, address(tokenA)), BAL_A * LAMBDA / BPS + in1, "anchor unchanged");

        vm.roll(block.number + 1);
        (uint256 a, uint256 b) = _aquaBalances(orderHash);
        (, uint256 out3) = _quote(order, 1e18, true, true);
        assertEq(out3, _xyc(1e18, a * LAMBDA / BPS, b * LAMBDA / BPS), "fresh split from Aqua balances");
        _swap(order, 1e18, true, true);
        assertEq(router.tideBlockNumber(orderHash), block.number);
    }

    function test_QuoteEqualsSwap_BothDirections_BothModes() public {
        (ISwapVM.Order memory order,) = _ship();
        _swap(order, 0.1e18, true, true);
        uint256[4] memory amounts = [uint256(0.02e18), 30e18, 0.03e18, 45e18];
        bool[4] memory exactIn = [true, true, false, false];
        bool[4] memory aToB = [true, false, true, false];
        for (uint256 i; i < 4; i++) {
            (uint256 qIn, uint256 qOut) = _quote(order, amounts[i], exactIn[i], aToB[i]);
            (uint256 sIn, uint256 sOut) = _swap(order, amounts[i], exactIn[i], aToB[i]);
            assertEq(qIn, sIn, "amountIn quote == swap");
            assertEq(qOut, sOut, "amountOut quote == swap");
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Program order is security-critical
    // ---------------------------------------------------------------------------------------------

    function test_ReorderedProgram_Reverts() public {
        address p = address(params);
        bytes memory reordered = bytes.concat(
            _build(TideProgram.VIRTUAL_XYC, p), _build(TideProgram.ACTIVE_SPLIT, p), _build(TideProgram.BUFFER_GUARD, p)
        );
        _expectProgramRevert(reordered);
    }

    function test_MissingGuard_Reverts() public {
        address p = address(params);
        bytes memory missing = bytes.concat(_build(TideProgram.ACTIVE_SPLIT, p), _build(TideProgram.VIRTUAL_XYC, p));
        _expectProgramRevert(missing);
    }

    function test_DuplicateOpcode_Reverts() public {
        address p = address(params);
        bytes memory dup = bytes.concat(
            _build(TideProgram.ACTIVE_SPLIT, p),
            _build(TideProgram.VIRTUAL_XYC, p),
            _build(TideProgram.VIRTUAL_XYC, p),
            _build(TideProgram.BUFFER_GUARD, p)
        );
        _expectProgramRevert(dup);
    }

    function _build(Opcode op, address p) internal pure returns (bytes memory) {
        return abi.encodePacked(uint8(op), uint8(20), p);
    }

    function _expectProgramRevert(bytes memory program) internal {
        ISwapVM.Order memory order = _orderWithProgram(program);
        bytes32 orderHash = router.hash(order);
        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = BAL_A;
        amounts[1] = BAL_B;
        vm.startPrank(maker);
        params.init(orderHash, LAMBDA, N, DELTA, manager);
        aqua.ship(address(router), abi.encode(order), tokens, amounts);
        vm.stopPrank();
        ISwapVM view_ = router.asView();
        bytes memory td = _takerData(true, true);
        vm.expectRevert();
        view_.quote(order, 1e18, td);
    }

    function _orderWithProgram(bytes memory program) internal view returns (ISwapVM.Order memory) {
        return _buildOrder(program);
    }

    // ---------------------------------------------------------------------------------------------
    // Governance: only lambda / N / delta, only owner or manager, effective next block
    // ---------------------------------------------------------------------------------------------

    function test_Params_ManagerCanSet_StrangerCannot() public {
        (, bytes32 orderHash) = _ship();
        vm.prank(manager);
        params.set(orderHash, 3500, 4, 50);
        (uint32 l,,) = params.get(orderHash);
        assertEq(l, 3500);

        vm.prank(vm.addr(0x9999));
        vm.expectRevert(abi.encodeWithSelector(TideParams.NotAuthorized.selector, orderHash, vm.addr(0x9999)));
        params.set(orderHash, 1000, 4, 50);
    }

    function test_Params_RevokeManager_BlocksFutureWrites() public {
        (, bytes32 orderHash) = _ship();
        vm.prank(maker);
        params.setManager(orderHash, address(0));
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(TideParams.NotAuthorized.selector, orderHash, manager));
        params.set(orderHash, 3500, 4, 50);
    }

    function test_Params_ManagerCannotChangeOwnerOrManager() public {
        (, bytes32 orderHash) = _ship();
        vm.prank(manager);
        vm.expectRevert(abi.encodeWithSelector(TideParams.NotOwner.selector, orderHash, manager));
        params.setManager(orderHash, manager);
    }

    function test_Params_NewLambda_AppliesAtNextResplit() public {
        (ISwapVM.Order memory order, bytes32 orderHash) = _ship();
        _swap(order, 0.1e18, true, true);
        vm.prank(manager);
        params.set(orderHash, 2500, N, DELTA);
        vm.roll(block.number + 1);
        (uint256 a, uint256 b) = _aquaBalances(orderHash);
        (, uint256 out) = _quote(order, 1e18, true, true);
        assertEq(out, _xyc(1e18, a * 2500 / BPS, b * 2500 / BPS), "lambda = 0.25 at next block");
    }
}

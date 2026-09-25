// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { stdJson } from "forge-std/StdJson.sol";

import { TideMath } from "../src/lib/TideMath.sol";

/// @dev Checks TideMath against the vectors emitted by `research/tide_math.py`.
contract TideMathTest is Test {
    using stdJson for string;

    struct Vector {
        uint256 activeIn;
        uint256 activeOut;
        uint256 amountIn;
        uint256 amountOut;
        uint256 balIn;
        uint256 balOut;
        uint256 deltaBps;
        bool driftExceeds;
        bool driftExceedsRef;
        uint256 exactInOut;
        uint256 exactOutIn;
        uint256 lambdaBps;
        uint256 maxOutWithinDrift;
        uint256 n;
        string name;
    }

    string internal json;
    uint256 internal count;

    function setUp() public {
        json = vm.readFile("../research/vectors.json");
        count = json.readUint(".count");
        assertGt(count, 0, "no vectors");
    }

    function _vector(uint256 i) internal view returns (Vector memory v) {
        string memory p = string.concat(".vectors[", vm.toString(i), "]");
        v.name = json.readString(string.concat(p, ".name"));
        v.amountIn = vm.parseUint(json.readString(string.concat(p, ".amount_in")));
        v.amountOut = vm.parseUint(json.readString(string.concat(p, ".amount_out")));
        v.balIn = vm.parseUint(json.readString(string.concat(p, ".bal_in")));
        v.balOut = vm.parseUint(json.readString(string.concat(p, ".bal_out")));
        v.n = vm.parseUint(json.readString(string.concat(p, ".n")));
        v.lambdaBps = vm.parseUint(json.readString(string.concat(p, ".lambda_bps")));
        v.deltaBps = vm.parseUint(json.readString(string.concat(p, ".delta_bps")));
        v.exactInOut = vm.parseUint(json.readString(string.concat(p, ".exact_in_out")));
        v.exactOutIn = vm.parseUint(json.readString(string.concat(p, ".exact_out_in")));
        v.activeIn = vm.parseUint(json.readString(string.concat(p, ".active_in")));
        v.activeOut = vm.parseUint(json.readString(string.concat(p, ".active_out")));
        v.driftExceeds = json.readBool(string.concat(p, ".drift_exceeds"));
        v.driftExceedsRef = json.readBool(string.concat(p, ".drift_exceeds_ref"));
        v.maxOutWithinDrift = vm.parseUint(json.readString(string.concat(p, ".max_out_within_drift")));
    }

    function test_ActiveReserve_MatchesReference() public view {
        for (uint256 i; i < count; i++) {
            Vector memory v = _vector(i);
            assertEq(TideMath.activeReserve(v.balIn, v.lambdaBps), v.activeIn, v.name);
            assertEq(TideMath.activeReserve(v.balOut, v.lambdaBps), v.activeOut, v.name);
        }
    }

    function test_QuoteExactIn_MatchesReference() public view {
        for (uint256 i; i < count; i++) {
            Vector memory v = _vector(i);
            assertEq(TideMath.quoteExactIn(v.amountIn, v.activeIn, v.activeOut, v.n), v.exactInOut, v.name);
        }
    }

    function test_QuoteExactOut_MatchesReference() public view {
        for (uint256 i; i < count; i++) {
            Vector memory v = _vector(i);
            if (v.exactInOut == 0) continue;
            uint256 amountIn = TideMath.quoteExactOut(v.exactInOut, v.activeIn, v.activeOut, v.n);
            assertEq(amountIn, v.exactOutIn, v.name);
            // Round trip never favours the taker
            assertLe(amountIn, v.amountIn + 1, v.name);
        }
    }

    function test_DriftExceeds_MatchesReference() public view {
        for (uint256 i; i < count; i++) {
            Vector memory v = _vector(i);
            bool exceeds = TideMath.driftExceeds(v.activeIn, v.activeOut, v.amountIn, v.exactInOut, v.n, v.deltaBps);
            assertEq(exceeds, v.driftExceeds, v.name);
        }
    }

    function test_DriftExceedsRef_MatchesReference() public view {
        for (uint256 i; i < count; i++) {
            Vector memory v = _vector(i);
            bool exceeds = TideMath.driftExceedsRef(
                v.activeIn + v.amountIn / 16,
                v.activeOut - v.exactInOut / 16,
                v.activeIn,
                v.activeOut,
                v.amountIn,
                v.exactInOut,
                v.n,
                v.deltaBps
            );
            assertEq(exceeds, v.driftExceedsRef, v.name);
        }
    }

    function test_DriftExceedsRef_EqualsOneSidedWhenRefIsCurrent() public pure {
        uint256 balIn = 100e18;
        uint256 balOut = 300_000e6;
        for (uint256 k = 1; k <= 20; k++) {
            uint256 amountIn = k * 1e17;
            uint256 out = TideMath.quoteExactIn(amountIn, balIn, balOut, 4);
            assertEq(
                TideMath.driftExceedsRef(balIn, balOut, balIn, balOut, amountIn, out, 4, 50),
                TideMath.driftExceeds(balIn, balOut, amountIn, out, 4, 50)
            );
        }
    }

    function test_MaxOutWithinDrift_MatchesReference() public view {
        for (uint256 i; i < count; i++) {
            Vector memory v = _vector(i);
            uint256 got = TideMath.maxOutWithinDrift(v.activeOut, v.n, v.deltaBps);
            // Python uses float sqrt; allow 1e-9 relative slack
            assertApproxEqRel(got, v.maxOutWithinDrift, 1e9, v.name);
        }
    }

    /// @dev The solvency bound is consistent with driftExceeds: a trade delivering exactly the bound
    ///      does not exceed delta, one delivering slightly more does.
    function test_MaxOutWithinDrift_IsTheDriftBoundary() public pure {
        uint256 balIn = 100e18;
        uint256 balOut = 300_000e6;
        uint256 n = 4;
        uint256 delta = 50;
        uint256 bound = TideMath.maxOutWithinDrift(balOut, n, delta);
        uint256 amountIn = TideMath.quoteExactOut(bound, balIn, balOut, n);
        assertFalse(TideMath.driftExceeds(balIn, balOut, amountIn, bound, n, delta), "at bound");
        uint256 more = bound * 1001 / 1000;
        uint256 amountInMore = TideMath.quoteExactOut(more, balIn, balOut, n);
        assertTrue(TideMath.driftExceeds(balIn, balOut, amountInMore, more, n, delta), "past bound");
    }

    /// @dev Retail slippage improves by ~N for a trade of 1% of active reserves (whitepaper table 2).
    function test_VirtualDepth_ReducesSlippageByN() public pure {
        uint256 balIn = 100e18;
        uint256 balOut = 300_000e6;
        uint256 amountIn = 1e18; // 1% of active
        uint256 outN1 = TideMath.quoteExactIn(amountIn, balIn, balOut, 1);
        uint256 outN4 = TideMath.quoteExactIn(amountIn, balIn, balOut, 4);
        uint256 spot = amountIn * balOut / balIn; // no-slippage output
        uint256 slipN1 = spot - outN1;
        uint256 slipN4 = spot - outN4;
        // slippage ratio within 5% of N
        assertApproxEqRel(slipN1 * 1e18 / slipN4, 4e18, 0.05e18);
    }

    function test_CheckParams_RejectsOutOfRange() public {
        vm.expectRevert(abi.encodeWithSelector(TideMath.TideInvalidParameter.selector, "lambda", 0));
        this.checkParams(0, 4, 50);
        vm.expectRevert(abi.encodeWithSelector(TideMath.TideInvalidParameter.selector, "lambda", 10_001));
        this.checkParams(10_001, 4, 50);
        vm.expectRevert(abi.encodeWithSelector(TideMath.TideInvalidParameter.selector, "n", 0));
        this.checkParams(5000, 0, 50);
        vm.expectRevert(abi.encodeWithSelector(TideMath.TideInvalidParameter.selector, "delta", 5000));
        this.checkParams(5000, 4, 5000);
        this.checkParams(5000, 4, 50);
    }

    function checkParams(uint256 l, uint256 n, uint256 d) external pure {
        TideMath.checkParams(l, n, d);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title TideMath
/// @notice Shared quoting math for the Tide partially-active AMM with a collateral buffer.
///         Both the 1inch Aqua SwapVM opcodes and the Uniswap v4 hook import this library so the two
///         venues price identically. The reference implementation and test vectors live in
///         `research/tide_math.py`.
///
/// Parameters
/// - `lambdaBps`: fraction of the maker's reserves exposed per block (PA-AMM, arXiv 2602.09887).
/// - `n`:         virtual depth multiplier; uninformed flow is quoted on x*y = N^2 k (HLCP, arXiv 2605.19267).
/// - `deltaBps`:  price-drift threshold; a trade that moves the virtual price by more than delta is
///                treated as informed and re-quoted on the active (N = 1) curve.
library TideMath {
    using Math for uint256;

    uint256 internal constant BPS = 10_000;

    /// @dev Thrown when a virtual-curve quote would exceed the virtual reserve.
    error TideExceedsVirtualReserve(uint256 amountOut, uint256 virtualOut);
    /// @dev Thrown when a parameter is outside its admissible range.
    error TideInvalidParameter(string name, uint256 value);

    /// @notice Active slice of a reserve: floor(total * lambda / 1e4).
    function activeReserve(uint256 total, uint256 lambdaBps) internal pure returns (uint256) {
        return total * lambdaBps / BPS;
    }

    /// @notice Output of an exact-in trade on the virtual curve (N*balIn)(N*balOut) = k.
    /// @dev Floor division favours the maker. With `n == 1` this is the XYCSwap formula.
    function quoteExactIn(uint256 amountIn, uint256 balIn, uint256 balOut, uint256 n)
        internal
        pure
        returns (uint256 amountOut)
    {
        amountOut = amountIn * n * balOut / (n * balIn + amountIn);
    }

    /// @notice Input of an exact-out trade on the virtual curve. Ceil division favours the maker.
    function quoteExactOut(uint256 amountOut, uint256 balIn, uint256 balOut, uint256 n)
        internal
        pure
        returns (uint256 amountIn)
    {
        uint256 virtualOut = n * balOut;
        require(amountOut < virtualOut, TideExceedsVirtualReserve(amountOut, virtualOut));
        amountIn = (amountOut * n * balIn).ceilDiv(virtualOut - amountOut);
    }

    /// @notice Whether a trade moves the virtual marginal price by more than `deltaBps`.
    /// @dev Price is tokenOut per tokenIn. It only ever falls in the trade direction, so the test is
    ///      p_after < p_before * (1 - delta), cross-multiplied to stay in integers:
    ///      (n*balOut - amountOut) * balIn * BPS  <  balOut * (n*balIn + amountIn) * (BPS - delta)
    function driftExceeds(
        uint256 balIn,
        uint256 balOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 n,
        uint256 deltaBps
    ) internal pure returns (bool) {
        uint256 lhs = (n * balOut - amountOut) * balIn * BPS;
        uint256 rhs = balOut * (n * balIn + amountIn) * (BPS - deltaBps);
        return lhs < rhs;
    }

    /// @notice Two-sided drift check against the block's reference price `refOut/refIn`.
    /// @dev p_after = (n*balOut - amountOut)/(n*balIn + amountIn). Exceeds when p_after leaves
    ///      [p_ref*(1-delta), p_ref*(1+delta)]. Cross-multiplied:
    ///      num = (n*balOut - amountOut)*refIn*BPS, den = refOut*(n*balIn + amountIn),
    ///      exceeds <=> num < den*(BPS-delta) || num > den*(BPS+delta).
    function driftExceedsRef(
        uint256 refIn,
        uint256 refOut,
        uint256 balIn,
        uint256 balOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 n,
        uint256 deltaBps
    ) internal pure returns (bool) {
        uint256 num = (n * balOut - amountOut) * refIn * BPS;
        uint256 den = refOut * (n * balIn + amountIn);
        return num < den * (BPS - deltaBps) || num > den * (BPS + deltaBps);
    }

    /// @notice Largest exact-in output that keeps the virtual price within `deltaBps` of the start.
    /// @dev Closed form out = n*balOut*(1 - sqrt(1 - d)). This is the amount the active slice plus the
    ///      buffer must be able to deliver before a re-split: the solvency invariant of the whitepaper.
    function maxOutWithinDrift(uint256 balOut, uint256 n, uint256 deltaBps) internal pure returns (uint256) {
        // sqrt(1 - d) scaled to 1e18: sqrt((BPS - delta) * 1e36 / BPS)
        uint256 sqrtScaled = Math.sqrt((BPS - deltaBps) * 1e36 / BPS);
        return n * balOut * (1e18 - sqrtScaled) / 1e18;
    }

    /// @notice Validate governance parameters. lambda in (0, 1e4], n in [1, 64], delta in [0, 5e3).
    function checkParams(uint256 lambdaBps, uint256 n, uint256 deltaBps) internal pure {
        require(lambdaBps > 0 && lambdaBps <= BPS, TideInvalidParameter("lambda", lambdaBps));
        require(n >= 1 && n <= 64, TideInvalidParameter("n", n));
        require(deltaBps < BPS / 2, TideInvalidParameter("delta", deltaBps));
    }
}

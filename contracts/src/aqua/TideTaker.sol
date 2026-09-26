// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/interfaces/ISwapVM.sol";
import { SwapVM } from "@1inch/swap-vm/SwapVM.sol";
import { ITakerCallbacks } from "@1inch/swap-vm/interfaces/ITakerCallbacks.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/libs/TakerTraits.sol";

import { TideApp } from "./TideApp.sol";

/// @title TideTaker
/// @notice Lets a wallet quote and fill a Tide strategy in one call: the taker pulls the input from the
///         caller, pushes it into the maker's Aqua balance in the pre-transfer callback, and Aqua sends the
///         output straight to the caller. Builds the taker traits on-chain so the frontend never encodes them.
contract TideTaker is ITakerCallbacks {
    using SafeERC20 for IERC20;

    error SlippageExceeded(uint256 got, uint256 limit);

    IAqua public immutable AQUA;
    address public immutable ROUTER;
    TideApp public immutable APP;

    constructor(IAqua aqua, address router, TideApp app) {
        AQUA = aqua;
        ROUTER = router;
        APP = app;
    }

    /// @notice Quote a fill of `cfg`'s strategy. Exact-in returns the output, exact-out the gross input.
    function quote(TideApp.Config calldata cfg, uint256 amount, bool exactIn, bool aToB)
        external
        view
        returns (uint256 amountIn, uint256 amountOut)
    {
        (amountIn, amountOut,) =
            SwapVM(payable(ROUTER)).asView().quote(APP.order(cfg), amount, _traits(exactIn, aToB, msg.sender));
    }

    /// @notice Fill. Caller must have approved this contract for the input token. `limit` is the minimum
    ///         output (exact-in) or the maximum input (exact-out).
    function swap(TideApp.Config calldata cfg, uint256 amount, bool exactIn, bool aToB, uint256 limit)
        external
        returns (uint256 amountIn, uint256 amountOut)
    {
        ISwapVM.Order memory order = APP.order(cfg);
        address tokenIn = aToB ? cfg.tokenA : cfg.tokenB;
        // pull the worst case now, refund the difference after the fill
        uint256 pulled = exactIn ? amount : limit;
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), pulled);
        (amountIn, amountOut,) = ISwapVM(ROUTER).swap(order, amount, _traits(exactIn, aToB, msg.sender));
        if (exactIn && amountOut < limit) revert SlippageExceeded(amountOut, limit);
        if (!exactIn && amountIn > limit) revert SlippageExceeded(amountIn, limit);
        if (pulled > amountIn) IERC20(tokenIn).safeTransfer(msg.sender, pulled - amountIn);
    }

    function preTransferInCallback(
        address maker,
        address,
        address tokenIn,
        address,
        uint256 amountIn,
        uint256,
        bytes32 orderHash,
        bytes calldata
    ) external {
        require(msg.sender == ROUTER, "router only");
        IERC20(tokenIn).forceApprove(address(AQUA), amountIn);
        AQUA.push(maker, ROUTER, orderHash, tokenIn, amountIn);
    }

    function preTransferOutCallback(address, address, address, address, uint256, uint256, bytes32, bytes calldata)
        external
    { }

    function _traits(bool exactIn, bool aToB, address to) internal view returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: address(this),
                isExactIn: exactIn,
                shouldUnwrapWeth: false,
                hasPreTransferInCallback: true,
                hasPreTransferOutCallback: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: false,
                isAToB: aToB,
                allowPartialFill: false,
                usePermit2: false,
                threshold: "",
                to: to,
                deadline: 0,
                preTransferInHookData: "",
                postTransferInHookData: "",
                preTransferOutHookData: "",
                postTransferOutHookData: "",
                preTransferInCallbackData: "",
                preTransferOutCallbackData: "",
                instructionsArgs: "",
                signature: ""
            })
        );
    }
}

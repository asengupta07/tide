// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { ISwapVM } from "@1inch/swap-vm/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/libs/MakerTraits.sol";
import { Salt } from "@1inch/swap-vm/instructions/Controls.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { ActiveSplit } from "./instructions/ActiveSplit.sol";
import { VirtualXYCSwap } from "./instructions/VirtualXYCSwap.sol";
import { BufferGuard } from "./instructions/BufferGuard.sol";
import { TideParams } from "../TideParams.sol";

/// @title TideApp
/// @notice Builds Tide SwapVM programs and orders, so a maker ships a strategy in two calls:
///         `TideParams.init(orderHash, ...)` then `Aqua.ship(router, abi.encode(order), ...)`. The flat fee
///         is not an instruction argument: `ACTIVE_SPLIT` reads it from `TideParams`, so the fee a fill pays
///         is the one the parameter box was checked against.
///
///         Aqua records `msg.sender` as the maker, so `ship()` itself must be sent from the maker's wallet;
///         inventory never leaves that wallet. This contract holds no funds and no state.
contract TideApp {
    struct Config {
        address maker;
        address tokenA; // lower address
        address tokenB; // higher address
        uint64 salt;
    }

    IAqua public immutable AQUA;
    address public immutable ROUTER;
    TideParams public immutable PARAMS;

    event TidePrepared(bytes32 indexed orderHash, address indexed maker, uint32 lambdaBps, uint32 n, uint32 deltaBps);

    constructor(IAqua aqua, address router, TideParams params) {
        AQUA = aqua;
        ROUTER = router;
        PARAMS = params;
    }

    /// @notice Canonical Tide program: ACTIVE_SPLIT VIRTUAL_XYC BUFFER_GUARD Salt.
    function program(uint64 salt) public view returns (bytes memory) {
        address p = address(PARAMS);
        return bytes.concat(ActiveSplit.build(p), VirtualXYCSwap.build(p), BufferGuard.build(p), Salt.build(salt));
    }

    /// @notice The Aqua-mode order for a config. Its hash is the strategy hash Aqua uses.
    function order(Config memory cfg) public view returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: cfg.maker,
                receiver: address(0),
                tokenA: cfg.tokenA,
                tokenB: cfg.tokenB,
                shouldUnwrapWeth: false,
                useAquaInsteadOfSignature: true,
                allowZeroAmountIn: false,
                usePermit2: false,
                hasPreTransferInHook: false,
                hasPostTransferInHook: false,
                hasPreTransferOutHook: false,
                hasPostTransferOutHook: false,
                preTransferInTarget: address(0),
                preTransferInData: "",
                postTransferInTarget: address(0),
                postTransferInData: "",
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: program(cfg.salt)
            })
        );
    }

    /// @notice Strategy hash = keccak256(abi.encode(order)) for Aqua-mode orders.
    function orderHash(Config memory cfg) public view returns (bytes32) {
        return keccak256(abi.encode(order(cfg)));
    }

    /// @notice Calldata the maker sends to `Aqua.ship`. Returned so a frontend or script can submit it.
    function shipCalldata(Config memory cfg, uint256 amountA, uint256 amountB) external view returns (bytes memory) {
        address[] memory tokens = new address[](2);
        tokens[0] = cfg.tokenA;
        tokens[1] = cfg.tokenB;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amountA;
        amounts[1] = amountB;
        return abi.encodeCall(IAqua.ship, (ROUTER, abi.encode(order(cfg)), tokens, amounts));
    }
}

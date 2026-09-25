// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Context } from "@1inch/swap-vm/libs/VM.sol";
import { SwapVM } from "@1inch/swap-vm/SwapVM.sol";

import { TideOpcodes } from "./TideOpcodes.sol";
import { TideStorageExternal } from "./TideStorage.sol";

/// @title TideRouter
/// @notice A redeployment of the official `AquaSwapVMRouter` (swap-vm `main`) whose only change is the
///         opcode set: `TideOpcodes` instead of `AquaOpcodes`. Settlement, Aqua accounting, hooks and
///         taker traits are the unmodified 1inch code. Makers ship Tide programs to this router through
///         the official Aqua registry.
///
///         The `Simulator` mixin of the upstream router is omitted to stay under the EIP-170 size limit; it is
///         a debugging helper and takes no part in quoting or settlement.
///
///         The hackathon template router on `main` is used rather than the live v1.0.x router because
///         the live deployment predates the template's opcode layout and `swap()` ABI.
contract TideRouter is SwapVM, TideOpcodes, TideStorageExternal {
    constructor(address aqua, address weth, address owner) SwapVM(aqua, weth, owner, "TideRouter", "1.0.0") { }

    function _dispatch(Context memory ctx, uint256 opcode, bytes calldata args) internal override {
        _runOpcode(ctx, opcode, args);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Context } from "@1inch/swap-vm/libs/VM.sol";
import { AquaOpcodes } from "@1inch/swap-vm/opcodes/AquaOpcodes.sol";

import { ActiveSplit } from "./instructions/ActiveSplit.sol";
import { VirtualXYCSwap } from "./instructions/VirtualXYCSwap.sol";
import { BufferGuard } from "./instructions/BufferGuard.sol";

/// @title TideOpcodes
/// @notice The official 1inch `AquaOpcodes` set extended with the three Tide instructions. No 1inch
///         opcode is overwritten: Tide claims the reserved third-party slots 0x92, 0x52 and 0x22 in the
///         balances, curves and guards banks of `OpcodeList.sol`.
contract TideOpcodes is AquaOpcodes {
    function _runOpcode(Context memory ctx, uint256 opcode, bytes calldata args) internal virtual override {
        if (opcode == ActiveSplit.opcode.asU8()) ActiveSplit.exec(ctx, args);
        else if (opcode == VirtualXYCSwap.opcode.asU8()) VirtualXYCSwap.exec(ctx, args);
        else if (opcode == BufferGuard.opcode.asU8()) BufferGuard.exec(ctx, args);
        else super._runOpcode(ctx, opcode, args);
    }
}

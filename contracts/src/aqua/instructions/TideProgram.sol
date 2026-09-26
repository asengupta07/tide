// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Context } from "@1inch/swap-vm/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/libs/OpcodeList.sol";

/// @title TideProgram
/// @notice Claims three reserved third-party opcode slots from `OpcodeList.sol`, one per family bank,
///         and enforces the security-critical instruction order of a Tide program:
///
///             [prefix...] ACTIVE_SPLIT  VIRTUAL_XYC  BUFFER_GUARD  [suffix...]
///
///         * ACTIVE_SPLIT (0x92, balances bank) must run first: it replaces the Aqua balances in the
///           registers with the block's active slice and wraps the rest of the program.
///         * VIRTUAL_XYC (0x52, curves bank) prices the trade on the N-scaled curve.
///         * BUFFER_GUARD (0x22, guards bank) re-prices informed-sized trades and checks solvency.
///
///         Every Tide opcode calls {check} so a program that omits or reorders any of them reverts,
///         which is the "reordered program reverts" guarantee the tests cover.
library TideProgram {
    error TideProgramOrder(uint256 activeSplitAt, uint256 virtualXycAt, uint256 bufferGuardAt);
    error TideProgramDuplicate(uint8 opcode);
    error TideProgramForeignOpcode(uint8 opcode);

    Opcode internal constant ACTIVE_SPLIT = Opcode._92;
    Opcode internal constant VIRTUAL_XYC = Opcode._52;
    Opcode internal constant BUFFER_GUARD = Opcode._22;

    uint256 private constant NOT_FOUND = type(uint256).max;

    /// @dev Parse the whole program once and verify the three Tide opcodes are each present once and
    ///      in canonical order, and that nothing else but `Salt` is in the program. The scan is static, so a
    ///      control-flow opcode such as `Jump` could otherwise route around `BUFFER_GUARD`; refusing every
    ///      foreign opcode makes the static order the runtime order. Pure calldata scan; no state.
    function check(Context memory ctx) internal pure {
        bytes calldata program = ctx.program();
        uint256 splitAt = NOT_FOUND;
        uint256 virtualAt = NOT_FOUND;
        uint256 guardAt = NOT_FOUND;

        uint256 pc;
        uint256 length = program.length;
        while (pc < length) {
            uint8 opcode = uint8(program[pc]);
            uint8 argsLength = uint8(program[pc + 1]);
            if (opcode == uint8(ACTIVE_SPLIT)) {
                if (splitAt != NOT_FOUND) revert TideProgramDuplicate(opcode);
                splitAt = pc;
            } else if (opcode == uint8(VIRTUAL_XYC)) {
                if (virtualAt != NOT_FOUND) revert TideProgramDuplicate(opcode);
                virtualAt = pc;
            } else if (opcode == uint8(BUFFER_GUARD)) {
                if (guardAt != NOT_FOUND) revert TideProgramDuplicate(opcode);
                guardAt = pc;
            } else if (opcode != uint8(Opcode.Salt)) {
                revert TideProgramForeignOpcode(opcode);
            }
            pc += 2 + argsLength;
        }

        if (
            splitAt == NOT_FOUND || virtualAt == NOT_FOUND || guardAt == NOT_FOUND || splitAt > virtualAt
                || virtualAt > guardAt
        ) {
            revert TideProgramOrder(splitAt, virtualAt, guardAt);
        }
    }
}

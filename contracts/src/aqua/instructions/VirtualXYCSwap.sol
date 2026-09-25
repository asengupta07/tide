// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Context } from "@1inch/swap-vm/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/libs/InstructionBuilder.sol";
import { InstructionArgs } from "@1inch/swap-vm/libs/InstructionArgs.sol";

import { TideMath } from "../../lib/TideMath.sol";
import { TideParams } from "../../TideParams.sol";
import { TideStorage } from "../TideStorage.sol";
import { TideProgram } from "./TideProgram.sol";

/// @notice VIRTUAL_XYC opcode (slot 0x52, curves bank). N-scaled constant product, arXiv 2605.19267.
///
///   The first fill of a block is the informed one in the PA-AMM model, so it is priced on the plain
///   active curve (N = 1) and can only ever reach the active slice. Every later fill in the block is
///   priced on the virtual curve (N*x)(N*y) = k over the current active reserves, so uninformed flow
///   sees slippage of roughly q/(N x) instead of q/x. BUFFER_GUARD then bounds how far the virtual
///   curve may be pushed.
///
/// @dev Encoding: [address params]
library VirtualXYCSwap {
    using InstructionArgs for bytes;
    using InstructionBuilder for MemoryPtr;

    Opcode constant opcode = TideProgram.VIRTUAL_XYC;

    function sizeOf(address) internal pure returns (uint256) {
        return InstructionBuilder.sizeOf() + 20;
    }

    function build(address params) internal pure returns (bytes memory) {
        return build(MemoryPtrLib.alloc(sizeOf(params)), params).resolve();
    }

    function build(MemoryPtr ptrStart, address params) internal pure returns (MemoryPtr ptr) {
        ptr = ptrStart.pushHeader(opcode);
        ptr = ptr.push(params);
        ptrStart.patchLength(ptr);
    }

    function parse(bytes calldata args) internal pure returns (address params) {
        params = args.at(0).asAddress();
    }

    function exec(Context memory ctx, bytes calldata args) internal view {
        TideProgram.check(ctx);
        (, uint32 n,) = TideParams(parse(args)).get(ctx.query.orderHash);
        if (TideStorage.isFirstOfBlock(ctx.query.orderHash)) n = 1;

        if (ctx.query.isExactIn) {
            ctx.swap.amountOut = TideMath.quoteExactIn(ctx.swap.amountIn, ctx.swap.balanceIn, ctx.swap.balanceOut, n);
        } else {
            ctx.swap.amountIn = TideMath.quoteExactOut(ctx.swap.amountOut, ctx.swap.balanceIn, ctx.swap.balanceOut, n);
        }
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import { Context } from "@1inch/swap-vm/libs/VM.sol";
import { Opcode } from "@1inch/swap-vm/libs/OpcodeList.sol";
import { MemoryPtr, MemoryPtrLib } from "@1inch/swap-vm/libs/MemoryPtr.sol";
import { InstructionBuilder } from "@1inch/swap-vm/libs/InstructionBuilder.sol";
import { InstructionArgs } from "@1inch/swap-vm/libs/InstructionArgs.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { TideMath } from "../../lib/TideMath.sol";
import { TideParams } from "../../TideParams.sol";
import { TideStorage } from "../TideStorage.sol";
import { TideProgram } from "./TideProgram.sol";

/// @notice BUFFER_GUARD opcode (slot 0x22, guards bank). Drift bound and solvency invariant.
///
///   Runs after VIRTUAL_XYC on every fill that is not the block's first:
///   1. If the fill would move the virtual price more than `delta` away from the block's anchor
///      price (the price right after the first fill), it is informed-sized: re-price it on the plain
///      active curve (N = 1). The deep curve can therefore be walked at most `delta` per block, which
///      bounds what an informed follower can extract to N*active*(1 - sqrt(1 - delta)).
///   2. Solvency: the fill must be deliverable from active + passive reserves. Passive is read live from
///      Aqua (maker balance minus the active slice). If the fill dips into passive, ACTIVE_SPLIT re-splits
///      afterwards (buffer top-up).
///
/// @dev Encoding: [address params]
library BufferGuard {
    using InstructionArgs for bytes;
    using InstructionBuilder for MemoryPtr;

    error TideInsufficientLiquidity(uint256 amountOut, uint256 active, uint256 passive);

    Opcode constant opcode = TideProgram.BUFFER_GUARD;

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
        TideParams params = TideParams(parse(args));
        (, uint32 n, uint32 deltaBps,) = params.get(ctx.query.orderHash);

        TideStorage.BlockState storage state = TideStorage.store().state[ctx.query.orderHash];
        bool first = state.blockNumber != block.number;

        if (!first) {
            bool exceeds = TideMath.driftExceedsRef(
                state.anchor[ctx.query.tokenIn],
                state.anchor[ctx.query.tokenOut],
                ctx.swap.balanceIn,
                ctx.swap.balanceOut,
                ctx.swap.amountIn,
                ctx.swap.amountOut,
                n,
                deltaBps
            );
            if (exceeds) {
                if (ctx.query.isExactIn) {
                    ctx.swap.amountOut =
                        TideMath.quoteExactIn(ctx.swap.amountIn, ctx.swap.balanceIn, ctx.swap.balanceOut, 1);
                } else {
                    ctx.swap.amountIn =
                        TideMath.quoteExactOut(ctx.swap.amountOut, ctx.swap.balanceIn, ctx.swap.balanceOut, 1);
                }
            }
        }

        // Solvency: active + passive must cover the delivery. `address(this)` is the router, which is the
        // Aqua app the maker shipped to.
        uint256 activeOut = ctx.swap.balanceOut;
        (, uint256 totalOut) = params.AQUA().safeBalances(
            ctx.query.maker, address(this), ctx.query.orderHash, ctx.query.tokenIn, ctx.query.tokenOut
        );
        uint256 passiveOut = totalOut > activeOut ? totalOut - activeOut : 0;
        require(
            ctx.swap.amountOut <= activeOut + passiveOut,
            TideInsufficientLiquidity(ctx.swap.amountOut, activeOut, passiveOut)
        );
    }
}

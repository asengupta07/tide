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

/// @notice ACTIVE_SPLIT opcode (slot 0x92, balances bank). Partially-active re-split, arXiv 2602.09887.
///
///   On the first quote or fill of a block the active reserves are recomputed as `lambda` of the
///   maker's Aqua balances; the remainder is passive and invisible to this block. Later fills in the
///   same block see the active reserves left by the previous fill. The opcode wraps the rest of the
///   program (like `DynamicBalances`) so it can persist the post-fill active reserves.
///
///   SwapVM has no block hook, so the re-split is lazy: it happens inside the first `quote()`/`swap()`
///   of a block. A quote in a fresh block is priced as the block's first fill.
///
/// @dev Encoding: [address params]
library ActiveSplit {
    using InstructionArgs for bytes;
    using InstructionBuilder for MemoryPtr;

    event TideResplit(bytes32 indexed orderHash, uint64 blockNumber, uint256 activeA, uint256 activeB);
    event TideTopUp(bytes32 indexed orderHash, uint256 activeA, uint256 activeB);

    Opcode constant opcode = TideProgram.ACTIVE_SPLIT;

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

    function exec(Context memory ctx, bytes calldata args) internal {
        TideProgram.check(ctx);
        TideParams params = TideParams(parse(args));
        (uint32 lambdaBps,,) = params.get(ctx.query.orderHash);

        TideStorage.BlockState storage state = TideStorage.store().state[ctx.query.orderHash];
        bool first = state.blockNumber != block.number;

        uint256 totalIn = ctx.swap.balanceIn;
        uint256 totalOut = ctx.swap.balanceOut;
        uint256 activeIn;
        uint256 activeOut;
        if (first) {
            activeIn = TideMath.activeReserve(totalIn, lambdaBps);
            activeOut = TideMath.activeReserve(totalOut, lambdaBps);
        } else {
            activeIn = state.active[ctx.query.tokenIn];
            activeOut = state.active[ctx.query.tokenOut];
        }

        ctx.swap.balanceIn = activeIn;
        ctx.swap.balanceOut = activeOut;

        (uint256 amountIn, uint256 amountOut) = ctx.runLoop();

        // Post-fill bookkeeping. If the fill dipped into the passive buffer, the buffer tops the active
        // side up by re-splitting from the new totals at the new marginal price (no arbitrage is created:
        // it is a transfer between the two parts at the same price).
        bool topUp = amountOut > activeOut;
        if (topUp) {
            activeIn = TideMath.activeReserve(totalIn + amountIn, lambdaBps);
            activeOut = TideMath.activeReserve(totalOut - amountOut, lambdaBps);
        } else {
            activeIn += amountIn;
            activeOut -= amountOut;
        }

        if (!ctx.vm.isStaticContext) {
            state.active[ctx.query.tokenIn] = activeIn;
            state.active[ctx.query.tokenOut] = activeOut;
            if (first) {
                state.blockNumber = uint64(block.number);
                state.anchor[ctx.query.tokenIn] = activeIn;
                state.anchor[ctx.query.tokenOut] = activeOut;
                emit TideResplit(ctx.query.orderHash, uint64(block.number), activeIn, activeOut);
            }
            if (topUp) emit TideTopUp(ctx.query.orderHash, activeIn, activeOut);
        }
    }
}

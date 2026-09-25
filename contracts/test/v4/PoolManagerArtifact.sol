// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

// Compiles the Uniswap v4 PoolManager (pinned to solc 0.8.26) so tests can `deployCodeTo` its artifact
// while the Tide contracts themselves compile with 0.8.30.
import { PoolManager } from "@uniswap/v4-core/src/PoolManager.sol";

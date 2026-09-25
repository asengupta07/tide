// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

/// @title TideStorage
/// @notice ERC-7201 namespaced storage shared by the three Tide opcodes. One `BlockState` per strategy
///         (orderHash) records the block of the last re-split, the active reserves per token after the
///         last fill, and the block's anchor reserves (the active reserves right after the first fill
///         of the block) against which `delta` drift is measured.
library TideStorage {
    // keccak256(abi.encode(uint256(keccak256("tide.storage.ActiveSplit")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant SLOT = 0xe1c98e0b6746306519bff0853750a5b29c945f7ccd943435345e474011c30800;

    struct BlockState {
        uint64 blockNumber;
        mapping(address token => uint256) active;
        mapping(address token => uint256) anchor;
    }

    struct Storage {
        mapping(bytes32 orderHash => BlockState) state;
    }

    function store() internal pure returns (Storage storage $) {
        bytes32 slot = SLOT;
        assembly ("memory-safe") {
            $.slot := slot
        }
    }

    /// @dev True on the first quote or fill of a new block for this strategy.
    function isFirstOfBlock(bytes32 orderHash) internal view returns (bool) {
        return store().state[orderHash].blockNumber != block.number;
    }
}

/// @notice External view helper so tests and the dashboard can read Tide block state from the router.
contract TideStorageExternal {
    function tideBlockNumber(bytes32 orderHash) external view returns (uint64) {
        return TideStorage.store().state[orderHash].blockNumber;
    }

    function tideActive(bytes32 orderHash, address token) external view returns (uint256) {
        return TideStorage.store().state[orderHash].active[token];
    }

    function tideAnchor(bytes32 orderHash, address token) external view returns (uint256) {
        return TideStorage.store().state[orderHash].anchor[token];
    }
}

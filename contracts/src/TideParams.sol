// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { TideMath } from "./lib/TideMath.sol";

/// @title TideParams
/// @notice On-chain mirror of the three governed Tide parameters (lambda, N, delta) for one strategy.
///         The source of truth and audit trail is the strategy's ENSv2 name on Sepolia
///         (`lambda`, `N`, `delta` text records, written only by the scoped manager role after a fresh
///         World ID authentication). The manager agent applies each approved change here on the trading
///         chain in the same run, so the SwapVM program and the v4 hook read the new value at the next
///         block. Only the three parameters can ever be changed and only by the owner or the manager.
contract TideParams {
    struct Params {
        uint32 lambdaBps;
        uint32 n;
        uint32 deltaBps;
        address owner;
        address manager;
    }

    error NotOwner(bytes32 key, address caller);
    error NotAuthorized(bytes32 key, address caller);
    error AlreadyInitialized(bytes32 key);
    error NotInitialized(bytes32 key);

    event Initialized(bytes32 indexed key, address indexed owner, uint32 lambdaBps, uint32 n, uint32 deltaBps);
    event ParamsUpdated(bytes32 indexed key, address indexed by, uint32 lambdaBps, uint32 n, uint32 deltaBps);
    event ManagerSet(bytes32 indexed key, address indexed manager);

    /// @notice Aqua registry the SwapVM opcodes read passive balances from. Unused by the v4 hook.
    IAqua public immutable AQUA;

    mapping(bytes32 key => Params) private _params;

    constructor(IAqua aqua) {
        AQUA = aqua;
    }

    /// @notice Create the parameter set for `key`. Called once by the strategy owner before shipping.
    function init(bytes32 key, uint32 lambdaBps, uint32 n, uint32 deltaBps, address manager) external {
        require(_params[key].owner == address(0), AlreadyInitialized(key));
        TideMath.checkParams(lambdaBps, n, deltaBps);
        _params[key] = Params({ lambdaBps: lambdaBps, n: n, deltaBps: deltaBps, owner: msg.sender, manager: manager });
        emit Initialized(key, msg.sender, lambdaBps, n, deltaBps);
        if (manager != address(0)) emit ManagerSet(key, manager);
    }

    /// @notice Owner or manager updates the three governed values. Nothing else is mutable.
    function set(bytes32 key, uint32 lambdaBps, uint32 n, uint32 deltaBps) external {
        Params storage p = _params[key];
        require(p.owner != address(0), NotInitialized(key));
        require(msg.sender == p.owner || msg.sender == p.manager, NotAuthorized(key, msg.sender));
        TideMath.checkParams(lambdaBps, n, deltaBps);
        (p.lambdaBps, p.n, p.deltaBps) = (lambdaBps, n, deltaBps);
        emit ParamsUpdated(key, msg.sender, lambdaBps, n, deltaBps);
    }

    /// @notice Owner grants or revokes the manager. Revoking is `setManager(key, address(0))`.
    function setManager(bytes32 key, address manager) external {
        Params storage p = _params[key];
        require(p.owner != address(0), NotInitialized(key));
        require(msg.sender == p.owner, NotOwner(key, msg.sender));
        p.manager = manager;
        emit ManagerSet(key, manager);
    }

    function get(bytes32 key) external view returns (uint32 lambdaBps, uint32 n, uint32 deltaBps) {
        Params storage p = _params[key];
        require(p.owner != address(0), NotInitialized(key));
        return (p.lambdaBps, p.n, p.deltaBps);
    }

    function params(bytes32 key) external view returns (Params memory) {
        return _params[key];
    }
}

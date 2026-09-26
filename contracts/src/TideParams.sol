// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { TideMath } from "./lib/TideMath.sol";

/// @title TideParams
/// @notice On-chain mirror of a strategy's governed parameters (lambda, N, delta) plus the flat fee that
///         backs them, keyed by the Aqua order hash or the v4 PoolId. The venues read all four on every fill,
///         so the fee a fill pays is by construction the fee `TideMath.checkParams` bounded delta against.
///         Owner (the maker) or manager may set lambda/N/delta; only the owner may set the fee.
contract TideParams {
    struct Params {
        uint32 lambdaBps;
        uint32 n;
        uint32 deltaBps;
        uint32 feeBps;
        address owner;
        address manager;
    }

    error NotOwner(bytes32 key, address caller);
    error NotAuthorized(bytes32 key, address caller);
    error AlreadyInitialized(bytes32 key);
    error NotInitialized(bytes32 key);

    event Initialized(
        bytes32 indexed key, address indexed owner, uint32 lambdaBps, uint32 n, uint32 deltaBps, uint32 feeBps
    );
    event ParamsUpdated(bytes32 indexed key, address indexed by, uint32 lambdaBps, uint32 n, uint32 deltaBps);
    event FeeSet(bytes32 indexed key, uint32 feeBps);
    event ManagerSet(bytes32 indexed key, address indexed manager);

    IAqua public immutable AQUA;

    mapping(bytes32 key => Params) private _params;

    constructor(IAqua aqua) {
        AQUA = aqua;
    }

    function init(bytes32 key, uint32 lambdaBps, uint32 n, uint32 deltaBps, uint32 feeBps, address manager) external {
        require(_params[key].owner == address(0), AlreadyInitialized(key));
        TideMath.checkParams(lambdaBps, n, deltaBps, feeBps);
        _params[key] = Params({
            lambdaBps: lambdaBps,
            n: n,
            deltaBps: deltaBps,
            feeBps: feeBps,
            owner: msg.sender,
            manager: manager
        });
        emit Initialized(key, msg.sender, lambdaBps, n, deltaBps, feeBps);
        if (manager != address(0)) emit ManagerSet(key, manager);
    }

    function set(bytes32 key, uint32 lambdaBps, uint32 n, uint32 deltaBps) external {
        Params storage p = _params[key];
        require(p.owner != address(0), NotInitialized(key));
        require(msg.sender == p.owner || msg.sender == p.manager, NotAuthorized(key, msg.sender));
        TideMath.checkParams(lambdaBps, n, deltaBps, p.feeBps);
        (p.lambdaBps, p.n, p.deltaBps) = (lambdaBps, n, deltaBps);
        emit ParamsUpdated(key, msg.sender, lambdaBps, n, deltaBps);
    }

    function setFee(bytes32 key, uint32 feeBps) external {
        Params storage p = _params[key];
        require(p.owner != address(0), NotInitialized(key));
        require(msg.sender == p.owner, NotOwner(key, msg.sender));
        TideMath.checkParams(p.lambdaBps, p.n, p.deltaBps, feeBps);
        p.feeBps = feeBps;
        emit FeeSet(key, feeBps);
    }

    function setManager(bytes32 key, address manager) external {
        Params storage p = _params[key];
        require(p.owner != address(0), NotInitialized(key));
        require(msg.sender == p.owner, NotOwner(key, msg.sender));
        p.manager = manager;
        emit ManagerSet(key, manager);
    }

    function get(bytes32 key) external view returns (uint32 lambdaBps, uint32 n, uint32 deltaBps, uint32 feeBps) {
        Params storage p = _params[key];
        require(p.owner != address(0), NotInitialized(key));
        return (p.lambdaBps, p.n, p.deltaBps, p.feeBps);
    }

    function params(bytes32 key) external view returns (Params memory) {
        return _params[key];
    }
}

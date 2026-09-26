// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { TideMath } from "./lib/TideMath.sol";

/// @title TideParams
/// @notice On-chain mirror of a strategy's governed parameters (lambda, N, delta) plus the flat fee that
///         backs them, keyed by the Aqua order hash or the v4 PoolId. The venues read all four on every fill,
///         so the fee a fill pays is by construction the fee `TideMath.checkParams` bounded delta against.
///         Owner (the maker) or manager may set lambda/N/delta; only the owner may set the fee.
///
///         Guardrails: the owner sets bounds the manager must stay inside (lambda range, largest lambda move
///         per write, largest N, cooldown between writes). Inside them the manager runs on its own; outside
///         them only the owner can write. Defaults are set at `init` and changed with `setBounds`.
contract TideParams {
    struct Params {
        uint32 lambdaBps;
        uint32 n;
        uint32 deltaBps;
        uint32 feeBps;
        address owner;
        address manager;
    }

    struct Bounds {
        uint32 lambdaMin;
        uint32 lambdaMax;
        uint32 nMax;
        uint32 maxStepBps; // largest |new lambda - old lambda| the manager may make in one write
        uint32 cooldown; // seconds between manager writes
    }

    error NotOwner(bytes32 key, address caller);
    error NotAuthorized(bytes32 key, address caller);
    error AlreadyInitialized(bytes32 key);
    error NotInitialized(bytes32 key);
    error OutsideBounds(bytes32 key, string what, uint256 value);
    error InvalidBounds(string what, uint256 value);

    event Initialized(
        bytes32 indexed key, address indexed owner, uint32 lambdaBps, uint32 n, uint32 deltaBps, uint32 feeBps
    );
    event ParamsUpdated(bytes32 indexed key, address indexed by, uint32 lambdaBps, uint32 n, uint32 deltaBps);
    event FeeSet(bytes32 indexed key, uint32 feeBps);
    event BoundsSet(
        bytes32 indexed key, uint32 lambdaMin, uint32 lambdaMax, uint32 nMax, uint32 maxStepBps, uint32 cooldown
    );
    event ManagerSet(bytes32 indexed key, address indexed manager);

    IAqua public immutable AQUA;

    mapping(bytes32 key => Params) private _params;
    mapping(bytes32 key => Bounds) private _bounds;
    mapping(bytes32 key => uint64) public lastManagerSet;

    /// @dev Defaults at init: lambda in [10%, 90%], N up to 8, at most 25 points of lambda per write, one hour apart.
    uint32 internal constant DEFAULT_LAMBDA_MIN = 1000;
    uint32 internal constant DEFAULT_LAMBDA_MAX = 9000;
    uint32 internal constant DEFAULT_N_MAX = 8;
    uint32 internal constant DEFAULT_MAX_STEP = 2500;
    uint32 internal constant DEFAULT_COOLDOWN = 3600;

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
        _bounds[key] = Bounds({
            lambdaMin: DEFAULT_LAMBDA_MIN,
            lambdaMax: DEFAULT_LAMBDA_MAX,
            nMax: DEFAULT_N_MAX,
            maxStepBps: DEFAULT_MAX_STEP,
            cooldown: DEFAULT_COOLDOWN
        });
        emit Initialized(key, msg.sender, lambdaBps, n, deltaBps, feeBps);
        emit BoundsSet(key, DEFAULT_LAMBDA_MIN, DEFAULT_LAMBDA_MAX, DEFAULT_N_MAX, DEFAULT_MAX_STEP, DEFAULT_COOLDOWN);
        if (manager != address(0)) emit ManagerSet(key, manager);
    }

    function set(bytes32 key, uint32 lambdaBps, uint32 n, uint32 deltaBps) external {
        Params storage p = _params[key];
        require(p.owner != address(0), NotInitialized(key));
        require(msg.sender == p.owner || msg.sender == p.manager, NotAuthorized(key, msg.sender));
        TideMath.checkParams(lambdaBps, n, deltaBps, p.feeBps);
        if (msg.sender != p.owner) {
            _checkBounds(key, p, lambdaBps, n);
            lastManagerSet[key] = uint64(block.timestamp);
        }
        (p.lambdaBps, p.n, p.deltaBps) = (lambdaBps, n, deltaBps);
        emit ParamsUpdated(key, msg.sender, lambdaBps, n, deltaBps);
    }

    /// @notice Owner-only guardrails for the manager. The owner's own writes are never bounded.
    function setBounds(bytes32 key, Bounds calldata b) external {
        Params storage p = _params[key];
        require(p.owner != address(0), NotInitialized(key));
        require(msg.sender == p.owner, NotOwner(key, msg.sender));
        require(
            b.lambdaMin > 0 && b.lambdaMin <= b.lambdaMax && b.lambdaMax <= 10_000, InvalidBounds("lambda", b.lambdaMax)
        );
        require(b.nMax >= 1 && b.nMax <= 64, InvalidBounds("nMax", b.nMax));
        require(b.maxStepBps > 0 && b.maxStepBps <= 10_000, InvalidBounds("maxStep", b.maxStepBps));
        _bounds[key] = b;
        emit BoundsSet(key, b.lambdaMin, b.lambdaMax, b.nMax, b.maxStepBps, b.cooldown);
    }

    /// @notice Would a manager write to (lambda, n) pass right now? Lets the agent decide between
    ///         applying on its own and escalating to the owner without sending a transaction.
    function withinBounds(bytes32 key, uint32 lambdaBps, uint32 n) external view returns (bool ok, string memory why) {
        Params storage p = _params[key];
        if (p.owner == address(0)) return (false, "not initialized");
        Bounds storage b = _bounds[key];
        if (lambdaBps < b.lambdaMin || lambdaBps > b.lambdaMax) return (false, "lambda outside range");
        uint256 step = lambdaBps > p.lambdaBps ? lambdaBps - p.lambdaBps : p.lambdaBps - lambdaBps;
        if (step > b.maxStepBps) return (false, "lambda step too large");
        if (n > b.nMax) return (false, "N above max");
        uint64 last = lastManagerSet[key];
        if (last != 0 && block.timestamp < uint256(last) + b.cooldown) return (false, "cooldown");
        return (true, "");
    }

    function _checkBounds(bytes32 key, Params storage p, uint32 lambdaBps, uint32 n) internal view {
        Bounds storage b = _bounds[key];
        require(lambdaBps >= b.lambdaMin && lambdaBps <= b.lambdaMax, OutsideBounds(key, "lambda", lambdaBps));
        uint256 step = lambdaBps > p.lambdaBps ? lambdaBps - p.lambdaBps : p.lambdaBps - lambdaBps;
        require(step <= b.maxStepBps, OutsideBounds(key, "step", step));
        require(n <= b.nMax, OutsideBounds(key, "n", n));
        uint64 last = lastManagerSet[key];
        require(
            last == 0 || block.timestamp >= uint256(last) + b.cooldown, OutsideBounds(key, "cooldown", block.timestamp)
        );
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

    function bounds(bytes32 key) external view returns (Bounds memory) {
        return _bounds[key];
    }
}

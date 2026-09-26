// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/interfaces/ISwapVM.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/libs/MakerTraits.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/libs/TakerTraits.sol";
import { XYCSwap } from "@1inch/swap-vm/instructions/XYCSwap.sol";
import { FeeFlatIn } from "@1inch/swap-vm/instructions/FeeFlat.sol";
import { Salt } from "@1inch/swap-vm/instructions/Controls.sol";

import { TideParams } from "../src/TideParams.sol";
import { TideRouter } from "../src/aqua/TideRouter.sol";
import { TideApp } from "../src/aqua/TideApp.sol";
import { DemoResolver } from "./ForkDemo.s.sol";

/// @dev Taker that fills both strategies inside one transaction, so every leg of a round lands in the same
///      block: the arbitrageur first (Tide's first fill), then a retail order, then an informed-sized order.
contract Bench is DemoResolver {
    struct Leg {
        bool aToB; // tokenA -> tokenB (USDC -> WETH on mainnet ordering)
        uint256 amountIn; // exact input; 0 skips the leg
    }

    constructor(IAqua aqua, address router) DemoResolver(aqua, router) { }

    /// @return io [arbPlainIn, arbPlainOut, arbTideIn, arbTideOut, retailPlainIn, retailPlainOut, retailTideIn,
    ///         retailTideOut, bigPlainIn, bigPlainOut, bigTideIn, bigTideOut]
    function round(
        ISwapVM.Order calldata plain,
        ISwapVM.Order calldata tide,
        Leg calldata arbPlain,
        Leg calldata arbTide,
        uint256 retailIn,
        uint256 bigIn
    ) external returns (uint256[12] memory io) {
        (io[0], io[1]) = _fill(plain, arbPlain);
        (io[2], io[3]) = _fill(tide, arbTide);
        (io[4], io[5]) = _fill(plain, Leg(true, retailIn));
        (io[6], io[7]) = _fill(tide, Leg(true, retailIn));
        if (bigIn > 0) {
            (io[8], io[9]) = _fill(plain, Leg(true, bigIn));
            (io[10], io[11]) = _fill(tide, Leg(true, bigIn));
        }
    }

    function _fill(ISwapVM.Order calldata order, Leg memory leg) internal returns (uint256 amountIn, uint256 amountOut) {
        if (leg.amountIn == 0) return (0, 0);
        (amountIn, amountOut,) = ISwapVM(ROUTER).swap(order, leg.amountIn, _td(leg.aToB));
    }

    function _td(bool aToB) internal view returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: address(this),
                isExactIn: true,
                shouldUnwrapWeth: false,
                hasPreTransferInCallback: true,
                hasPreTransferOutCallback: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: false,
                isAToB: aToB,
                allowPartialFill: false,
                usePermit2: false,
                threshold: "",
                to: address(0),
                deadline: 0,
                preTransferInHookData: "",
                postTransferInHookData: "",
                preTransferOutHookData: "",
                postTransferOutHookData: "",
                preTransferInCallbackData: "",
                preTransferOutCallbackData: "",
                instructionsArgs: "",
                signature: ""
            })
        );
    }
}

/// @notice Same maker, same inventory, same router, same registry, same price path, same orders. Two
///         strategies: a plain `FeeFlatIn XYCSwap Salt` program and the Tide program. Eight blocks; in each
///         an arbitrageur trades both pools to the new price, a retail order buys on both, and once an
///         informed-sized order hits both. Writes `deployments/sidebyside.json`; the shell script renders it
///         from the transaction receipts.
///
///   ./script/side-by-side.sh
contract SideBySide is Script {
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address internal constant MAKER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address internal constant BENCH_EOA = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant MANAGER = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    uint32 internal constant LAMBDA = 5000;
    uint32 internal constant N = 4;
    uint32 internal constant DELTA = 20;
    uint32 internal constant FEE = 30; // bps; FeeFlatIn works in 1e7 units

    uint256 internal constant INV_WETH = 50e18;
    uint256 internal constant INV_USDC = 150_000e6;
    uint256 internal constant RETAIL_IN = 200e6;
    uint256 internal constant BIG_IN = 5000e6;
    uint256 internal constant BIG_ROUND = 3;

    function run() external {
        // a volatile day: every move clears the 30 bp fee band, so the arbitrageur trades both pools each block
        int256[8] memory returnsBps = [int256(200), -220, 180, 250, -240, 160, -190, 210];

        vm.startBroadcast(MAKER);
        TideParams params = new TideParams(IAqua(AQUA));
        TideRouter router = new TideRouter(AQUA, WETH, MAKER);
        TideApp app = new TideApp(IAqua(AQUA), address(router), params);
        Bench bench = new Bench(IAqua(AQUA), address(router));
        vm.stopBroadcast();

        require(IERC20(WETH).balanceOf(MAKER) >= 2 * INV_WETH, "run script/side-by-side.sh to fund the maker");
        _fund(address(bench));

        (address tokenA, address tokenB) = USDC < WETH ? (USDC, WETH) : (WETH, USDC);
        ISwapVM.Order memory plain = _plainOrder(tokenA, tokenB);
        ISwapVM.Order memory tide = app.order(TideApp.Config({ maker: MAKER, tokenA: tokenA, tokenB: tokenB, salt: 2 }));
        bytes32 plainHash = router.hash(plain);
        bytes32 tideHash = router.hash(tide);

        vm.startBroadcast(MAKER);
        params.init(tideHash, LAMBDA, N, DELTA, FEE, MANAGER);
        IERC20(WETH).approve(AQUA, type(uint256).max);
        IERC20(USDC).approve(AQUA, type(uint256).max);
        _ship(router, plain, tokenA, tokenB);
        _ship(router, tide, tokenA, tokenB);
        vm.stopBroadcast();

        // ---- price path: start at the pool price, USDC (6 dec) per ETH ----
        uint256 price = INV_USDC * 1e18 / INV_WETH;
        string memory json = "sbs";
        vm.serializeAddress(json, "aqua", AQUA);
        vm.serializeAddress(json, "router", address(router));
        vm.serializeAddress(json, "params", address(params));
        vm.serializeAddress(json, "app", address(app));
        vm.serializeAddress(json, "bench", address(bench));
        vm.serializeAddress(json, "maker", MAKER);
        vm.serializeAddress(json, "weth", WETH);
        vm.serializeAddress(json, "usdc", USDC);
        vm.serializeBytes32(json, "plainHash", plainHash);
        vm.serializeBytes32(json, "tideHash", tideHash);
        vm.serializeUint(json, "lambdaBps", LAMBDA);
        vm.serializeUint(json, "n", N);
        vm.serializeUint(json, "deltaBps", DELTA);
        vm.serializeUint(json, "feeBps", FEE);
        vm.serializeUint(json, "invWeth", INV_WETH);
        vm.serializeUint(json, "invUsdc", INV_USDC);
        vm.serializeUint(json, "startPrice", price);
        vm.serializeUint(json, "retailIn", RETAIL_IN);
        vm.serializeUint(json, "bigIn", BIG_IN);
        vm.serializeUint(json, "bigRound", BIG_ROUND);

        uint256[] memory prices = new uint256[](8);
        for (uint256 r = 0; r < 8; r++) {
            price = uint256(int256(price) * (10_000 + returnsBps[r]) / 10_000);
            prices[r] = price;

            Bench.Leg memory arbPlain = _arbLeg(router, plainHash, price, 10_000);
            Bench.Leg memory arbTide = _arbLeg(router, tideHash, price, LAMBDA);
            uint256 big = r + 1 == BIG_ROUND ? BIG_IN : 0;

            vm.startBroadcast(BENCH_EOA);
            uint256[12] memory io = bench.round(plain, tide, arbPlain, arbTide, RETAIL_IN, big);
            vm.stopBroadcast();
            vm.roll(block.number + 1); // the broadcast lands one transaction per block; keep the simulation in step

            console.log("round", r + 1, "price", price);
            console.log("  arb   plain in/out", io[0], io[1]);
            console.log("  arb   tide  in/out", io[2], io[3]);
            console.log("  retail plain/tide out", io[5], io[7]);
            if (big > 0) console.log("  big    plain/tide out", io[9], io[11]);
        }
        string memory out = vm.serializeUint(json, "prices", prices);
        vm.writeJson(out, "deployments/sidebyside.json");
    }

    /// @dev Optimal exact-in arbitrage on a constant-product curve from the pool price to `truePrice`,
    ///      on `shareBps` of the pool's reserves (10_000 for the whole pool, lambda for Tide's active slice).
    function _arbLeg(TideRouter router, bytes32 hash, uint256 truePrice, uint256 shareBps)
        internal
        view
        returns (Bench.Leg memory leg)
    {
        (uint248 x,) = IAqua(AQUA).rawBalances(MAKER, address(router), hash, WETH);
        (uint248 y,) = IAqua(AQUA).rawBalances(MAKER, address(router), hash, USDC);
        uint256 poolPrice = uint256(y) * 1e18 / uint256(x);
        // The taker pays the fee on the input, so the pool price worth trading to is true * (1 - f) when
        // buying ETH and true / (1 - f) when selling; inside that band no arbitrage is profitable.
        uint256 buyTarget = truePrice * (10_000 - FEE) / 10_000;
        uint256 sellTarget = truePrice * 10_000 / (10_000 - FEE);
        if (buyTarget > poolPrice) {
            uint256 s = Math.sqrt(buyTarget * 1e18 / poolPrice * 1e18); // sqrt(target/pool) * 1e18
            leg = Bench.Leg(true, uint256(y) * shareBps / 10_000 * (s - 1e18) / 1e18);
        } else if (sellTarget < poolPrice) {
            uint256 s = Math.sqrt(poolPrice * 1e18 / sellTarget * 1e18); // sqrt(pool/target) * 1e18
            leg = Bench.Leg(false, uint256(x) * shareBps / 10_000 * (s - 1e18) / 1e18);
        } else {
            leg = Bench.Leg(true, 0);
        }
    }

    function _plainOrder(address tokenA, address tokenB) internal pure returns (ISwapVM.Order memory) {
        bytes memory program = bytes.concat(FeeFlatIn.build(uint24(FEE) * 1000), XYCSwap.build(), Salt.build(1));
        return MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: MAKER,
                receiver: address(0),
                tokenA: tokenA,
                tokenB: tokenB,
                shouldUnwrapWeth: false,
                useAquaInsteadOfSignature: true,
                allowZeroAmountIn: false,
                usePermit2: false,
                hasPreTransferInHook: false,
                hasPostTransferInHook: false,
                hasPreTransferOutHook: false,
                hasPostTransferOutHook: false,
                preTransferInTarget: address(0),
                preTransferInData: "",
                postTransferInTarget: address(0),
                postTransferInData: "",
                preTransferOutTarget: address(0),
                preTransferOutData: "",
                postTransferOutTarget: address(0),
                postTransferOutData: "",
                program: program
            })
        );
    }

    function _ship(TideRouter router, ISwapVM.Order memory order, address tokenA, address tokenB) internal {
        address[] memory tokens = new address[](2);
        tokens[0] = tokenA;
        tokens[1] = tokenB;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = tokenA == WETH ? INV_WETH : INV_USDC;
        amounts[1] = tokenB == WETH ? INV_WETH : INV_USDC;
        IAqua(AQUA).ship(address(router), abi.encode(order), tokens, amounts);
    }

    function _fund(address bench) internal {
        vm.startBroadcast(MAKER);
        IERC20(USDC).transfer(bench, 120_000e6);
        vm.stopBroadcast();
        vm.startBroadcast(BENCH_EOA);
        (bool ok,) = WETH.call{ value: 40e18 }("");
        require(ok, "weth deposit");
        IERC20(WETH).transfer(bench, 40e18);
        vm.stopBroadcast();
    }
}

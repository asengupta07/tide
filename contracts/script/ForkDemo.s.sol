// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/interfaces/ISwapVM.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/libs/TakerTraits.sol";
import { ITakerCallbacks } from "@1inch/swap-vm/interfaces/ITakerCallbacks.sol";

import { TideParams } from "../src/TideParams.sol";
import { TideRouter } from "../src/aqua/TideRouter.sol";
import { TideApp } from "../src/aqua/TideApp.sol";

/// @dev Minimal resolver: pushes tokenIn to Aqua in the pre-transfer-in callback, like 1inch's MockTaker.
contract DemoResolver is ITakerCallbacks {
    IAqua public immutable AQUA;
    address public immutable ROUTER;

    constructor(IAqua aqua, address router) {
        AQUA = aqua;
        ROUTER = router;
    }

    function swap(ISwapVM.Order calldata order, uint256 amount, bytes calldata takerTraitsAndData)
        external
        returns (uint256, uint256, bytes32)
    {
        return ISwapVM(ROUTER).swap(order, amount, takerTraitsAndData);
    }

    function preTransferInCallback(
        address maker,
        address,
        address tokenIn,
        address,
        uint256 amountIn,
        uint256,
        bytes32 orderHash,
        bytes calldata
    ) external {
        IERC20(tokenIn).approve(address(AQUA), amountIn);
        AQUA.push(maker, ROUTER, orderHash, tokenIn, amountIn);
    }

    function preTransferOutCallback(address, address, address, address, uint256, uint256, bytes32, bytes calldata)
        external
    { }
}

/// @notice End-to-end fill on a mainnet fork against the official Aqua registry with real WETH/USDC:
///         deploy Tide, maker ships (inventory stays in wallet), a resolver fills twice in one block and
///         once in the next block, printing wallet balances and Tide block state.
///
///   ./script/fork-demo.sh   (starts anvil on a mainnet fork, funds the demo accounts, runs this script)
contract ForkDemo is Script {
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address internal constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address internal constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;

    // anvil default accounts
    address internal constant MAKER = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    address internal constant RESOLVER_EOA = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant MANAGER = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;

    function run() external {
        // ---- deploy (maker is also deployer) ----
        vm.startBroadcast(MAKER);
        TideParams params = new TideParams(IAqua(AQUA));
        TideRouter router = new TideRouter(AQUA, WETH, MAKER);
        TideApp app = new TideApp(IAqua(AQUA), address(router), params);
        DemoResolver resolver = new DemoResolver(IAqua(AQUA), address(router));
        vm.stopBroadcast();

        // ---- maker and resolver are funded with real WETH/USDC by script/fork-demo.sh (anvil_setStorageAt) ----
        require(IERC20(WETH).balanceOf(MAKER) >= 100e18, "run script/fork-demo.sh to fund the maker");
        _fund(address(resolver));

        // ---- maker: params + ship, one tx each; nothing leaves the wallet ----
        (address tokenA, address tokenB) = USDC < WETH ? (USDC, WETH) : (WETH, USDC);
        TideApp.Config memory cfg = TideApp.Config({ maker: MAKER, tokenA: tokenA, tokenB: tokenB, salt: 1 });
        ISwapVM.Order memory order = app.order(cfg);
        bytes32 orderHash = router.hash(order);

        vm.startBroadcast(MAKER);
        params.init(orderHash, 5000, 4, 20, 30, MANAGER);
        IERC20(WETH).approve(AQUA, type(uint256).max);
        IERC20(USDC).approve(AQUA, type(uint256).max);
        address[] memory tokens = new address[](2);
        tokens[0] = tokenA;
        tokens[1] = tokenB;
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = tokenA == WETH ? 100e18 : 300_000e6;
        amounts[1] = tokenB == WETH ? 100e18 : 300_000e6;
        IAqua(AQUA).ship(address(router), abi.encode(order), tokens, amounts);
        vm.stopBroadcast();

        console.log("orderHash");
        console.logBytes32(orderHash);
        console.log("maker WETH after ship", IERC20(WETH).balanceOf(MAKER));
        console.log("maker USDC after ship", IERC20(USDC).balanceOf(MAKER));

        // ---- resolver fills: sell 1 WETH for USDC (block's first fill, active slice only) ----
        bool aToB = tokenA == WETH; // WETH -> USDC
        vm.startBroadcast(RESOLVER_EOA);
        (uint256 in1, uint256 out1,) = resolver.swap(order, 1e18, _takerData(address(resolver), true, aToB));
        (uint256 in2, uint256 out2,) = resolver.swap(order, 0.05e18, _takerData(address(resolver), true, aToB));
        vm.stopBroadcast();
        console.log("fill 1 (first of block, N=1): in", in1, "out", out1);
        console.log("fill 2 (same block, N=4):     in", in2, "out", out2);
        console.log("tide block", router.tideBlockNumber(orderHash));
        console.log("active WETH", router.tideActive(orderHash, WETH));
        console.log("active USDC", router.tideActive(orderHash, USDC));
        console.log("maker WETH after fills", IERC20(WETH).balanceOf(MAKER));
        console.log("maker USDC after fills", IERC20(USDC).balanceOf(MAKER));

        string memory json = "fork";
        vm.serializeAddress(json, "tideParams", address(params));
        vm.serializeAddress(json, "tideRouter", address(router));
        vm.serializeAddress(json, "tideApp", address(app));
        vm.serializeAddress(json, "resolver", address(resolver));
        vm.serializeAddress(json, "maker", MAKER);
        string memory out = vm.serializeBytes32(json, "orderHash", orderHash);
        vm.writeJson(out, "deployments/31337.json");
    }

    /// @dev The resolver contract is created by this script, so it is funded here via the WETH deposit
    ///      function (real ETH from the anvil account) and a USDC transfer from the pre-funded maker.
    function _fund(address resolver) internal {
        vm.startBroadcast(MAKER);
        IERC20(USDC).transfer(resolver, 50_000e6);
        vm.stopBroadcast();
        vm.startBroadcast(RESOLVER_EOA);
        (bool ok,) = WETH.call{ value: 10e18 }("");
        require(ok, "weth deposit");
        IERC20(WETH).transfer(resolver, 10e18);
        vm.stopBroadcast();
    }

    function _takerData(address taker, bool isExactIn, bool isAToB) internal pure returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: taker,
                isExactIn: isExactIn,
                shouldUnwrapWeth: false,
                hasPreTransferInCallback: true,
                hasPreTransferOutCallback: false,
                isStrictThresholdAmount: false,
                isFirstTransferFromTaker: false,
                useTransferFromAndAquaPush: false,
                isAToB: isAToB,
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

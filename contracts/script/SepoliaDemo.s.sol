// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { ISwapVM } from "@1inch/swap-vm/interfaces/ISwapVM.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/libs/TakerTraits.sol";

import { TideParams } from "../src/TideParams.sol";
import { TideRouter } from "../src/aqua/TideRouter.sol";
import { TideApp } from "../src/aqua/TideApp.sol";
import { DemoResolver } from "./ForkDemo.s.sol";

interface IWETH {
    function deposit() external payable;
}

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @notice Live Sepolia flow against the official Aqua registry (same address as mainnet):
///         owner wraps ETH and mints test USDC, initialises TideParams for the strategy (manager = agent
///         wallet), ships to Aqua with inventory in the wallet, deploys a demo resolver and performs one fill.
///
///   forge script script/SepoliaDemo.s.sol --tc SepoliaDemo --rpc-url $SEPOLIA_RPC_URL --broadcast \
///       --private-key $OWNER_PRIVATE_KEY
///   Set SEPOLIA_STEP=ship (default) or SEPOLIA_STEP=fill to run only one half.
contract SepoliaDemo is Script {
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;
    address internal constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address internal constant USDC = 0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e; // ENS beta MockUSDC (mintable)

    function run() external {
        string memory dep = vm.readFile("deployments/11155111.json");
        TideParams params = TideParams(vm.parseJsonAddress(dep, ".tideParams"));
        TideRouter router = TideRouter(payable(vm.parseJsonAddress(dep, ".tideRouter")));
        TideApp app = TideApp(vm.parseJsonAddress(dep, ".tideApp"));
        address owner = vm.envAddress("OWNER_ADDRESS");
        address agent = vm.envAddress("AGENT_ADDRESS");
        string memory step = vm.envOr("SEPOLIA_STEP", string("ship"));

        (address tokenA, address tokenB) = USDC < WETH ? (USDC, WETH) : (WETH, USDC);
        TideApp.Config memory cfg = TideApp.Config({ maker: owner, tokenA: tokenA, tokenB: tokenB, salt: 1 });
        ISwapVM.Order memory order = app.order(cfg);
        bytes32 orderHash = router.hash(order);
        console.log("orderHash");
        console.logBytes32(orderHash);

        if (keccak256(bytes(step)) == keccak256("ship")) {
            _ship(params, app, cfg, router, order, orderHash, owner, agent, tokenA, tokenB);
        } else {
            _fill(router, order, orderHash, owner);
        }
    }

    function _ship(
        TideParams params,
        TideApp app,
        TideApp.Config memory cfg,
        TideRouter router,
        ISwapVM.Order memory order,
        bytes32 orderHash,
        address owner,
        address agent,
        address tokenA,
        address tokenB
    ) internal {
        uint256 wethAmount = 0.5e18;
        uint256 usdcAmount = 1500e6;

        vm.startBroadcast(owner);
        if (IERC20(WETH).balanceOf(owner) < wethAmount) IWETH(WETH).deposit{ value: wethAmount }();
        if (IERC20(USDC).balanceOf(owner) < usdcAmount) IMintable(USDC).mint(owner, usdcAmount * 2);
        if (IERC20(WETH).allowance(owner, AQUA) < wethAmount) IERC20(WETH).approve(AQUA, type(uint256).max);
        if (IERC20(USDC).allowance(owner, AQUA) < usdcAmount) IERC20(USDC).approve(AQUA, type(uint256).max);

        TideParams.Params memory p = params.params(orderHash);
        if (p.owner == address(0)) app.init(cfg, 5000, 4, 20, 30, agent);

        (uint248 bal,) = IAqua(AQUA).rawBalances(owner, address(router), orderHash, WETH);
        if (bal == 0) {
            address[] memory tokens = new address[](2);
            tokens[0] = tokenA;
            tokens[1] = tokenB;
            uint256[] memory amounts = new uint256[](2);
            amounts[0] = tokenA == WETH ? wethAmount : usdcAmount;
            amounts[1] = tokenB == WETH ? wethAmount : usdcAmount;
            IAqua(AQUA).ship(address(router), abi.encode(order), tokens, amounts);
            console.log("shipped");
        } else {
            console.log("already shipped, Aqua WETH balance", bal);
        }
        vm.stopBroadcast();

        console.log("owner WETH in wallet", IERC20(WETH).balanceOf(owner));
        console.log("owner USDC in wallet", IERC20(USDC).balanceOf(owner));
    }

    function _fill(TideRouter router, ISwapVM.Order memory order, bytes32 orderHash, address owner) internal {
        vm.startBroadcast(owner);
        DemoResolver resolver = new DemoResolver(IAqua(AQUA), address(router));
        // fund the resolver with 0.02 WETH to sell
        IWETH(WETH).deposit{ value: 0.02e18 }();
        IERC20(WETH).transfer(address(resolver), 0.02e18);
        (uint256 amountIn, uint256 amountOut,) =
            resolver.swap(order, 0.02e18, _takerData(address(resolver), true, _isAToB(order)));
        vm.stopBroadcast();
        console.log("fill: in", amountIn, "out", amountOut);
        console.log("tide block", router.tideBlockNumber(orderHash));
        console.log("resolver", address(resolver));
    }

    function _isAToB(ISwapVM.Order memory order) internal pure returns (bool) {
        (address a,) = _tokens(order);
        return a == WETH;
    }

    function _tokens(ISwapVM.Order memory) internal pure returns (address a, address b) {
        return USDC < WETH ? (USDC, WETH) : (WETH, USDC);
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

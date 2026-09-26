// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { Hooks } from "@uniswap/v4-core/src/libraries/Hooks.sol";
import { IHooks } from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import { Currency } from "@uniswap/v4-core/src/types/Currency.sol";
import { PoolKey } from "@uniswap/v4-core/src/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "@uniswap/v4-core/src/types/PoolId.sol";
import { LPFeeLibrary } from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import { SwapParams } from "@uniswap/v4-core/src/types/PoolOperation.sol";
import { BalanceDelta } from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import { PoolSwapTest } from "@uniswap/v4-core/src/test/PoolSwapTest.sol";
import { HookMiner } from "@uniswap/v4-periphery/src/utils/HookMiner.sol";
import { BaseCustomAccounting } from "@openzeppelin/uniswap-hooks/src/base/BaseCustomAccounting.sol";

import { TideHook } from "../src/v4/TideHook.sol";
import { TideParams } from "../src/TideParams.sol";

interface IWETH {
    function deposit() external payable;
}

interface IMintable {
    function mint(address to, uint256 amount) external;
}

/// @notice Sepolia: deploy TideHook at a mined address, initialise a WETH/USDC pool on the canonical
///         PoolManager, seed liquidity through the hook, and perform one swap through a PoolSwapTest router.
///         Uses the same TideParams as the Aqua strategy (key = PoolId) with the agent as manager.
///
///   forge script script/DeployHook.s.sol --tc DeployHook --rpc-url $SEPOLIA_RPC_URL --broadcast \
///       --private-key $OWNER_PRIVATE_KEY
contract DeployHook is Script {
    using PoolIdLibrary for PoolKey;

    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
    address internal constant USDC = 0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e;

    function run() external {
        string memory dep = vm.readFile("deployments/11155111.json");
        TideParams params = TideParams(vm.parseJsonAddress(dep, ".tideParams"));
        address owner = vm.envAddress("OWNER_ADDRESS");
        address agent = vm.envAddress("AGENT_ADDRESS");

        uint160 flags = uint160(
            Hooks.BEFORE_INITIALIZE_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.BEFORE_SWAP_RETURNS_DELTA_FLAG
                | Hooks.BEFORE_ADD_LIQUIDITY_FLAG | Hooks.BEFORE_REMOVE_LIQUIDITY_FLAG
        );
        bytes memory ctorArgs = abi.encode(IPoolManager(POOL_MANAGER), params, owner);
        (address predicted, bytes32 salt) =
            HookMiner.find(CREATE2_DEPLOYER, flags, type(TideHook).creationCode, ctorArgs);

        (Currency c0, Currency c1) =
            USDC < WETH ? (Currency.wrap(USDC), Currency.wrap(WETH)) : (Currency.wrap(WETH), Currency.wrap(USDC));

        vm.startBroadcast(owner);
        TideHook hook = new TideHook{ salt: salt }(IPoolManager(POOL_MANAGER), params, owner);
        require(address(hook) == predicted, "hook address mismatch");
        params.setHook(address(hook)); // the hook claims its PoolId at initialize

        PoolKey memory key = PoolKey(c0, c1, LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(address(hook)));
        PoolId poolId = key.toId();
        // sqrtPrice is irrelevant for the custom curve; 1:1 keeps initialize happy
        IPoolManager(POOL_MANAGER).initialize(key, 79_228_162_514_264_337_593_543_950_336);
        params.setManager(PoolId.unwrap(poolId), agent);

        // liquidity: 0.2 WETH + 600 USDC through the hook
        uint256 wethAmt = 0.2e18;
        uint256 usdcAmt = 600e6;
        if (IERC20(WETH).balanceOf(owner) < wethAmt) IWETH(WETH).deposit{ value: wethAmt }();
        if (IERC20(USDC).balanceOf(owner) < usdcAmt) IMintable(USDC).mint(owner, usdcAmt * 2);
        IERC20(WETH).approve(address(hook), type(uint256).max);
        IERC20(USDC).approve(address(hook), type(uint256).max);
        (uint256 a0, uint256 a1) = Currency.unwrap(c0) == WETH ? (wethAmt, usdcAmt) : (usdcAmt, wethAmt);
        hook.addLiquidity(
            BaseCustomAccounting.AddLiquidityParams(a0, a1, 0, 0, type(uint256).max, -887_220, 887_220, 0)
        );
        vm.stopBroadcast();

        console.log("TideHook", address(hook));
        console.log("poolId");
        console.logBytes32(PoolId.unwrap(poolId));
        (uint256 r0, uint256 r1) = hook.reserves();
        console.log("reserves", r0, r1);

        string memory json = "hook";
        vm.serializeAddress(json, "tideHook", address(hook));
        vm.serializeAddress(json, "poolManager", POOL_MANAGER);
        vm.serializeAddress(json, "currency0", Currency.unwrap(c0));
        vm.serializeAddress(json, "currency1", Currency.unwrap(c1));
        string memory out = vm.serializeBytes32(json, "poolId", PoolId.unwrap(poolId));
        vm.writeJson(out, "deployments/11155111-hook.json");
    }
}

/// @notice One swap through the Sepolia pool: sell 0.01 WETH for USDC via a PoolSwapTest router.
///   forge script script/DeployHook.s.sol --tc SwapHook --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $OWNER_PRIVATE_KEY
contract SwapHook is Script {
    address internal constant POOL_MANAGER = 0xE03A1074c86CFeDd5C142C4F04F1a1536e203543;
    address internal constant WETH = 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;

    function run() external {
        string memory j = vm.readFile("deployments/11155111-hook.json");
        address hook = vm.parseJsonAddress(j, ".tideHook");
        address c0 = vm.parseJsonAddress(j, ".currency0");
        address c1 = vm.parseJsonAddress(j, ".currency1");
        address owner = vm.envAddress("OWNER_ADDRESS");
        PoolKey memory key =
            PoolKey(Currency.wrap(c0), Currency.wrap(c1), LPFeeLibrary.DYNAMIC_FEE_FLAG, 60, IHooks(hook));
        bool zeroForOne = c0 == WETH; // sell WETH

        uint256 amountIn = 0.01e18;
        uint256 quoted = TideHook(payable(hook)).quote(zeroForOne, true, amountIn);

        vm.startBroadcast(owner);
        PoolSwapTest router = new PoolSwapTest(IPoolManager(POOL_MANAGER));
        if (IERC20(WETH).balanceOf(owner) < amountIn) IWETH(WETH).deposit{ value: amountIn }();
        IERC20(WETH).approve(address(router), amountIn);
        BalanceDelta d = router.swap(
            key,
            SwapParams({
                zeroForOne: zeroForOne,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne
                    ? 4_295_128_740
                    : 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341
            }),
            PoolSwapTest.TestSettings({ takeClaims: false, settleUsingBurn: false }),
            ""
        );
        vm.stopBroadcast();
        int128 out = zeroForOne ? d.amount1() : d.amount0();
        console.log("quoted out", quoted);
        console.log("swap out  ", uint256(int256(out)));
        console.log("swap router", address(router));
    }
}

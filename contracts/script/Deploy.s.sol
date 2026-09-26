// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";

import { TideParams } from "../src/TideParams.sol";
import { TideRouter } from "../src/aqua/TideRouter.sol";
import { TideApp } from "../src/aqua/TideApp.sol";

/// @notice Deploys TideParams, TideRouter (redeployed AquaSwapVMRouter with Tide opcodes) and TideApp against
///         the official Aqua registry, which has the same address on every supported chain (mainnet, Sepolia).
///         Writes `deployments/<chainId>.json`.
///
///   forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --broadcast --private-key $OWNER_PRIVATE_KEY
contract Deploy is Script {
    address internal constant AQUA = 0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a;

    function run() external {
        address weth = _weth();
        vm.startBroadcast();
        TideParams params = new TideParams(IAqua(AQUA));
        TideRouter router = new TideRouter(AQUA, weth, msg.sender);
        TideApp app = new TideApp(IAqua(AQUA), address(router), params);
        params.setApp(address(app));
        vm.stopBroadcast();

        console.log("chainId   ", block.chainid);
        console.log("TideParams", address(params));
        console.log("TideRouter", address(router));
        console.log("TideApp   ", address(app));

        string memory json = "deploy";
        vm.serializeUint(json, "chainId", block.chainid);
        vm.serializeAddress(json, "aqua", AQUA);
        vm.serializeAddress(json, "weth", weth);
        vm.serializeAddress(json, "tideParams", address(params));
        vm.serializeAddress(json, "tideRouter", address(router));
        vm.serializeUint(json, "deployBlock", block.number); // the dashboard scans fills from here
        string memory out = vm.serializeAddress(json, "tideApp", address(app));
        vm.writeJson(out, string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }

    function _weth() internal view returns (address) {
        if (block.chainid == 1) return 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
        if (block.chainid == 11_155_111) return 0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14;
        if (block.chainid == 31_337) return 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2; // mainnet fork
        revert("unsupported chain");
    }
}

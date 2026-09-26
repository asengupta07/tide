// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Script, console } from "forge-std/Script.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { TideTaker } from "../src/aqua/TideTaker.sol";
import { TideApp } from "../src/aqua/TideApp.sol";

/// @notice Deploys TideTaker against the router and app in deployments/<chainId>.json and records it there.
contract DeployTaker is Script {
    function run() external {
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        string memory dep = vm.readFile(path);
        address aqua = vm.parseJsonAddress(dep, ".aqua");
        address router = vm.parseJsonAddress(dep, ".tideRouter");
        address app = vm.parseJsonAddress(dep, ".tideApp");
        vm.startBroadcast();
        TideTaker taker = new TideTaker(IAqua(aqua), router, TideApp(app));
        vm.stopBroadcast();
        console.log("TideTaker", address(taker));
        vm.writeJson(vm.toString(address(taker)), path, ".tideTaker");
    }
}

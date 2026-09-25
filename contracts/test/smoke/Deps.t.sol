// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";
import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { AquaSwapVMRouter } from "@1inch/swap-vm/routers/AquaSwapVMRouter.sol";
import { BaseCustomCurve } from "@openzeppelin/uniswap-hooks/src/base/BaseCustomCurve.sol";
import { IPoolManager } from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";

contract DepsTest is Test {
    function test_DeployRouter() public {
        Aqua aqua = new Aqua();
        AquaSwapVMRouter router = new AquaSwapVMRouter(address(aqua), address(0), address(this), "Tide", "1");
        assertEq(address(router.AQUA()), address(aqua));
    }
}

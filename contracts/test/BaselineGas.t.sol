// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import { TideAquaBase } from "./aqua/TideAquaBase.sol";
import { ISwapVM } from "@1inch/swap-vm/interfaces/ISwapVM.sol";
import { XYCSwap } from "@1inch/swap-vm/instructions/XYCSwap.sol";
import { Salt } from "@1inch/swap-vm/instructions/Controls.sol";
contract BaselineGasTest is TideAquaBase {
    function test_Gas_PlainXYC_vs_Tide() public {
        ISwapVM.Order memory plain = _buildOrder(bytes.concat(XYCSwap.build(), Salt.build(uint64(7))));
        address[] memory t = new address[](2); t[0] = address(tokenA); t[1] = address(tokenB);
        uint256[] memory a = new uint256[](2); a[0] = BAL_A; a[1] = BAL_B;
        vm.prank(maker); aqua.ship(address(router), abi.encode(plain), t, a);
        _swap(plain, 1e18, true, true);
        uint256 g0 = gasleft(); _swap(plain, 0.5e18, true, true); uint256 plainGas = g0 - gasleft();
        (ISwapVM.Order memory tide,) = _ship();
        _swap(tide, 1e18, true, true);
        g0 = gasleft(); _swap(tide, 0.5e18, true, true); uint256 tideSecond = g0 - gasleft();
        vm.roll(block.number + 1);
        g0 = gasleft(); _swap(tide, 0.5e18, true, true); uint256 tideFirst = g0 - gasleft();
        emit log_named_uint("plain XYCSwap fill gas (incl. taker + aqua)", plainGas);
        emit log_named_uint("Tide fill gas, first of block (re-split)", tideFirst);
        emit log_named_uint("Tide fill gas, later in block", tideSecond);
    }
}

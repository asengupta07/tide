// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Test } from "forge-std/Test.sol";

import { Aqua } from "@1inch/aqua/src/Aqua.sol";
import { IAqua } from "@1inch/aqua/src/interfaces/IAqua.sol";
import { TokenMock } from "@1inch/solidity-utils/contracts/mocks/TokenMock.sol";
import { ISwapVM } from "@1inch/swap-vm/interfaces/ISwapVM.sol";
import { TakerTraitsLib } from "@1inch/swap-vm/libs/TakerTraits.sol";
import { MakerTraitsLib } from "@1inch/swap-vm/libs/MakerTraits.sol";
import { MockTaker } from "@1inch/swap-vm-test/solidity/mocks/MockTaker.sol";

import { TideRouter } from "../../src/aqua/TideRouter.sol";
import { TideApp } from "../../src/aqua/TideApp.sol";
import { TideParams } from "../../src/TideParams.sol";

/// @dev Shared fixture: official Aqua registry, the redeployed TideRouter, TideParams, TideApp, two mock
///      tokens, a maker with inventory in their wallet, and a MockTaker that pushes tokenIn via Aqua.
abstract contract TideAquaBase is Test {
    uint256 internal constant BPS = 10_000;

    Aqua internal aqua;
    TideRouter internal router;
    TideParams internal params;
    TideApp internal app;
    TokenMock internal tokenA; // "WETH"-like, lower address
    TokenMock internal tokenB; // "USDC"-like, higher address
    MockTaker internal taker;

    address internal maker;
    uint256 internal makerKey;
    address internal manager;

    uint256 internal constant BAL_A = 100e18;
    uint256 internal constant BAL_B = 300_000e18;

    uint32 internal constant LAMBDA = 5000;
    uint32 internal constant N = 4;
    uint32 internal constant DELTA = 50;

    function setUp() public virtual {
        makerKey = 0x1234;
        maker = vm.addr(makerKey);
        manager = vm.addr(0x5678);

        aqua = new Aqua();
        router = new TideRouter(address(aqua), address(0), address(this));
        params = new TideParams(IAqua(address(aqua)));
        app = new TideApp(IAqua(address(aqua)), address(router), params);

        tokenA = new TokenMock("Wrapped Ether", "WETH");
        tokenB = new TokenMock("USD Coin", "USDC");
        if (address(tokenA) > address(tokenB)) (tokenA, tokenB) = (tokenB, tokenA);

        taker = new MockTaker(aqua, router, address(this));

        vm.label(address(aqua), "Aqua");
        vm.label(address(router), "TideRouter");
        vm.label(address(params), "TideParams");
        vm.label(maker, "maker");
        vm.label(address(taker), "taker");

        // Maker funds its own wallet and approves Aqua once; nothing is deposited anywhere.
        tokenA.mint(maker, BAL_A);
        tokenB.mint(maker, BAL_B);
        vm.startPrank(maker);
        tokenA.approve(address(aqua), type(uint256).max);
        tokenB.approve(address(aqua), type(uint256).max);
        vm.stopPrank();

        vm.roll(1000);
    }

    function _config(uint64 salt) internal view returns (TideApp.Config memory) {
        return TideApp.Config({ maker: maker, tokenA: address(tokenA), tokenB: address(tokenB), feeBps: 0, salt: salt });
    }

    /// @dev init params + ship. Returns the order and its hash (== Aqua strategy hash).
    function _ship(uint32 lambdaBps, uint32 n, uint32 deltaBps)
        internal
        returns (ISwapVM.Order memory order, bytes32 orderHash)
    {
        TideApp.Config memory cfg = _config(uint64(vm.randomUint()));
        order = app.order(cfg);
        orderHash = router.hash(order);
        assertEq(orderHash, app.orderHash(cfg), "hash helper");

        address[] memory tokens = new address[](2);
        tokens[0] = address(tokenA);
        tokens[1] = address(tokenB);
        uint256[] memory amounts = new uint256[](2);
        amounts[0] = BAL_A;
        amounts[1] = BAL_B;

        vm.startPrank(maker);
        params.init(orderHash, lambdaBps, n, deltaBps, manager);
        bytes32 strategyHash = aqua.ship(address(router), abi.encode(order), tokens, amounts);
        vm.stopPrank();
        assertEq(strategyHash, orderHash, "strategy hash == order hash");
    }

    function _ship() internal returns (ISwapVM.Order memory order, bytes32 orderHash) {
        return _ship(LAMBDA, N, DELTA);
    }

    function _takerData(bool isExactIn, bool isAToB) internal view returns (bytes memory) {
        return TakerTraitsLib.build(
            TakerTraitsLib.Args({
                taker: address(taker),
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

    function _quote(ISwapVM.Order memory order, uint256 amount, bool isExactIn, bool aToB)
        internal
        view
        returns (uint256 amountIn, uint256 amountOut)
    {
        (amountIn, amountOut,) = router.asView().quote(order, amount, _takerData(isExactIn, aToB));
    }

    /// @dev Mint tokenIn to the taker and fill. Maker already holds tokenOut in wallet.
    function _swap(ISwapVM.Order memory order, uint256 amount, bool isExactIn, bool aToB)
        internal
        returns (uint256 amountIn, uint256 amountOut)
    {
        (uint256 needIn,) = _quote(order, amount, isExactIn, aToB);
        TokenMock tokenIn = aToB ? tokenA : tokenB;
        tokenIn.mint(address(taker), needIn + 1);
        (amountIn, amountOut) = taker.swap(order, amount, _takerData(isExactIn, aToB));
    }

    function _aquaBalances(bytes32 orderHash) internal view returns (uint256 a, uint256 b) {
        return aqua.safeBalances(maker, address(router), orderHash, address(tokenA), address(tokenB));
    }

    /// @dev Aqua-mode order with an arbitrary program (negative program-order tests).
    function _buildOrder(bytes memory program) internal view returns (ISwapVM.Order memory) {
        return MakerTraitsLib.build(
            MakerTraitsLib.Args({
                maker: maker,
                receiver: address(0),
                tokenA: address(tokenA),
                tokenB: address(tokenB),
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

    function _xyc(uint256 amountIn, uint256 balIn, uint256 balOut) internal pure returns (uint256) {
        return amountIn * balOut / (balIn + amountIn);
    }
}

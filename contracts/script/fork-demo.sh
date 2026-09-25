#!/usr/bin/env bash
# Tide on 1inch Aqua, end to end on a mainnet fork with real WETH/USDC and the official Aqua registry.
# Requires MAINNET_RPC_URL in ../.env (or the environment).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f ../.env ] && set -a && . ../.env && set +a

RPC=http://127.0.0.1:8545
MAKER=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
WETH=0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2
USDC=0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48

if ! cast chain-id --rpc-url $RPC >/dev/null 2>&1; then
  echo "starting anvil fork of mainnet..."
  nohup anvil --fork-url "$MAINNET_RPC_URL" --chain-id 31337 --port 8545 --silent > /tmp/tide-anvil.log 2>&1 < /dev/null &
  sleep 6
fi

# Give the maker 100 WETH (balanceOf slot 3) and 350k USDC (FiatToken balances slot 9) on the fork.
slot() { cast keccak "$(cast abi-encode 'f(address,uint256)' "$1" "$2")"; }
cast rpc --rpc-url $RPC anvil_setStorageAt $WETH "$(slot $MAKER 3)" "$(cast to-uint256 100000000000000000000)" >/dev/null
cast rpc --rpc-url $RPC anvil_setStorageAt $USDC "$(slot $MAKER 9)" "$(cast to-uint256 350000000000)" >/dev/null
echo "maker WETH: $(cast call $WETH 'balanceOf(address)(uint256)' $MAKER --rpc-url $RPC)"
echo "maker USDC: $(cast call $USDC 'balanceOf(address)(uint256)' $MAKER --rpc-url $RPC)"

forge script script/ForkDemo.s.sol --tc ForkDemo --rpc-url $RPC --broadcast --unlocked --sender $MAKER "$@"

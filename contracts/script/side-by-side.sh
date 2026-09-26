#!/usr/bin/env bash
# Plain Aqua strategy vs Tide strategy, side by side on a mainnet fork: same maker, inventory, router,
# registry and price path; real fills through the official Aqua registry. Renders the receipts.
# Requires MAINNET_RPC_URL in ../.env. Flags are passed to the renderer (--fast skips the animation).
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

slot() { cast keccak "$(cast abi-encode 'f(address,uint256)' "$1" "$2")"; }
cast rpc --rpc-url $RPC anvil_setStorageAt $WETH "$(slot $MAKER 3)" "$(cast to-uint256 120000000000000000000)" >/dev/null
cast rpc --rpc-url $RPC anvil_setStorageAt $USDC "$(slot $MAKER 9)" "$(cast to-uint256 450000000000)" >/dev/null

echo "deploying router, params, app and bench on the fork; shipping two strategies; filling 8 blocks..."
forge script script/SideBySide.s.sol --tc SideBySide --rpc-url $RPC --broadcast --unlocked --sender $MAKER >/tmp/tide-sbs-forge.log 2>&1 || { tail -30 /tmp/tide-sbs-forge.log; exit 1; }
echo "done. rendering receipts."
python3 script/side_by_side.py "$@"

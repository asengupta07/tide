/** Client-side contract surface for the app (wagmi). Sepolia only. */
import { parseAbi, type Address } from "viem";
import tideParamsAbi from "@/abi/tide/TideParams.json";
import tideAppAbi from "@/abi/tide/TideApp.json";
import resolverAbi from "@/abi/ens/PermissionedResolverImpl.json";

export const ADDR = {
  aqua: "0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a" as Address,
  weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" as Address,
  usdc: "0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e" as Address,
  tideParams: "0xeDb9BC901D74382170CE603b23aFB5FD43d28176" as Address,
  tideRouter: "0x9A5883AA2068a133779cdaEB2b67Cc22f16b85B3" as Address,
  tideApp: "0x73080e4C38021c3fE51c93D677f05898Cc357682" as Address,
  agent: "0xedbA94c7292Aef84AC220E14ffF642aC4D749647" as Address,
};

export const erc20Abi = parseAbi([
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address a) view returns (uint256)",
  "function deposit() payable",
  "function mint(address to, uint256 amount)",
]);

export const aquaAbi = parseAbi([
  "function ship(address app, bytes strategy, address[] tokens, uint256[] amounts) returns (bytes32)",
  "function dock(address app, bytes32 strategyHash, address[] tokens)",
  "function rawBalances(address maker, address app, bytes32 strategyHash, address token) view returns (uint248, uint8)",
]);

export { tideParamsAbi, tideAppAbi, resolverAbi };

export const ORDER_TUPLE = [
  { type: "tuple", components: [{ name: "maker", type: "address" }, { name: "traits", type: "uint256" }, { name: "data", type: "bytes" }] },
] as const;

export const short = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");

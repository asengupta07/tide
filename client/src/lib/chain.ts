/** Client-side contract surface for the app (wagmi). Sepolia only. */
import { parseAbi, type Address } from "viem";
import tideParamsAbi from "@/abi/tide/TideParams.json";
import tideAppAbi from "@/abi/tide/TideApp.json";
import resolverAbi from "@/abi/ens/PermissionedResolverImpl.json";

export const ADDR = {
  aqua: "0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a" as Address,
  weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" as Address,
  usdc: "0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e" as Address,
  tideParams: "0x4608489C117E0719dD5cd88B58ED172A048344FF" as Address,
  tideRouter: "0xfDD5a4E385cc5082d1be12F215fa696a3c4B0957" as Address,
  tideApp: "0x246dbC0fd5FB6fF4De065f38Aa7B0dE1ea46705C" as Address,
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

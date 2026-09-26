/** Client-side contract surface for the app (wagmi). Sepolia only. */
import { parseAbi, type Address } from "viem";
import tideParamsAbi from "@/abi/tide/TideParams.json";
import tideAppAbi from "@/abi/tide/TideApp.json";
import tideTakerAbi from "@/abi/tide/TideTaker.json";
import resolverAbi from "@/abi/ens/PermissionedResolverImpl.json";
import { TOKENS } from "@/lib/tokens";

export const ADDR = {
  aqua: "0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a" as Address,
  weth: TOKENS.WETH.address,
  usdc: TOKENS.USDC.address,
  link: TOKENS.LINK.address,
  tideParams: "0x1685850e16Ea6A6D5f3fF6FBA824B4d834eb72aD" as Address,
  tideRouter: "0x65a22C65E24b78ea708DD420aEc29f7dce38a31e" as Address,
  tideApp: "0x47ba13504B02E0Bf40C3C80Bb2B1aa3dF8EDD12c" as Address,
  tideHook: "0x1391EC676d47884a1A4837Dc6F108aBfEf6cAA88" as Address,
  tideTaker: "0xd02dcc05b9a4834bf5f88f6d44aa590818791c98" as Address,
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

export { tideParamsAbi, tideAppAbi, tideTakerAbi, resolverAbi };

export const ORDER_TUPLE = [
  { type: "tuple", components: [{ name: "maker", type: "address" }, { name: "traits", type: "uint256" }, { name: "data", type: "bytes" }] },
] as const;

export const short = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  encodeFunctionData,
  decodeFunctionResult,
  parseAbi,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { packetToBytes, namehash } from "viem/ens";

import ethRegistryAbi from "@/abi/ens/ETHRegistry.json";
import userRegistryAbi from "@/abi/ens/UserRegistryImpl.json";
import resolverAbi from "@/abi/ens/PermissionedResolverImpl.json";
import factoryAbi from "@/abi/ens/VerifiableFactory.json";
import universalResolverAbi from "@/abi/ens/UniversalResolverV2.json";
import { ENS_SEPOLIA, ResolverRoles, type GovernedKey } from "./config";

export { ethRegistryAbi, userRegistryAbi, resolverAbi, factoryAbi, universalResolverAbi };

const textResolverAbi = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);

export function publicClient(rpcUrl = process.env.SEPOLIA_RPC_URL): PublicClient {
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
}

/** Accepts keys with or without the 0x prefix. */
export function normalizeKey(key: string): Hex {
  return (key.startsWith("0x") ? key : `0x${key}`) as Hex;
}

export function walletClient(privateKey: string, rpcUrl = process.env.SEPOLIA_RPC_URL): WalletClient & { account: Account } {
  const account = privateKeyToAccount(normalizeKey(privateKey));
  return createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) }) as WalletClient & { account: Account };
}

/** DNS-encoded name, what ENSv2 resolvers and the universal resolver take. */
export const dnsName = (name: string): Hex => toHex(packetToBytes(name));
export const labelhash = (label: string): bigint => BigInt(keccak256(toHex(label)));
/** EAC resource of a text key on a beta PermissionedResolver: keccak256(bytes(key)). */
export const textKeyResource = (key: string): bigint => BigInt(keccak256(toHex(key)));

/** Read a text record through the Universal Resolver (wildcard resolution off the parent). */
export async function readText(client: PublicClient, name: string, key: string): Promise<string> {
  const data = encodeFunctionData({ abi: textResolverAbi, functionName: "text", args: [namehash(name), key] });
  const [result] = (await client.readContract({
    address: ENS_SEPOLIA.universalResolver as Address,
    abi: universalResolverAbi,
    functionName: "resolve",
    args: [dnsName(name), data],
  })) as [Hex, Address];
  return decodeFunctionResult({ abi: textResolverAbi, functionName: "text", data: result }) as string;
}

/** Resolver address responsible for `name` (via the universal resolver). */
export async function findResolver(client: PublicClient, name: string): Promise<Address> {
  const [resolver] = (await client.readContract({
    address: ENS_SEPOLIA.universalResolver as Address,
    abi: universalResolverAbi,
    functionName: "findResolver",
    args: [dnsName(name)],
  })) as [Address, bigint, bigint];
  return resolver;
}

/** Calldata for `setText(dnsName, key, value)` on a beta PermissionedResolver. */
export function setTextCalldata(name: string, key: string, value: string): Hex {
  return encodeFunctionData({ abi: resolverAbi, functionName: "setText", args: [dnsName(name), key, value] });
}

/** Does `account` hold ROLE_SET_TEXT for `key` (or at root) on `resolver`? */
export async function canSetText(client: PublicClient, resolver: Address, key: string, account: Address) {
  return (await client.readContract({
    address: resolver,
    abi: resolverAbi,
    functionName: "hasRoles",
    args: [textKeyResource(key), ResolverRoles.SET_TEXT, account],
  })) as boolean;
}

export type StrategyRecords = Record<GovernedKey, string> & { strategyHash: string; venue: string };

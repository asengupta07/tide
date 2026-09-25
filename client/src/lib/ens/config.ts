/**
 * ENSv2 on Sepolia (beta deployment, contracts-v2 @ 71a3b733). The parent name `tide.eth` was registered
 * by the owner wallet in this ETHRegistry. Addresses are the ENS deployment table; nothing about a
 * strategy is hard-coded, every record is written and read on-chain.
 */
export const ENS_SEPOLIA = {
  chainId: 11155111,
  rootRegistry: "0x9703dbd26dab89504490994138cf2c575251a9ce",
  ethRegistry: "0x657ea849311d3d5823348dded7c2aaafb3ede09e",
  userRegistryImpl: "0xa80338aaa8d23831cea25e858d1774534abb0263",
  permissionedResolverImpl: "0x14f09fd05d4585759e54844dc9b00147131cf243",
  verifiableFactory: "0x9e726eb570beb6bceb495ab8cda7df517d4e841c",
  universalResolver: "0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe",
  universalResolverV2: "0x5d25c1d6acbb71b7a28aa7899618a3412a8303e3",
  mockUsdc: "0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e",
} as const;

/** RegistryRolesLib (beta). Nybble-packed: regular role at bit 4i, admin at bit 4i+128. */
export const RegistryRoles = {
  REGISTRAR: 1n << 0n,
  REGISTER_RESERVED: 1n << 4n,
  SET_PARENT: 1n << 8n,
  UNREGISTER: 1n << 12n,
  RENEW: 1n << 16n,
  SET_SUBREGISTRY: 1n << 20n,
  SET_RESOLVER: 1n << 24n,
  CAN_TRANSFER_ADMIN: (1n << 28n) << 128n,
  SET_URI: 1n << 36n,
  UPGRADE: 1n << 124n,
} as const;

/** PermissionedResolverLib (beta). Resource for a text key is keccak256(key). */
export const ResolverRoles = {
  SET_ADDRESS: 1n << 0n,
  SET_TEXT: 1n << 4n,
  SET_CONTENTHASH: 1n << 8n,
  SET_ABI: 1n << 12n,
  SET_INTERFACE: 1n << 16n,
  SET_NAME: 1n << 20n,
  SET_DATA: 1n << 24n,
  LINK: 1n << 28n,
  UPGRADE: 1n << 124n,
} as const;

export const admin = (role: bigint) => role << 128n;
export const withAdmin = (role: bigint) => role | admin(role);

/** The three governed records the manager agent may edit, and nothing else. */
export const GOVERNED_KEYS = ["lambda", "N", "delta"] as const;
export type GovernedKey = (typeof GOVERNED_KEYS)[number];

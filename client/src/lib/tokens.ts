import { getAddress, type Address } from "viem";

export type TokenMeta = {
  address: Address;
  symbol: string;
  name: string;
  decimals: number;
  usdProduct?: string;
};

export type MarketPair = {
  key: string;
  base: TokenMeta;
  quote: TokenMeta;
};

export const TOKENS = {
  WETH: { address: getAddress("0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"), symbol: "WETH", name: "Wrapped Ether", decimals: 18, usdProduct: "ETH-USD" },
  USDC: { address: getAddress("0x16f95D91DBa7dA3Aca778Ec053dF0FF6C6A8aA8e"), symbol: "USDC", name: "USD Coin", decimals: 6 },
  LINK: { address: getAddress("0x779877A7B0D9E8603169DdbD7836e478b4624789"), symbol: "LINK", name: "Chainlink", decimals: 18, usdProduct: "LINK-USD" },
} as const satisfies Record<string, TokenMeta>;

export const SUPPORTED_MARKETS: MarketPair[] = [
  { key: "weth-usdc", base: TOKENS.WETH, quote: TOKENS.USDC },
  { key: "link-usdc", base: TOKENS.LINK, quote: TOKENS.USDC },
];

export function tokenMeta(address: string): TokenMeta {
  return Object.values(TOKENS).find((token) => token.address.toLowerCase() === address.toLowerCase())
    ?? { address: getAddress(address), symbol: `${address.slice(0, 6)}…${address.slice(-4)}`, name: "ERC-20 token", decimals: 18 };
}

export function marketKey(tokenA: string, tokenB: string) {
  return [tokenA.toLowerCase(), tokenB.toLowerCase()].sort().join(":");
}

export function marketForTokens(tokenA: string, tokenB: string): MarketPair | null {
  const key = marketKey(tokenA, tokenB);
  return SUPPORTED_MARKETS.find((market) => marketKey(market.base.address, market.quote.address) === key) ?? null;
}

export function sortedTokens(pair: MarketPair): [Address, Address] {
  return pair.base.address.toLowerCase() < pair.quote.address.toLowerCase()
    ? [pair.base.address, pair.quote.address]
    : [pair.quote.address, pair.base.address];
}

/** Shared by market discovery and direct links. Unknown chain state fails closed. */
export function isTradeReady(
  owner: string,
  params: { owner: string; N: number; lambda: number } | null,
  block: { total: { tokenA?: string; tokenB?: string; weth?: string; usdc?: string } } | null,
): boolean {
  if (!params || params.owner.toLowerCase() !== owner.toLowerCase() || !(params.N > 0) || !(params.lambda > 0) || !block) return false;
  try {
    const a = block.total.tokenA ?? block.total.weth ?? "0";
    const b = block.total.tokenB ?? block.total.usdc ?? "0";
    return BigInt(a) > 0n && BigInt(b) > 0n;
  }
  catch { return false; }
}

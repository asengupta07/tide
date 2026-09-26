/** Shared by market discovery and direct links. Unknown chain state fails closed. */
export function isTradeReady(
  owner: string,
  params: { owner: string; N: number; lambda: number } | null,
  block: { total: { weth: string; usdc: string } } | null,
): boolean {
  if (!params || params.owner.toLowerCase() !== owner.toLowerCase() || !(params.N > 0) || !(params.lambda > 0) || !block) return false;
  try { return BigInt(block.total.weth) > 0n && BigInt(block.total.usdc) > 0n; }
  catch { return false; }
}

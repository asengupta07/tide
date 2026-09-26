/** Largest delta the fee backs at depth N: (N - 1) * delta <= 2 * fee (TideMath.checkParams). Browser-safe. */
export function maxDeltaBps(N: number, feeBps: number) {
  return N <= 1 ? 4999 : Math.floor((2 * feeBps) / (N - 1));
}

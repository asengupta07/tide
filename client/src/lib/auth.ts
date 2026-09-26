/**
 * Owner proof for backend actions that spend the operator's gas or move a strategy: the owner's wallet signs
 * `Tide: <action> at <ts>` (EIP-191), the route verifies the signature against the strategy's owner and a
 * ten-minute window. Same message builder on the client (wagmi signMessage) and the server.
 */
import { getAddress, verifyMessage, type Address, type Hex } from "viem";

export const SIG_WINDOW_MS = 10 * 60_000;

export const ownerMessage = (action: string, ts: number) => `Tide: ${action} at ${ts}`;

export class OwnerAuthError extends Error {}

/** Throws OwnerAuthError unless `sig` is `owner`'s fresh signature of `ownerMessage(action, ts)`. */
export async function requireOwner(owner: string, action: string, ts: unknown, sig: unknown) {
  const t = Number(ts);
  if (!/^0x[0-9a-fA-F]{130}$/.test(String(sig ?? "")) || !Number.isFinite(t)) throw new OwnerAuthError("wallet signature required");
  if (Math.abs(Date.now() - t) > SIG_WINDOW_MS) throw new OwnerAuthError("signature expired, sign again");
  const ok = await verifyMessage({ address: getAddress(owner) as Address, message: ownerMessage(action, t), signature: sig as Hex });
  if (!ok) throw new OwnerAuthError("signature does not match the strategy owner");
}

/** Error text safe to show and store: first line, provider URLs (which carry API keys) removed. */
export function safeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.split("\n")[0].replace(/https?:\/\/\S+/g, "<rpc>").slice(0, 300);
}

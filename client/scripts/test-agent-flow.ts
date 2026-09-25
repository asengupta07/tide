/**
 * Exercises the agent's control flow without a real World ID client: the discovery document is fetched
 * from the sandbox, a proposal is created, then the callback is driven through the denied and the
 * unknown-state paths. Asserts that no write happened and the proposal is blocked.
 *   pnpm tsx --env-file=../.env scripts/test-agent-flow.ts
 */
process.env.WORLD_CLIENT_ID ||= "placeholder-for-local-test";
process.env.WORLD_CLIENT_SECRET ||= "placeholder";
process.env.WORLD_APPROVAL_TIMEOUT_SECONDS = "1";

import assert from "node:assert/strict";
import { propose, handleCallback, currentRecords } from "../src/lib/agent";
import { load, update, expireStale } from "../src/lib/store";

async function main() {
  const before = await currentRecords();
  console.log("records before:", before);

  // 1. proposal + step-up URL
  const p = await propose(0.8);
  assert.equal(p.status, "pending");
  assert.ok(p.approvalUrl?.includes("prompt=login") && p.approvalUrl?.includes("max_age=0"), "step-up must demand fresh auth");
  assert.ok(p.approvalUrl?.startsWith("https://sandbox.auth.world.org/api/v1/authorize?"), "official dev environment");
  console.log("proposal", p.id, p.reason);

  // 2. denied path: the human cancels in World; OIDC returns error=access_denied
  const r1 = await handleCallback(new URLSearchParams({ state: p.authState!, error: "access_denied", error_description: "user cancelled" }));
  assert.equal(r1.proposal?.status, "blocked");
  console.log("denied ->", r1.proposal?.status, "|", r1.proposal?.blockedReason);

  // 3. replay of the same state must not be accepted
  const r2 = await handleCallback(new URLSearchParams({ state: p.authState!, code: "whatever" }));
  assert.equal(r2.error, "unknown state");
  console.log("replayed state ->", r2.error);

  // 4. expired path: a pending proposal whose window elapsed is blocked with nothing written
  const p2 = await propose(0.3);
  await new Promise((r) => setTimeout(r, 1200));
  update((s) => expireStale(s));
  const st = load().proposals.find((x) => x.id === p2.id)!;
  assert.equal(st.status, "expired");
  console.log("timed out ->", st.status, "|", st.blockedReason);

  // 5. a forged code on a pending proposal fails token exchange and is blocked
  const p3 = await propose(1.0);
  const r3 = await handleCallback(new URLSearchParams({ state: p3.authState!, code: "forged-code" }));
  assert.equal(r3.proposal?.status, "blocked");
  console.log("forged code ->", r3.proposal?.status, "|", r3.proposal?.blockedReason);

  const after = await currentRecords();
  assert.deepEqual(after, before, "records must be unchanged after every denied path");
  console.log("records unchanged ✓");
}
main().catch((e) => {
  console.error("FAIL", e);
  process.exit(1);
});

import assert from "node:assert/strict";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  PublicationInput,
  TemplateConfig,
  publicationAction,
} from "../src/lib/sharing";
import { ownerMessage, requireOwner, SIG_WINDOW_MS } from "../src/lib/auth";

async function main() {
  const config = {
    lambda: 5000,
    N: 4,
    delta: 20,
    fee: 30,
    bounds: {
      lambdaMin: 1000,
      lambdaMax: 9000,
      nMax: 8,
      maxStepBps: 2500,
      cooldown: 3600,
    },
  };
  assert.equal(TemplateConfig.safeParse(config).success, true);
  for (const invalid of [
    { ...config, delta: 21 },
    { ...config, N: 65 },
    { ...config, fee: -1 },
    { ...config, lambda: 0 },
    { ...config, bounds: { ...config.bounds, lambdaMin: 9500 } },
    { ...config, bounds: { ...config.bounds, cooldown: 0 } },
  ]) {
    assert.equal(TemplateConfig.safeParse(invalid).success, false);
  }
  const input = PublicationInput.parse({
    kind: "template",
    published: true,
    title: "Balanced depth",
    description: "A saved example with bounded depth and drift.",
    config,
  });
  assert.equal(
    PublicationInput.safeParse({ ...input, config: undefined }).success,
    false,
  );
  assert.equal(
    PublicationInput.safeParse({
      ...input,
      published: false,
      config: undefined,
    }).success,
    true,
  );
  const owner = privateKeyToAccount(generatePrivateKey());
  const stranger = privateKeyToAccount(generatePrivateKey());
  const ts = Date.now();
  const action = publicationAction("test-strategy", 0, input);
  const sig = await owner.signMessage({ message: ownerMessage(action, ts) });
  await requireOwner(owner.address, action, ts, sig);
  await assert.rejects(requireOwner(stranger.address, action, ts, sig));
  await assert.rejects(
    requireOwner(
      owner.address,
      publicationAction("other-strategy", 0, input),
      ts,
      sig,
    ),
  );
  await assert.rejects(
    requireOwner(
      owner.address,
      publicationAction("test-strategy", 1, input),
      ts,
      sig,
    ),
  );
  for (const changed of [
    { ...input, published: false },
    { ...input, title: "Changed title" },
    { ...input, description: "An altered description." },
    { ...input, config: { ...config, lambda: 6000 } },
  ]) {
    await assert.rejects(
      requireOwner(
        owner.address,
        publicationAction("test-strategy", 0, changed),
        ts,
        sig,
      ),
    );
  }
  const old = ts - SIG_WINDOW_MS - 1000;
  await assert.rejects(
    requireOwner(
      owner.address,
      action,
      old,
      await owner.signMessage({ message: ownerMessage(action, old) }),
    ),
  );
  const snapshot = JSON.parse(JSON.stringify(input));
  config.lambda = 8000;
  assert.equal(snapshot.config.lambda, 5000);
  console.log(
    "Sharing checks passed: parameter bounds, solvency, required snapshots, owner signatures, content/target/revision tampering, expiry, snapshot isolation.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

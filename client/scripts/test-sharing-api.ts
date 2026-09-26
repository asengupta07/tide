/** Exercises real route handlers with an isolated in-memory collection; never writes the configured database. */
import assert from "node:assert/strict";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ownerMessage } from "../src/lib/auth";
import { publicationAction, type PublicationInput } from "../src/lib/sharing";
import type { MongoClient } from "mongodb";

type Doc = Record<string, unknown>;
const queries: { name: string; query: Doc }[] = [];
const data: Record<string, Doc[]> = { strategies: [], publications: [] };
function matches(row: Doc, query: Doc): boolean {
  return Object.entries(query).every(([key, value]) => {
    if (key === "$or") return (value as Doc[]).some((q) => matches(row, q));
    if (typeof value === "object" && value !== null) {
      const v = value as Doc;
      if (v.$regex)
        return new RegExp(String(v.$regex), String(v.$options ?? "")).test(
          String(row[key]),
        );
      if (v.$in) return (v.$in as unknown[]).includes(row[key]);
    }
    return row[key] === value;
  });
}
const mock = {
  db: () => ({
    collection: (name: string) => ({
      findOne: async (q: Doc) => data[name].find((r) => matches(r, q)) ?? null,
      find: (q: Doc) => {
        queries.push({ name, query: structuredClone(q) });
        const cursor = {
          sort: () => cursor,
          toArray: async () =>
            structuredClone(data[name].filter((r) => matches(r, q))),
        };
        return cursor;
      },
      insertOne: async (row: Doc) => {
        if (data[name].some((r) => r.id === row.id))
          throw Object.assign(new Error("duplicate"), { code: 11000 });
        data[name].push(structuredClone(row));
      },
      replaceOne: async (q: Doc, row: Doc) => {
        const i = data[name].findIndex((r) => matches(r, q));
        if (i < 0) return { matchedCount: 0 };
        data[name][i] = structuredClone(row);
        return { matchedCount: 1 };
      },
    }),
  }),
};
const g = globalThis as unknown as {
  __tideMongo: Promise<MongoClient>;
  __tideIndexes: Promise<void>;
};
g.__tideMongo = Promise.resolve(mock as unknown as MongoClient);
g.__tideIndexes = Promise.resolve();

async function main() {
  const sharing = await import("../src/app/api/strategy/[name]/sharing/route");
  const explore = await import("../src/app/api/publications/route");
  const detail = await import("../src/app/api/publications/[id]/route");
  const owner = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  data.strategies.push({
    label: "test-strategy",
    name: "test-strategy.tide.eth",
    owner: owner.address,
    tokenA: "0x1",
    tokenB: "0x2",
  });
  const ctx = { params: Promise.resolve({ name: "test-strategy" }) };
  const input: PublicationInput = {
    kind: "template",
    published: true,
    title: "Test snapshot",
    description: "An isolated test snapshot.",
    config: {
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
    },
  };
  async function request(revision: number, value = input, account = owner) {
    const ts = Date.now();
    const sig = await account.signMessage({
      message: ownerMessage(
        publicationAction("test-strategy", revision, value),
        ts,
      ),
    });
    return new Request("http://localhost/api/strategy/test-strategy/sharing", {
      method: "POST",
      body: JSON.stringify({ input: value, revision, ts, sig }),
    });
  }
  assert.deepEqual(
    await (await explore.GET()).json(),
    [],
    "Existing strategies stay unlisted",
  );
  assert.equal(
    (await sharing.POST(await request(0, input, other), ctx)).status,
    401,
  );
  const initial = await request(0);
  const replay = initial.clone();
  assert.equal((await sharing.POST(initial, ctx)).status, 200);
  assert.equal(
    (await sharing.POST(replay, ctx)).status,
    409,
    "Replay must not republish",
  );
  assert.equal((await (await explore.GET()).json()).length, 1);
  const detailCtx = {
    params: Promise.resolve({ id: "test-strategy-template" }),
  };
  const snapshot = await (
    await detail.GET(new Request("http://localhost"), detailCtx)
  ).json();
  assert.equal(snapshot.config.lambda, 5000);
  const hide = { ...input, published: false };
  assert.equal((await sharing.POST(await request(1, hide), ctx)).status, 200);
  assert.deepEqual(await (await explore.GET()).json(), []);
  assert.equal(
    (await detail.GET(new Request("http://localhost"), detailCtx)).status,
    404,
  );
  const metadata = await (
    await sharing.GET(new Request("http://localhost"), ctx)
  ).json();
  assert.deepEqual(
    metadata,
    [{ kind: "template", published: false, revision: 2 }],
    "Unpublished content must be omitted",
  );
  assert.equal(
    (await sharing.POST(await request(1), ctx)).status,
    409,
    "Stale updates rejected",
  );
  assert.equal((await sharing.POST(await request(2), ctx)).status, 200);
  const updated = { ...input, config: { ...input.config!, lambda: 6000 } };
  assert.equal(
    (await sharing.POST(await request(3, updated), ctx)).status,
    200,
  );
  assert.equal(
    (
      await (
        await detail.GET(new Request("http://localhost"), detailCtx)
      ).json()
    ).config.lambda,
    6000,
  );
  assert.equal(
    snapshot.config.lambda,
    5000,
    "Previously loaded snapshots stay unchanged",
  );
  const live: PublicationInput = {
    ...input,
    kind: "strategy",
    config: undefined,
  };
  assert.equal((await sharing.POST(await request(0, live), ctx)).status, 200);
  assert.equal(
    (await (await explore.GET()).json()).length,
    2,
    "Live and template publications are independent",
  );
  const races = await Promise.all([
    request(1, live),
    request(1, { ...live, published: false }),
  ]);
  const results = await Promise.all(races.map((req) => sharing.POST(req, ctx)));
  assert.deepEqual(
    results.map((r) => r.status).sort(),
    [200, 409],
    "Only one concurrent revision may win",
  );
  const strategies = await import("../src/app/api/strategies/route");
  assert.deepEqual(
    await (
      await strategies.GET(new Request("http://localhost/api/strategies"))
    ).json(),
    [],
    "No wallet never returns a global list",
  );
  assert.equal(
    (
      await strategies.GET(
        new Request("http://localhost/api/strategies?owner=invalid"),
      )
    ).status,
    400,
  );
  assert.deepEqual(
    await (
      await strategies.GET(
        new Request(`http://localhost/api/strategies?owner=${other.address}`),
      )
    ).json(),
    [],
    "Other wallets do not see the fixture owner's strategies",
  );
  // Inspect the registry selection without invoking an external ENS RPC for enrichment.
  data.strategies.length = 0;
  const liveRow = data.publications.find((p) => p.kind === "strategy")!;
  liveRow.published = true;
  data.publications.push({
    ...liveRow,
    id: "hidden-strategy",
    label: "hidden",
    published: false,
  });
  data.publications.push({
    ...liveRow,
    id: "template-only-template",
    label: "template-only",
    kind: "template",
  });
  await strategies.GET(
    new Request("http://localhost/api/strategies?scope=public"),
  );
  const selection = queries
    .filter((q) => q.name === "strategies")
    .at(-1)!.query;
  assert.equal(matches({ label: "test-strategy" }, selection), true);
  assert.equal(matches({ label: "hidden" }, selection), false);
  assert.equal(matches({ label: "template-only" }, selection), false);
  liveRow.published = false;
  await strategies.GET(
    new Request("http://localhost/api/strategies?scope=public"),
  );
  assert.equal(
    matches(
      { label: "test-strategy" },
      queries.filter((q) => q.name === "strategies").at(-1)!.query,
    ),
    false,
    "Unpublishing removes trading discovery too",
  );
  console.log(
    "API checks passed: default unlisted, owner authorization, publish, replay rejection, Explore, template retrieval, unpublish, redaction, stale revision rejection, republish, explicit snapshot update.",
  );
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

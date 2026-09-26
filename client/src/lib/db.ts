/**
 * MongoDB for everything the backend keeps off-chain: the strategy index, the manager's proposals, pending
 * OIDC requests, World ID bindings, the agent log and the ENS setup state. Connection string in MONGODB_URI
 * (database name in its path). One client per process, cached on globalThis so Next's dev reloads reuse it.
 */
import { MongoClient, type Db, type Document } from "mongodb";

const g = globalThis as unknown as { __tideMongo?: Promise<MongoClient>; __tideIndexes?: Promise<void> };

export function mongo(): Promise<MongoClient> {
  if (!g.__tideMongo) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI missing");
    g.__tideMongo = new MongoClient(uri, { maxPoolSize: 5 }).connect();
  }
  return g.__tideMongo;
}

export async function db(): Promise<Db> {
  const d = (await mongo()).db();
  if (!g.__tideIndexes) {
    g.__tideIndexes = (async () => {
      await d.collection("publications").createIndex({ id: 1 }, { unique: true });
      await d.collection("publications").createIndex({ published: 1, updatedAt: -1 });
      await d.collection("strategies").createIndex({ label: 1 }, { unique: true });
      await d.collection("proposals").createIndex({ id: 1 }, { unique: true });
      await d.collection("proposals").createIndex({ strategy: 1, createdAt: -1 });
      await d.collection("authRequests").createIndex({ state: 1 }, { unique: true });
      await d.collection("authRequests").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await d.collection("bound").createIndex({ owner: 1 }, { unique: true });
      await d.collection("log").createIndex({ at: -1 });
      await d.collection("log").createIndex({ strategy: 1, at: -1 });
      await d.collection("ens").createIndex({ parent: 1 }, { unique: true });
    })().catch((e) => {
      g.__tideIndexes = undefined;
      throw e;
    });
  }
  await g.__tideIndexes;
  return d;
}

export async function col<T extends Document>(name: string) {
  return (await db()).collection<T>(name);
}

/** Drop Mongo's `_id` from a read. */
export function clean<T extends Document>(doc: (T & { _id?: unknown }) | null): T | null {
  if (!doc) return null;
  const { _id: _drop, ...rest } = doc;
  void _drop;
  return rest as T;
}

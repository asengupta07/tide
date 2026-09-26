"use client";
import { useEffect, useState } from "react";
import { useSignMessage } from "wagmi";
import Link from "next/link";
import { Bezel } from "./ui";
import { ownerMessage } from "@/lib/auth";
import {
  PublicationInput,
  publicationAction,
  type Publication,
  type TemplateConfig,
} from "@/lib/sharing";

type State = Partial<Publication> & {
  kind: "strategy" | "template";
  revision: number;
  published: boolean;
};
export function StrategySharing({
  label,
  name,
  config,
}: {
  label: string;
  name: string;
  config: TemplateConfig | null;
}) {
  const { signMessageAsync } = useSignMessage();
  const [rows, setRows] = useState<State[] | null>(null);
  const [kind, setKind] = useState<"strategy" | "template">("strategy");
  const [title, setTitle] = useState(name);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    fetch(`/api/strategy/${label}/sharing`, {
      cache: "no-store",
      signal: c.signal,
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        return j;
      })
      .then((j: State[]) => {
        setRows(j);
        const p = j.find((p) => p.kind === "strategy");
        setTitle(p?.title ?? name);
        setDescription(p?.description ?? "");
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [label, name, attempt]);
  const current = rows?.find((p) => p.kind === kind);
  function select(next: "strategy" | "template") {
    const p = rows?.find((p) => p.kind === next);
    setKind(next);
    setTitle(p?.title ?? name);
    setDescription(p?.description ?? "");
    setNotice("");
    setError("");
  }
  async function save(published: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const input = PublicationInput.parse({
        kind,
        published,
        title: published ? title : (current?.title ?? name),
        description: published
          ? description
          : (current?.description ?? "Removed from Explore"),
        ...(kind === "template"
          ? { config: published ? (config ?? undefined) : current?.config }
          : {}),
      });
      const revision = current?.revision ?? 0;
      const ts = Date.now();
      const sig = await signMessageAsync({
        message: ownerMessage(publicationAction(label, revision, input), ts),
      });
      const r = await fetch(`/api/strategy/${label}/sharing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input, revision, ts, sig }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setRows((prev) => [...(prev ?? []).filter((p) => p.kind !== kind), j]);
      setNotice(
        published
          ? `${kind === "template" ? "Template" : "Strategy"} published to Explore.`
          : "Removed from Explore. Existing copies and on-chain records remain available.",
      );
    } catch (e) {
      setError((e as Error).message.split("\n")[0]);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Bezel small className="mt-8">
      <section id="sharing" className="scroll-mt-28 p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-accent">
              Share on your terms
            </div>
            <h2 className="mt-2 text-2xl font-semibold">
              Keep it yours. Or pass it on.
            </h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-2">
              Unlisted by default. Publish a live strategy to Explore, or share
              a saved template others can use with their own wallets.
            </p>
          </div>
          <span className="rounded-full border border-white/15 px-3 py-1 text-xs text-fg-2">
            {rows === null
              ? "Loading…"
              : rows.some((p) => p.kind === "strategy" && p.published)
                ? "Strategy shared"
                : "Strategy unlisted"}
          </span>
        </div>
        <div
          className="mt-6 flex gap-4"
          role="group"
          aria-label="What to share"
        >
          {(["strategy", "template"] as const).map((k) => (
            <button
              key={k}
              disabled={busy || rows === null}
              aria-pressed={kind === k}
              onClick={() => select(k)}
              className={`border-b-2 pb-2 text-sm ${kind === k ? "border-accent text-fg" : "border-transparent text-fg-3"}`}
            >
              {k === "strategy" ? "Live strategy" : "Reusable template"}
            </button>
          ))}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-fg-3">
          {kind === "template"
            ? "Publishing saves the current on-chain parameters and guardrails. Future strategy changes do not change this template unless you publish a new snapshot. Wallet ownership, balances, and agent permissions are never copied."
            : "A live view links to this strategy’s current dashboard. Anyone with its link can already view it; publishing also lists it in Explore."}
        </p>
        <div className="mt-5 grid gap-5 md:grid-cols-[1fr_1.5fr]">
          <label className="text-sm">
            Title
            <input
              disabled={busy || rows === null}
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 outline-none focus:border-accent"
            />
          </label>
          <label className="text-sm">
            Context & tradeoffs
            <textarea
              disabled={busy || rows === null}
              maxLength={600}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this configuration designed for? Explain the choices and tradeoffs."
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 outline-none focus:border-accent"
            />
          </label>
        </div>
        {kind === "template" && config && (
          <p className="mt-3 text-xs text-fg-2">
            Snapshot: {config.lambda / 100}% exposure · {config.N}× depth ·{" "}
            {config.delta / 100}% drift · {config.fee / 100}% fee. Guardrails:{" "}
            {config.bounds.lambdaMin / 100}–{config.bounds.lambdaMax / 100}%
            exposure, depth up to {config.bounds.nMax}×,{" "}
            {config.bounds.maxStepBps / 100} point maximum step,{" "}
            {config.bounds.cooldown}s cooldown.
          </p>
        )}
        {kind === "template" && !config && (
          <p className="mt-3 text-xs text-warn">
            Finish initializing your strategy and load its on-chain settings
            before publishing a template.
          </p>
        )}
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <button
            onClick={() => save(true)}
            disabled={
              busy ||
              rows === null ||
              title.trim().length < 3 ||
              description.trim().length < 10 ||
              (kind === "template" && !config)
            }
            className="pill pill-primary disabled:opacity-40"
          >
            {busy
              ? "Waiting for wallet…"
              : current?.published
                ? kind === "template"
                  ? "Publish new snapshot"
                  : "Update publication"
                : kind === "template"
                  ? "Publish template"
                  : "Publish strategy"}
          </button>
          {current?.published && (
            <>
              <button
                disabled={busy}
                onClick={() => save(false)}
                className="text-sm text-fg-2 disabled:opacity-40"
              >
                Unpublish
              </button>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `${location.origin}${kind === "template" ? `/app/new?template=${label}-template` : `/app/${label}`}`,
                    );
                    setNotice("Link copied.");
                  } catch {
                    setError(
                      "Could not copy the link. Open the published page and copy its address.",
                    );
                  }
                }}
                className="text-sm text-accent"
              >
                Copy link
              </button>
              <Link
                className="text-sm text-accent"
                href={`/app/explore${kind === "template" ? "?tab=templates" : ""}`}
              >
                View in Explore ↗
              </Link>
            </>
          )}
        </div>
        {notice && (
          <p role="status" className="mt-4 text-sm text-accent">
            {notice}
          </p>
        )}
        {error && (
          <div role="alert" className="mt-4 text-sm text-bad">
            {error}
            <button
              className="ml-3 text-accent"
              disabled={busy}
              onClick={() => setAttempt((a) => a + 1)}
            >
              Reload publishing settings
            </button>
          </div>
        )}
        <p className="mt-5 text-xs text-fg-3">
          Publishing requires your wallet signature. Unpublishing removes
          discovery; it cannot erase ENS records, on-chain history, or templates
          already copied.
        </p>
      </section>
    </Bezel>
  );
}

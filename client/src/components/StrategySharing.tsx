"use client";
import { useEffect, useState } from "react";
import { useSignMessage } from "wagmi";
import Link from "next/link";
import { ArrowUpRight, ArrowRight, Copy, CircleNotch, EyeSlash } from "@phosphor-icons/react";
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
  const publishLabel = busy
    ? "Waiting for wallet…"
    : current?.published
      ? kind === "template"
        ? "Publish new snapshot"
        : "Update publication"
      : kind === "template"
        ? "Publish template"
        : "Publish strategy";
  const shareUrl = kind === "template" ? `/app/new?template=${label}-template` : `/app/${label}`;
  return (
    <Bezel small className="mt-8">
      <section id="sharing" className="scroll-mt-28 p-6 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-accent">Share on your terms</div>
            <h2 className="mt-2 text-2xl font-semibold">Keep it yours. Or pass it on.</h2>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-fg-2">
              Unlisted by default. Publish a live strategy to Explore, or share a saved template others can use
              with their own wallets.
            </p>
          </div>
          <span
            className={`inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs ${
              rows?.some((p) => p.kind === "strategy" && p.published)
                ? "border-accent/40 text-accent"
                : "border-white/15 text-fg-2"
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${rows?.some((p) => p.kind === "strategy" && p.published) ? "bg-accent" : "bg-fg-3"}`} />
            {rows === null ? "Loading…" : rows.some((p) => p.kind === "strategy" && p.published) ? "Listed in Explore" : "Unlisted"}
          </span>
        </div>

        <div className="mt-7 inline-flex rounded-full border border-white/10 bg-white/[0.03] p-1" role="group" aria-label="What to share">
          {(["strategy", "template"] as const).map((k) => (
            <button
              key={k}
              disabled={busy || rows === null}
              aria-pressed={kind === k}
              onClick={() => select(k)}
              className={`h-8 rounded-full px-4 text-sm transition-colors ${kind === k ? "bg-white/[0.08] text-fg" : "text-fg-3 hover:text-fg-2"}`}
            >
              {k === "strategy" ? "Live strategy" : "Reusable template"}
            </button>
          ))}
        </div>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-fg-3">
          {kind === "template"
            ? "Publishing saves the current on-chain parameters and guardrails. Later changes to the strategy do not change this template unless you publish a new snapshot. Wallet ownership, balances and agent permissions are never copied."
            : "A live view links to this strategy’s dashboard. Anyone with the link can already view it; publishing also lists it in Explore."}
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-[1fr_1.6fr]">
          <label className="block text-sm">
            <span className="text-fg-2">Title</span>
            <input
              disabled={busy || rows === null}
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-2 w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-fg outline-none focus:border-accent disabled:opacity-50"
            />
            <span className="mt-1.5 block text-xs text-fg-3">{title.trim().length}/80</span>
          </label>
          <label className="block text-sm">
            <span className="text-fg-2">Context and trade-offs</span>
            <textarea
              disabled={busy || rows === null}
              maxLength={600}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What is this configuration for? Say what you chose and what it costs."
              className="mt-2 w-full resize-y rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-fg outline-none focus:border-accent disabled:opacity-50"
            />
            <span className="mt-1.5 block text-xs text-fg-3">{description.trim().length}/600, at least 10</span>
          </label>
        </div>

        {kind === "template" && config && (
          <dl className="num mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm sm:grid-cols-4 lg:grid-cols-8">
            {(
              [
                ["Visible", `${config.lambda / 100}%`],
                ["Depth", `${config.N}×`],
                ["Band", `${config.delta / 100}%`],
                ["Fee", `${config.fee / 100}%`],
                ["Rails", `${config.bounds.lambdaMin / 100}–${config.bounds.lambdaMax / 100}%`],
                ["Max depth", `${config.bounds.nMax}×`],
                ["Max step", `${config.bounds.maxStepBps / 100} pts`],
                ["Cooldown", config.bounds.cooldown % 3600 === 0 ? `${config.bounds.cooldown / 3600} h` : `${Math.round(config.bounds.cooldown / 60)} min`],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wider text-fg-3">{k}</dt>
                <dd className="mt-0.5 text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {kind === "template" && !config && (
          <p className="mt-4 text-xs text-warn">Finish initialising your strategy and load its on-chain settings before publishing a template.</p>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            onClick={() => save(true)}
            disabled={busy || rows === null || title.trim().length < 3 || description.trim().length < 10 || (kind === "template" && !config)}
            className="pill pill-primary pill-sm disabled:opacity-40"
          >
            <span>{publishLabel}</span>
            <span className="ico">{busy ? <CircleNotch size={13} className="animate-spin" /> : <ArrowUpRight size={13} />}</span>
          </button>
          {current?.published && (
            <>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`${location.origin}${shareUrl}`);
                    setNotice("Link copied.");
                  } catch {
                    setError("Could not copy the link. Open the published page and copy its address.");
                  }
                }}
                className="pill pill-ghost pill-sm"
              >
                <span>Copy link</span>
                <span className="ico"><Copy size={13} /></span>
              </button>
              <Link className="pill pill-ghost pill-sm" href={`/app/explore${kind === "template" ? "?tab=templates" : ""}`}>
                <span>View in Explore</span>
                <span className="ico"><ArrowRight size={13} /></span>
              </Link>
              <button
                disabled={busy}
                onClick={() => save(false)}
                className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-fg-3 transition-colors hover:text-bad disabled:opacity-40"
              >
                <EyeSlash size={14} />
                Unpublish
              </button>
            </>
          )}
        </div>
        {notice && (
          <p role="status" className="mt-4 text-sm text-accent">{notice}</p>
        )}
        {error && (
          <div role="alert" className="mt-4 text-sm text-bad">
            {error}
            <button className="ml-3 text-accent" disabled={busy} onClick={() => setAttempt((a) => a + 1)}>
              Reload publishing settings
            </button>
          </div>
        )}
        <p className="mt-6 border-t border-white/[0.06] pt-4 text-xs leading-relaxed text-fg-3">
          Publishing needs your wallet signature. Unpublishing removes the listing; it cannot erase ENS records,
          on-chain history or templates already copied.
        </p>
      </section>
    </Bezel>
  );
}

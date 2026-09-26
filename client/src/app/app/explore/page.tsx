"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Nav, Bezel, Pill } from "@/components/ui";
import { LibraryNav } from "@/components/LibraryNav";
import { short } from "@/lib/chain";
import type { Publication } from "@/lib/sharing";

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="p-32 text-fg-3">Loading Explore…</div>}>
      <Explore />
    </Suspense>
  );
}
function Explore() {
  const q = useSearchParams();
  const [tab, setTab] = useState(
    q.get("tab") === "templates" ? "template" : "strategy",
  );
  const [rows, setRows] = useState<Publication[] | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/publications", { cache: "no-store", signal: c.signal })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        return j;
      })
      .then((j) => {
        setRows(j);
        setError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [attempt]);
  const filtered =
    rows?.filter(
      (p) =>
        p.kind === tab &&
        `${p.title} ${p.description} ${p.name} ${p.owner}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    ) ?? [];
  return (
    <>
      <Nav current="app" />
      <main className="mx-auto w-full max-w-7xl flex-1 px-5 pb-20 pt-28 sm:px-7 sm:pt-32 lg:px-10">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <div className="mb-3 text-xs uppercase tracking-[0.2em] text-accent">
              Ideas, shared openly
            </div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Explore the current.
            </h1>
            <p className="mt-4 max-w-xl leading-relaxed text-fg-2">
              See what others choose to share. Find a starting point, understand
              its settings, then make it yours.
            </p>
          </div>
          <Pill href="/app">My strategies</Pill>
        </div>
        <LibraryNav active="explore" />
        <div className="my-8 flex flex-wrap items-center justify-between gap-4">
          <div
            className="flex rounded-full border border-white/10 p-1"
            role="group"
            aria-label="Publication type"
          >
            {[
              ["strategy", "Live strategies"],
              ["template", "Templates"],
            ].map(([key, label]) => (
              <button
                key={key}
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
                className={`rounded-full px-5 py-2 text-sm transition-colors ${tab === key ? "bg-fg text-bg" : "text-fg-3 hover:text-fg"}`}
              >
                {label}
                <span className="ml-2 opacity-60">
                  {rows?.filter((p) => p.kind === key).length ?? "–"}
                </span>
              </button>
            ))}
          </div>
          <input
            aria-label="Search publications"
            placeholder="Search names, ideas, creators…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-full border border-white/10 bg-white/[0.03] px-5 py-3 text-sm outline-none focus:border-accent sm:w-80"
          />
        </div>
        {error ? (
          <div role="alert" className="p-6 text-bad">
            {error}
            <button
              className="ml-4 text-accent"
              onClick={() => setAttempt((a) => a + 1)}
            >
              Try again
            </button>
          </div>
        ) : !rows ? (
          <div
            aria-label="Loading Explore"
            className="grid gap-5 md:grid-cols-2"
          >
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-64 animate-pulse rounded-3xl bg-white/[0.03]"
              />
            ))}
          </div>
        ) : !filtered.length ? (
          <Bezel>
            <div className="py-16 px-8 text-center">
              <div className="text-xs uppercase tracking-[0.2em] text-accent">
                Room for a new perspective
              </div>
              <h2 className="mt-4 text-2xl font-semibold">
                {search
                  ? "No matching ideas yet."
                  : `No ${tab === "template" ? "templates" : "strategies"} shared yet.`}
              </h2>
              <p className="mx-auto mt-3 max-w-lg text-fg-2">
                {search
                  ? "Try another name or clear your search."
                  : "Open one of your strategies to publish a live view or a reusable template."}
              </p>
              <Link className="mt-6 inline-block text-accent" href="/app">
                Go to my strategies →
              </Link>
            </div>
          </Bezel>
        ) : (
          <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((p) => (
              <Bezel key={p.id} small>
                <article className="flex h-full flex-col p-6">
                  <div className="flex justify-between text-[11px] uppercase tracking-widest text-accent">
                    <span>
                      {p.kind === "template"
                        ? "Saved template"
                        : "Live strategy"}
                    </span>
                    <span>Sepolia</span>
                  </div>
                  <h2 className="mt-5 break-words text-xl font-semibold">
                    {p.title}
                  </h2>
                  <p className="mt-2 text-xs text-fg-3">
                    by {short(p.owner)} ·{" "}
                    {new Date(p.updatedAt).toLocaleDateString()}
                  </p>
                  <p className="mt-5 flex-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-fg-2">
                    {p.description}
                  </p>
                  {p.config && (
                    <dl className="my-6 grid grid-cols-4 gap-2 border-y border-white/10 py-4">
                      {[
                        ["Exposure", `${p.config.lambda / 100}%`],
                        ["Depth", `${p.config.N}×`],
                        ["Drift", `${p.config.delta / 100}%`],
                        ["Fee", `${p.config.fee / 100}%`],
                      ].map(([k, v]) => (
                        <div key={k}>
                          <dt className="text-[10px] text-fg-3">{k}</dt>
                          <dd className="num mt-1 text-lg">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <Link
                    className="mt-6 flex items-center justify-between border-t border-white/10 pt-4 text-sm text-accent"
                    href={
                      p.kind === "template"
                        ? `/app/new?template=${encodeURIComponent(p.id)}`
                        : `/trade?strategy=${encodeURIComponent(p.name)}`
                    }
                  >
                    <span>
                      {p.kind === "template"
                        ? "Review & use template"
                        : "Trade this strategy"}
                    </span>
                    <span aria-hidden>↗</span>
                  </Link>
                </article>
              </Bezel>
            ))}
          </div>
        )}
        <p className="mt-8 max-w-2xl text-xs leading-relaxed text-fg-3">
          Shared by their creators. Templates are saved configurations, not
          performance claims. Review the parameters and guardrails before
          committing your own inventory.
        </p>
      </main>
    </>
  );
}

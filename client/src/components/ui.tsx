"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";

/** Enter-on-scroll reveal. Motivation: content appears in reading order as the page unfolds. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25 }}
      transition={{ duration: 0.6, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}

export function Nav({ current }: { current?: "landing" | "app" }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" aria-hidden />
          Tide
        </Link>
        <nav className="hidden items-center gap-7 text-sm text-fg-2 md:flex">
          <a href="/#mechanism" className="hover:text-fg">Mechanism</a>
          <a href="/#results" className="hover:text-fg">Results</a>
          <a href="/#governance" className="hover:text-fg">Governance</a>
          <a href="/#live" className="hover:text-fg">Live</a>
          <a href="/WHITEPAPER.pdf" className="hover:text-fg">Whitepaper</a>
        </nav>
        {current === "app" ? (
          <Link href="/" className="btn btn-ghost">Home</Link>
        ) : (
          <Link href="/app" className="btn btn-primary">Open dashboard</Link>
        )}
      </div>
    </header>
  );
}

export function Panel({ title, children, className = "", right }: { title?: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={`panel p-5 ${className}`}>
      {title && (
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium text-fg-2">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div>
      <div className="num text-4xl font-semibold tracking-tight text-fg md:text-5xl">{value}</div>
      <div className="mt-1 text-sm text-fg-2">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-fg-3">{sub}</div>}
    </div>
  );
}

export function Status({ s }: { s: string }) {
  const c: Record<string, string> = {
    pending: "border-warn/40 text-warn",
    applied: "border-accent/40 text-accent",
    approved: "border-accent/40 text-accent",
    blocked: "border-bad/40 text-bad",
    expired: "border-bad/40 text-bad",
    failed: "border-bad/40 text-bad",
  };
  return <span className={`rounded-ctl border px-2 py-0.5 text-xs ${c[s] ?? "border-line-2 text-fg-2"}`}>{s}</span>;
}

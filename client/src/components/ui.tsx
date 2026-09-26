"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { motion, useReducedMotion, AnimatePresence } from "motion/react";
import { ArrowUpRight, ArrowRight } from "@phosphor-icons/react";
import { WalletButton } from "./WalletButton";

/** Enter-on-scroll reveal: content appears in reading order as the page unfolds. */
export function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, transform: "translateY(22px)", filter: "blur(6px)" }}
      whileInView={{ opacity: 1, transform: "translateY(0px)", filter: "blur(0px)" }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ duration: 0.9, delay, ease: [0.23, 1, 0.32, 1] }}
    >
      {children}
    </motion.div>
  );
}

/** Pill CTA with the trailing icon nested in its own disc. */
export function Pill({ href, children, variant = "primary", external, size }: { href: string; children: ReactNode; variant?: "primary" | "ghost"; external?: boolean; size?: "sm" }) {
  const cls = `pill pill-${variant} ${size === "sm" ? "pill-sm" : ""}`;
  const Icon = external ? ArrowUpRight : ArrowRight;
  const inner = (
    <>
      <span>{children}</span>
      <span className="ico">
        <Icon size={size === "sm" ? 13 : 15} weight="regular" />
      </span>
    </>
  );
  return external ? (
    <a href={href} className={cls}>{inner}</a>
  ) : (
    <Link href={href} className={cls}>{inner}</Link>
  );
}

const LINKS = [
  ["Mechanism", "/#mechanism"],
  ["Results", "/#results"],
  ["Governance", "/#governance"],
  ["Strategies", "/app"],
  ["Whitepaper", "/WHITEPAPER.pdf"],
] as const;

/** Floating glass island nav. Mobile: hamburger morphs to a cross, full-screen staggered menu. */
export function Nav({ current }: { current?: "landing" | "app" }) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center px-4 pt-5">
        <header className="pointer-events-auto flex h-14 w-full max-w-5xl items-center justify-between rounded-full border border-white/10 bg-bg/70 pl-5 pr-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_20px_60px_-30px_rgba(0,0,0,0.9)] backdrop-blur-2xl">
          <Link href="/" className="flex items-center gap-2.5 text-sm font-semibold tracking-tight">
            <span className="relative inline-block h-2 w-2 rounded-full bg-accent" aria-hidden>
              <span className="absolute inset-0 animate-ping rounded-full bg-accent/60" />
            </span>
            Tide
          </Link>
          <nav className="hidden items-center gap-7 text-[13.5px] text-fg-2 md:flex">
            {LINKS.map(([l, h]) => (
              <a key={l} href={h} className="transition-colors duration-200 hover:text-fg">{l}</a>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            {current === "app" ? (
              <WalletButton />
            ) : (
              <Pill href="/app" size="sm">Open app</Pill>
            )}
            <button
              aria-label={open ? "Close menu" : "Open menu"}
              onClick={() => setOpen((v) => !v)}
              className="relative flex h-10 w-10 items-center justify-center rounded-full md:hidden"
            >
              <span className={`absolute h-px w-4 bg-fg transition-transform duration-300 ${open ? "rotate-45" : "-translate-y-1"}`} style={{ transitionTimingFunction: "var(--ease-out)" }} />
              <span className={`absolute h-px w-4 bg-fg transition-transform duration-300 ${open ? "-rotate-45" : "translate-y-1"}`} style={{ transitionTimingFunction: "var(--ease-out)" }} />
            </button>
          </div>
        </header>
      </div>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-30 flex flex-col justify-center bg-bg/85 px-8 backdrop-blur-3xl md:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {LINKS.map(([l, h], i) => (
              <motion.a
                key={l}
                href={h}
                onClick={() => setOpen(false)}
                className="py-3 text-3xl font-semibold tracking-tight"
                initial={reduce ? false : { opacity: 0, transform: "translateY(24px)" }}
                animate={{ opacity: 1, transform: "translateY(0px)" }}
                transition={{ delay: 0.08 + i * 0.06, duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
              >
                {l}
              </motion.a>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Double-bezel panel: glass core sitting in a machined tray. */
export function Bezel({ children, className = "", coreClass = "", small }: { children: ReactNode; className?: string; coreClass?: string; small?: boolean }) {
  return (
    <div className={`bezel ${small ? "bezel-sm" : ""} ${className}`}>
      <div className={`core ${coreClass}`}>{children}</div>
    </div>
  );
}

export function Panel({ title, children, className = "", right }: { title?: string; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <Bezel small className={className}>
      <section className="p-5">
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-[13px] font-medium text-fg-2">{title}</h2>
            {right}
          </div>
        )}
        {children}
      </section>
    </Bezel>
  );
}

export function Stat({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <div>
      <div className="num text-5xl font-semibold tracking-tight text-fg md:text-6xl">{value}</div>
      <div className="mt-2 text-[15px] text-fg-2">{label}</div>
      {sub && <div className="mt-1 max-w-[40ch] text-xs leading-relaxed text-fg-3">{sub}</div>}
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
  return <span className={`rounded-full border px-2.5 py-0.5 text-[11px] ${c[s] ?? "border-line-2 text-fg-2"}`}>{s}</span>;
}

"use client";

/** Activeness frontier (objective vs λ) for the nearest solved volatility, native SVG in the page palette. */
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

type Frontier = { curves: { sigma: number; lambda_star: number; rows: { lambda: number; objective: number }[] }[] };

const W = 640;
const H = 260;
const PAD = { l: 46, r: 14, t: 14, b: 30 };

export function FrontierChart({ sigma }: { sigma: number }) {
  const [f, setF] = useState<Frontier | null>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    fetch("/api/frontier").then((r) => r.json()).then(setF);
  }, []);
  if (!f) return <div className="h-56 animate-pulse rounded-xl bg-white/[0.03]" />;

  const nearest = f.curves.reduce((a, b) => (Math.abs(b.sigma - sigma) < Math.abs(a.sigma - sigma) ? b : a));
  const rows = nearest.rows;
  const vals = rows.map((r) => r.objective);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const x = (l: number) => PAD.l + ((l - 0.05) / 0.95) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo || 1)) * (H - PAD.t - PAD.b);
  const d = rows.map((r, i) => `${i ? "L" : "M"}${x(r.lambda).toFixed(1)},${y(r.objective).toFixed(1)}`).join(" ");
  const star = rows.find((r) => Math.abs(r.lambda - nearest.lambda_star) < 1e-6) ?? rows[0];

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Objective against lambda; the minimum is the proposed lambda">
        {[0.25, 0.5, 0.75, 1].map((l) => (
          <g key={l}>
            <line x1={x(l)} x2={x(l)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.06)" />
            <text x={x(l)} y={H - 10} textAnchor="middle" fontSize="11" fontFamily="var(--font-geist-mono)" fill="var(--fg-3)">{Math.round(l * 100)}%</text>
          </g>
        ))}
        {[lo, (lo + hi) / 2, hi].map((v) => (
          <text key={v} x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fontFamily="var(--font-geist-mono)" fill="var(--fg-3)">{(v * 100).toFixed(1)}%</text>
        ))}
        <motion.path key={nearest.sigma} d={d} fill="none" stroke="var(--fg-2)" strokeWidth={1.75} initial={reduce ? false : { pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.2, ease: [0.23, 1, 0.32, 1] }} />
        <motion.g initial={false} animate={{ transform: `translate(${x(star.lambda)}px, ${y(star.objective)}px)` }} transition={{ duration: 0.6, ease: [0.23, 1, 0.32, 1] }}>
          <circle r="10" fill="rgba(88,201,182,0.18)" />
          <circle r="4" fill="var(--accent)" />
          <text x="14" y="-8" fontSize="11" fontFamily="var(--font-geist-mono)" fill="var(--accent)">λ* = {Math.round(nearest.lambda_star * 100)}%</text>
        </motion.g>
      </svg>
      <div className="mt-2 flex justify-between text-xs text-fg-3">
        <span>σ = {Math.round(nearest.sigma * 100)}% (nearest solved curve)</span>
        <span>LVR − fees + κ · tracking error, per year</span>
      </div>
    </div>
  );
}

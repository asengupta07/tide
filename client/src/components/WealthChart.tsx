"use client";

/**
 * LP wealth against HODL over one day, drawn natively from the simulation's downsampled series so it
 * sits in the page's palette. The three lines draw in on view (storytelling: the gap opens over time).
 */
import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

type Data = { hours_per_point: number; series: Record<string, number[]> };

const W = 720;
const H = 360;
const PAD = { l: 52, r: 16, t: 16, b: 34 };

export function WealthChart() {
  const [d, setD] = useState<Data | null>(null);
  const reduce = useReducedMotion();
  useEffect(() => {
    fetch("/research/wealth_series.json").then((r) => r.json()).then(setD);
  }, []);
  if (!d) return <div className="aspect-[2/1] w-full animate-pulse rounded-2xl bg-white/[0.03]" />;

  const keys = ["1.0", "0.5", "0.25"];
  const all = keys.flatMap((k) => d.series[k]);
  const min = Math.min(...all);
  const n = d.series["1.0"].length;
  const x = (i: number) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (v / min) * (H - PAD.t - PAD.b);
  const path = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const style: Record<string, { stroke: string; label: string; w: number }> = {
    "1.0": { stroke: "var(--bad)", label: "λ = 1, plain pool", w: 1.75 },
    "0.5": { stroke: "var(--fg-2)", label: "λ = 0.5", w: 1.75 },
    "0.25": { stroke: "var(--accent)", label: "λ = 0.25", w: 2.25 },
  };
  const ticks = [0, -0.003, -0.006, -0.009, -0.012].filter((t) => t >= min - 0.001);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="LP wealth relative to HODL over one day; lower lambda loses less">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="rgba(255,255,255,0.07)" />
            <text x={PAD.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fontFamily="var(--font-geist-mono)" fill="var(--fg-3)">
              {(t * 100).toFixed(1)}%
            </text>
          </g>
        ))}
        {[0, 6, 12, 18, 24].map((h) => (
          <text key={h} x={x((h / d.hours_per_point) | 0)} y={H - 10} textAnchor="middle" fontSize="11" fontFamily="var(--font-geist-mono)" fill="var(--fg-3)">
            {h}h
          </text>
        ))}
        {keys.map((k, idx) => (
          <motion.path
            key={k}
            d={path(d.series[k])}
            fill="none"
            stroke={style[k].stroke}
            strokeWidth={style[k].w}
            strokeLinecap="round"
            initial={reduce ? false : { pathLength: 0, opacity: 0.4 }}
            whileInView={{ pathLength: 1, opacity: 1 }}
            viewport={{ once: true, amount: 0.5 }}
            transition={{ duration: 2.2, delay: idx * 0.25, ease: [0.23, 1, 0.32, 1] }}
          />
        ))}
      </svg>
      <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-fg-2">
        {keys.map((k) => (
          <span key={k} className="inline-flex items-center gap-2">
            <span className="inline-block h-0.5 w-5 rounded-full" style={{ background: style[k].stroke }} />
            {style[k].label}
          </span>
        ))}
        <span className="text-fg-3">LP wealth vs HODL, one day, σ = 60%</span>
      </div>
    </div>
  );
}

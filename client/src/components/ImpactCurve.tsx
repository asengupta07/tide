"use client";

/**
 * Price impact against trade size for this block, from the live reserves: the plain pool (all inventory, one
 * curve), Tide's active curve (the λ slice: the block's first fill, and any fill that leaves the δ band), and
 * Tide's N-curve for follow-on fills inside the band. Fee excluded on every line so the curves are comparable.
 */
const W = 640;
const H = 230;
const PAD = { l: 50, r: 16, t: 16, b: 26 };

function xyc(q: number, x: number, y: number, n: number) {
  return (q * n * y) / (n * x + q);
}

/** A tick step of 1, 2 or 5 times a power of ten that splits `v` into about four steps. */
function niceStep(v: number) {
  const raw = v / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

const LEGEND = [
  { key: "follow", color: "var(--accent)", label: "Tide after another trade", dashed: false },
  { key: "first", color: "var(--bad)", label: "Tide first trade", dashed: true },
  { key: "plain", color: "var(--fg-2)", label: "standard pool", dashed: false },
];

export function ImpactCurve({ totalIn, totalOut, lambda, N, deltaBps }: { totalIn: number; totalOut: number; lambda: number; N: number; deltaBps: number }) {
  if (!(totalIn > 0 && totalOut > 0)) return <div className="text-sm text-fg-3">No inventory yet.</div>;
  const ax = totalIn * lambda;
  const ay = totalOut * lambda;
  const midIn = totalIn / totalOut; // tokenIn per tokenOut at the current reserves
  const steps = 60;
  // the band's width in tokenIn: drift 1 - (N·ax / (N·ax + q))² reaches δ at q = N·ax·(1/√(1-δ) - 1).
  // The x range is four times that (at least 0.5% of the active slice) so the N-curve is visible.
  const qBand = N * ax * (1 / Math.sqrt(1 - deltaBps / 1e4) - 1);
  const maxQ = Math.max(4 * qBand, ax * 0.005);
  const pts = { plain: [] as number[][], first: [] as number[][], follow: [] as number[][] };
  let bandEnd: number | null = null;
  for (let i = 0; i <= steps; i++) {
    const q = (maxQ * i) / steps;
    const imp = (out: number) => (q > 0 ? (q / out / midIn - 1) * 1e4 : 0); // price paid vs mid, in bp
    pts.plain.push([q, imp(xyc(q, totalIn, totalOut, 1))]);
    pts.first.push([q, imp(xyc(q, ax, ay, 1))]);
    const drift = 1 - ((N * ax) / (N * ax + q)) ** 2;
    if (drift * 1e4 <= deltaBps) pts.follow.push([q, imp(xyc(q, ax, ay, N))]);
    else if (bandEnd === null) bandEnd = q;
  }
  const yStep = niceStep(Math.max(...pts.first.map((p) => p[1])));
  const yMax = Math.ceil((Math.max(...pts.first.map((p) => p[1])) * 1.02) / yStep) * yStep;
  const X = (q: number) => PAD.l + (q / maxQ) * (W - PAD.l - PAD.r);
  const Y = (v: number) => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);
  const path = (arr: number[][]) => arr.map(([q, v], i) => `${i ? "L" : "M"}${X(q).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const ticks = Array.from({ length: Math.round(yMax / yStep) + 1 }, (_, i) => i * yStep);
  const xStep = niceStep((maxQ / ax) * 100); // in percent of the active slice
  const xt = Array.from({ length: Math.floor((maxQ / ax) * 100 / xStep) }, (_, i) => ((i + 1) * xStep) / 100);
  const mono = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" } as const;
  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Price impact by order size for a standard pool and Tide trades">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} stroke="rgba(255,255,255,0.06)" />
            <text x={PAD.l - 6} y={Y(t) + 3.5} textAnchor="end" fontSize="9" style={mono} className="fill-[var(--fg-3)]">{formatImpact(t)}</text>
          </g>
        ))}
        {xt.map((f) => (
          <text key={f} x={X(ax * f)} y={H - 8} textAnchor={X(ax * f) > W - 60 ? "end" : "middle"} fontSize="9" style={mono} className="fill-[var(--fg-3)]">{+(f * 100).toFixed(2)}% of active</text>
        ))}
        {bandEnd !== null && (
          <g>
            <rect x={PAD.l} y={PAD.t} width={X(bandEnd) - PAD.l} height={H - PAD.t - PAD.b} fill="rgba(88,201,182,0.06)" />
            <line x1={X(bandEnd)} x2={X(bandEnd)} y1={PAD.t} y2={H - PAD.b} stroke="var(--accent)" strokeDasharray="3 4" opacity={0.6} />
            <text x={X(bandEnd) + 5} y={PAD.t + 10} fontSize="9" style={mono} className="fill-[var(--accent)]">lower-slippage window ends</text>
          </g>
        )}
        <path d={path(pts.plain)} fill="none" stroke="var(--fg-2)" strokeWidth={1.5} />
        <path d={path(pts.first)} fill="none" stroke="var(--bad)" strokeWidth={1.5} strokeDasharray="4 3" />
        {pts.follow.length > 1 && <path d={path(pts.follow)} fill="none" stroke="var(--accent)" strokeWidth={2.25} />}
      </svg>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-3">
        {LEGEND.map((l) => (
          <li key={l.key} className="flex items-center gap-1.5">
            <svg width="18" height="6" aria-hidden><line x1="0" x2="18" y1="3" y2="3" stroke={l.color} strokeWidth="2" strokeDasharray={l.dashed ? "4 3" : undefined} /></svg>
            {l.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatImpact(bps: number) {
  const percent = bps / 100;
  return `${percent.toFixed(percent < 1 ? 2 : 1)}%`;
}

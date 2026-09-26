"use client";

/**
 * Price impact against trade size for this block, from the live reserves: the plain pool (all inventory, one
 * curve), Tide's first fill (the active slice only), and Tide's follow-on fills (the N-curve inside the
 * drift band, the active curve beyond it). Fee excluded on every line so the curves are comparable.
 */
const W = 640;
const H = 260;
const PAD = { l: 46, r: 14, t: 14, b: 34 };

function xyc(q: number, x: number, y: number, n: number) {
  return (q * n * y) / (n * x + q);
}

export function ImpactCurve({ totalIn, totalOut, lambda, N, deltaBps }: { totalIn: number; totalOut: number; lambda: number; N: number; deltaBps: number }) {
  if (!(totalIn > 0 && totalOut > 0)) return <div className="text-sm text-fg-3">No inventory yet.</div>;
  const ax = totalIn * lambda;
  const ay = totalOut * lambda;
  const midIn = totalIn / totalOut; // tokenIn per tokenOut at the current reserves
  const steps = 60;
  const maxQ = ax * 0.03; // up to 3% of the active slice
  const pts = { plain: [] as number[][], first: [] as number[][], follow: [] as number[][] };
  let bandEnd: number | null = null;
  for (let i = 1; i <= steps; i++) {
    const q = (maxQ * i) / steps;
    const imp = (out: number) => (q / out / midIn - 1) * 1e4; // price paid vs mid, in bp
    pts.plain.push([q, imp(xyc(q, totalIn, totalOut, 1))]);
    pts.first.push([q, imp(xyc(q, ax, ay, 1))]);
    const outN = xyc(q, ax, ay, N);
    const drift = 1 - ((N * ax) / (N * ax + q)) ** 2;
    const inBand = drift * 1e4 <= deltaBps;
    if (!inBand && bandEnd === null) bandEnd = q;
    pts.follow.push([q, imp(inBand ? outN : xyc(q, ax, ay, 1))]);
  }
  const yMax = Math.max(...pts.first.map((p) => p[1])) * 1.05;
  const X = (q: number) => PAD.l + (q / maxQ) * (W - PAD.l - PAD.r);
  const Y = (v: number) => PAD.t + (1 - v / yMax) * (H - PAD.t - PAD.b);
  const path = (arr: number[][]) => arr.map(([q, v], i) => `${i ? "L" : "M"}${X(q).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const xt = [0.01, 0.02, 0.03];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Price impact by trade size for the plain pool, Tide's first fill and Tide's follow-on fills">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD.l} x2={W - PAD.r} y1={Y(t)} y2={Y(t)} stroke="rgba(255,255,255,0.06)" />
          <text x={PAD.l - 6} y={Y(t) + 4} textAnchor="end" fontSize="10" fontFamily="var(--font-geist-mono)" className="fill-[var(--fg-3)]">{t.toFixed(0)} bp</text>
        </g>
      ))}
      {xt.map((f) => (
        <text key={f} x={X(ax * f)} y={H - 10} textAnchor="middle" fontSize="10" fontFamily="var(--font-geist-mono)" className="fill-[var(--fg-3)]">{(f * 100).toFixed(0)}% of active</text>
      ))}
      {bandEnd !== null && (
        <g>
          <rect x={PAD.l} y={PAD.t} width={X(bandEnd) - PAD.l} height={H - PAD.t - PAD.b} fill="rgba(88,201,182,0.05)" />
          <line x1={X(bandEnd)} x2={X(bandEnd)} y1={PAD.t} y2={H - PAD.b} stroke="var(--accent)" strokeDasharray="3 4" opacity={0.6} />
          <text x={X(bandEnd) + 5} y={PAD.t + 12} fontSize="10" fontFamily="var(--font-geist-mono)" className="fill-[var(--accent)]">δ band ends</text>
        </g>
      )}
      <path d={path(pts.first)} fill="none" stroke="var(--bad)" strokeWidth={1.75} strokeDasharray="4 3" />
      <path d={path(pts.plain)} fill="none" stroke="var(--fg-2)" strokeWidth={1.75} />
      <path d={path(pts.follow)} fill="none" stroke="var(--accent)" strokeWidth={2.25} />
      <g fontSize="11" fontFamily="var(--font-geist-mono)">
        <circle cx={PAD.l + 8} cy={H - 24} r={3} fill="var(--accent)" /><text x={PAD.l + 16} y={H - 20} className="fill-[var(--fg-2)]">Tide, follow-on fill (N-curve inside δ)</text>
        <circle cx={PAD.l + 250} cy={H - 24} r={3} fill="var(--fg-2)" /><text x={PAD.l + 258} y={H - 20} className="fill-[var(--fg-2)]">plain pool</text>
        <circle cx={PAD.l + 340} cy={H - 24} r={3} fill="var(--bad)" /><text x={PAD.l + 348} y={H - 20} className="fill-[var(--fg-2)]">Tide, first fill of the block (λ slice)</text>
      </g>
    </svg>
  );
}

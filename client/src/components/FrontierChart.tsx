"use client";

import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer, Legend } from "recharts";

type Frontier = { curves: { sigma: number; lambda_star: number; rows: { lambda: number; objective: number }[] }[] };

export function FrontierChart({ sigma }: { sigma: number }) {
  const [f, setF] = useState<Frontier | null>(null);
  useEffect(() => {
    fetch("/api/frontier").then((r) => r.json()).then(setF);
  }, []);
  if (!f) return <div className="text-zinc-500">loading…</div>;
  const nearest = f.curves.reduce((a, b) => (Math.abs(b.sigma - sigma) < Math.abs(a.sigma - sigma) ? b : a));
  const data = nearest.rows.map((r) => ({ lambda: r.lambda, objective: r.objective * 100 }));
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
          <XAxis dataKey="lambda" tickFormatter={(v) => `${Math.round(v * 100)}%`} fontSize={11} />
          <YAxis fontSize={11} tickFormatter={(v) => `${v.toFixed(1)}%`} width={44} />
          <Tooltip formatter={(v) => [`${Number(v).toFixed(3)}% of value / yr`, "LVR − fees + κ·TE"]} labelFormatter={(l) => `λ = ${Math.round(Number(l) * 100)}%`} />
          <Legend />
          <Line type="monotone" dataKey="objective" name={`σ = ${Math.round(nearest.sigma * 100)}%`} stroke="#0284c7" dot={false} strokeWidth={2} />
          <ReferenceLine x={nearest.lambda_star} stroke="#16a34a" strokeDasharray="4 4" label={{ value: `λ* = ${Math.round(nearest.lambda_star * 100)}%`, fontSize: 11, position: "top" }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

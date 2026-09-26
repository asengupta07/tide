"use client";

/**
 * One block of Tide, animated. Motivation: the mechanism is a sequence in time (split, informed fill,
 * follow-on fills on the deep curve, guard) and reads far better shown than described. Four phases loop
 * slowly; reduced-motion shows the final phase as a still.
 */
import { useEffect, useState } from "react";
import { motion, useReducedMotion, AnimatePresence } from "motion/react";

const PHASES = [
  { key: "split", title: "Top of block", body: "λ of the inventory becomes active. The rest is passive: still in the wallet, not quotable." },
  { key: "first", title: "First fill, informed", body: "The arbitrageur trades on the plain curve over the active slice only. It sees λ of the vault and pays the fee like everyone else." },
  { key: "virtual", title: "Later fills, uninformed", body: "Priced on a curve N times deeper than the active slice, inside a δ band around the block's anchor. Follow-on traders get a fraction of the slippage." },
  { key: "guard", title: "Guard", body: "A fill that would move the virtual price past δ is re-priced on the real curve. And the fee is at least the deep curve's best rebate, (N − 1)·δ / 2, so the curve cannot be farmed by trading against it." },
] as const;

const ease = [0.77, 0, 0.175, 1] as const;

export function BlockAnimation() {
  const reduce = useReducedMotion();
  const [i, setI] = useState(reduce ? 3 : 0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setI((v) => (v + 1) % PHASES.length), 3600);
    return () => clearInterval(t);
  }, [reduce]);
  const p = PHASES[i];
  const lambda = 0.5;

  return (
    <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
      <div className="relative aspect-[4/3] w-full">
        <svg viewBox="0 0 400 300" className="h-full w-full" role="img" aria-label="Animated diagram of one block of Tide">
          {/* inventory bar */}
          <text x="20" y="34" className="fill-[var(--fg-3)]" fontSize="11" fontFamily="var(--font-geist-mono)">inventory</text>
          <rect x="20" y="44" width="360" height="26" rx="6" fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.1)" />
          <motion.rect
            x="20" y="44" height="26" rx="6" fill="var(--accent)"
            initial={false}
            animate={{ width: i === 0 ? 360 * lambda : i === 1 ? 360 * lambda * 0.78 : 360 * lambda * 0.72 }}
            transition={{ duration: 1.1, ease }}
          />
          <motion.text x="24" y="62" fontSize="11" fontFamily="var(--font-geist-mono)" fill="var(--accent-ink)" fontWeight={600}
            initial={false} animate={{ opacity: 1 }}>
            active λ = {lambda}
          </motion.text>
          <text x="376" y="62" textAnchor="end" fontSize="11" fontFamily="var(--font-geist-mono)" className="fill-[var(--fg-3)]">passive</text>

          {/* curves */}
          <text x="20" y="108" className="fill-[var(--fg-3)]" fontSize="11" fontFamily="var(--font-geist-mono)">price curve this fill sees</text>
          <g transform="translate(20,120)">
            <line x1="0" y1="150" x2="360" y2="150" stroke="rgba(255,255,255,0.12)" />
            <line x1="0" y1="0" x2="0" y2="150" stroke="rgba(255,255,255,0.12)" />
            {/* real (active) curve */}
            <motion.path
              d="M 12 8 C 40 90, 120 130, 350 145"
              fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} strokeDasharray="3 4"
              initial={false} animate={{ opacity: i === 0 ? 0.25 : 1 }} transition={{ duration: 0.8 }}
            />
            {/* virtual N-scaled curve */}
            <motion.path
              d="M 12 60 C 60 110, 160 135, 350 145"
              fill="none" stroke="var(--accent)" strokeWidth={2}
              initial={false}
              animate={{ opacity: i >= 2 ? 1 : 0, pathLength: i >= 2 ? 1 : 0 }}
              transition={{ duration: 1.2, ease }}
            />
            {/* trade marker */}
            <AnimatePresence>
              {i === 1 && (
                <motion.g key="arb" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
                  <circle cx="110" cy="112" r="5" fill="var(--warn)" />
                  <text x="122" y="108" fontSize="11" fontFamily="var(--font-geist-mono)" className="fill-[var(--warn)]">arbitrageur, N = 1</text>
                </motion.g>
              )}
              {i === 2 && (
                <motion.g key="retail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
                  <circle cx="200" cy="139" r="5" fill="var(--accent)" />
                  <text x="212" y="134" fontSize="11" fontFamily="var(--font-geist-mono)" className="fill-[var(--accent)]">retail, N = 4</text>
                </motion.g>
              )}
              {i === 3 && (
                <motion.g key="guard" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
                  <rect x="0" y="0" width="230" height="150" fill="rgba(88,201,182,0.06)" />
                  <line x1="230" y1="0" x2="230" y2="150" stroke="var(--bad)" strokeDasharray="4 4" />
                  <text x="236" y="16" fontSize="11" fontFamily="var(--font-geist-mono)" className="fill-[var(--bad)]">δ bound</text>
                  <circle cx="290" cy="143" r="5" fill="var(--bad)" />
                  <text x="238" y="134" fontSize="11" fontFamily="var(--font-geist-mono)" className="fill-[var(--fg-2)]">re-priced, N = 1</text>
                </motion.g>
              )}
            </AnimatePresence>
          </g>
        </svg>
      </div>
      <div>
        <div className="flex gap-1.5">
          {PHASES.map((ph, k) => (
            <button
              key={ph.key}
              onClick={() => setI(k)}
              aria-label={ph.title}
              className="h-1 flex-1 overflow-hidden rounded-full bg-white/10"
            >
              <motion.span className="block h-full bg-accent" initial={false} animate={{ transform: k <= i ? "scaleX(1)" : "scaleX(0)" }} style={{ transformOrigin: "left" }} transition={{ duration: 0.4, ease }} />
            </button>
          ))}
        </div>
        <AnimatePresence mode="wait">
          <motion.div
            key={p.key}
            initial={reduce ? false : { opacity: 0, transform: "translateY(10px)", filter: "blur(4px)" }}
            animate={{ opacity: 1, transform: "translateY(0px)", filter: "blur(0px)" }}
            exit={{ opacity: 0, transform: "translateY(-6px)", filter: "blur(4px)" }}
            transition={{ duration: 0.45, ease: [0.23, 1, 0.32, 1] }}
            className="mt-6"
          >
            <h3 className="text-2xl font-semibold tracking-tight">{p.title}</h3>
            <p className="mt-3 max-w-[40ch] text-[15px] leading-relaxed text-fg-2">{p.body}</p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

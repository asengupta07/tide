import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ChartLineUp, CirclesFour, Path, ShieldCheck } from "@phosphor-icons/react/dist/ssr";

import { TradeHeroLive } from "@/components/TradeHeroLive";
import { Nav, Reveal } from "@/components/ui";

export const metadata: Metadata = {
  title: "Trade on Tide",
  description: "Compare every funded Tide LP and route each swap to the strongest live execution.",
};

export default async function TradeLanding({ searchParams }: { searchParams: Promise<{ strategy?: string }> }) {
  const { strategy } = await searchParams;
  if (strategy) redirect(`/trade/market?strategy=${encodeURIComponent(strategy)}`);

  return (
    <>
      <Nav current="trade" />
      <main className="overflow-hidden">
        <section className="relative mx-auto grid min-h-[100dvh] w-full max-w-7xl items-center gap-14 px-5 pb-20 pt-24 sm:px-7 lg:grid-cols-[0.92fr_1.08fr] lg:px-10">
          <div className="pointer-events-none absolute left-[42%] top-[18%] h-72 w-72 rounded-full bg-accent/[0.055] blur-[100px]" aria-hidden="true" />
          <Reveal className="relative z-[1] max-w-[39rem]">
            <div className="mb-5 inline-flex items-center rounded-full bg-white/[0.045] px-3 py-1.5 text-xs text-fg-2 ring-1 ring-white/[0.09]">Tide-only execution</div>
            <h1 className="text-[clamp(2.8rem,6vw,5.4rem)] font-semibold leading-[0.96] tracking-[-0.04em]">Trade against deeper liquidity.</h1>
            <p className="mt-6 max-w-[34rem] text-base leading-relaxed text-fg-2 sm:text-lg">One order. Every funded Tide LP compared live. The strongest executable quote wins.</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/trade/market" className="pill pill-primary group">
                <span>Open terminal</span>
                <span className="ico transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5"><ArrowRight size={15} /></span>
              </Link>
              <Link href="/#mechanism" className="pill pill-ghost">How Tide prices</Link>
            </div>
          </Reveal>
          <div className="relative z-[1] pb-8 lg:translate-y-5"><TradeHeroLive /></div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-5 py-24 sm:px-7 lg:px-10">
          <Reveal className="max-w-[42rem]">
            <h2 className="text-3xl font-semibold tracking-[-0.03em] sm:text-5xl">A terminal built around execution, not noise.</h2>
            <p className="mt-5 max-w-[60ch] text-base leading-relaxed text-fg-2">Inspect liquidity, compare routes, watch live prices, and execute from one compact market view.</p>
          </Reveal>
          <div className="mt-14 grid gap-5 md:grid-cols-12">
            <Reveal className="md:col-span-7">
              <div className="h-full rounded-[1.25rem] bg-white/[0.04] p-1.5 ring-1 ring-white/[0.09]">
                <div className="flex h-full min-h-72 flex-col justify-between rounded-[0.95rem] bg-panel p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <Path size={28} className="text-accent" weight="light" />
                  <div>
                    <h3 className="text-2xl font-medium">Best route, automatically</h3>
                    <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-fg-2">Tide quotes every eligible LP in one call, excludes your own liquidity, and executes the strongest single route.</p>
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.08} className="md:col-span-5">
              <div className="h-full rounded-[1.25rem] bg-white/[0.04] p-1.5 ring-1 ring-white/[0.09]">
                <div className="flex h-full min-h-72 flex-col justify-between rounded-[0.95rem] bg-panel-2 p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <ChartLineUp size={28} className="text-accent" weight="light" />
                  <div>
                    <h3 className="text-2xl font-medium">Prove the price live</h3>
                    <p className="mt-3 text-sm leading-relaxed text-fg-2">Every quote is compared with a constant-product pool holding the same inventory.</p>
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal className="md:col-span-5">
              <div className="h-full rounded-[1.25rem] bg-white/[0.04] p-1.5 ring-1 ring-white/[0.09]">
                <div className="flex h-full min-h-64 flex-col justify-between rounded-[0.95rem] bg-[#10201f] p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <ShieldCheck size={28} className="text-accent" weight="light" />
                  <div><h3 className="text-2xl font-medium">Bounded execution</h3><p className="mt-3 text-sm leading-relaxed text-fg-2">Exact allowances and a visible slippage limit keep the transaction legible before signing.</p></div>
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.08} className="md:col-span-7">
              <div className="h-full rounded-[1.25rem] bg-white/[0.04] p-1.5 ring-1 ring-white/[0.09]">
                <div className="flex h-full min-h-64 flex-col justify-between rounded-[0.95rem] bg-panel p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <CirclesFour size={28} className="text-accent" weight="light" />
                  <div><h3 className="text-2xl font-medium">All market context, one screen</h3><p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-fg-2">Candles, recent fills, route liquidity, curve parameters, and the order ticket stay visible together.</p></div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        <section className="mx-auto w-full max-w-7xl px-5 pb-28 pt-12 sm:px-7 lg:px-10">
          <Reveal>
            <div className="rounded-[1.35rem] bg-white/[0.04] p-1.5 ring-1 ring-white/[0.1]">
              <div className="flex flex-col items-start justify-between gap-8 rounded-[1rem] bg-panel px-7 py-10 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] sm:px-10 md:flex-row md:items-center">
                <div><h2 className="text-3xl font-semibold tracking-[-0.03em]">See the route before you sign.</h2><p className="mt-3 text-sm text-fg-2">Live on Sepolia with every funded Tide strategy.</p></div>
                <Link href="/trade/market" className="pill pill-primary group shrink-0"><span>Open terminal</span><span className="ico transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5"><ArrowRight size={15} /></span></Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>
    </>
  );
}

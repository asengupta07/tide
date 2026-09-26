import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ChartLineUp, CirclesFour, Path, ShieldCheck } from "@phosphor-icons/react/dist/ssr";

import { DitherField, GrainBand, TideWater } from "@/components/shaders";
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
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3">
              <Link href="/trade/market" className="pill pill-primary pill-hero group">
                <span>Open terminal</span>
                <span className="ico"><ArrowRight size={14} /></span>
              </Link>
              <Link href="/#mechanism" className="group inline-flex min-h-11 items-center gap-2 px-1 text-sm font-medium text-fg-2 transition-colors duration-200 hover:text-fg">
                <span>How Tide prices</span>
                <ArrowRight size={14} className="transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-0.5" />
              </Link>
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
              <div className="group h-full rounded-[1.25rem] bg-white/[0.04] p-1.5 ring-1 ring-white/[0.09]">
                <div className="relative flex h-full min-h-[23rem] overflow-hidden rounded-[0.95rem] bg-panel p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <div className="absolute inset-y-0 right-0 w-[78%] opacity-90 transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.025]" aria-hidden="true"><DitherField /></div>
                  <div className="absolute inset-0 bg-[linear-gradient(90deg,#11161d_4%,rgba(17,22,29,0.97)_30%,rgba(17,22,29,0.38)_72%,rgba(17,22,29,0.08)_100%)]" aria-hidden="true" />
                  <div className="absolute right-[8%] top-[15%] h-[58%] w-[48%] rounded-full border border-accent/20 opacity-70 shadow-[0_0_80px_rgba(88,201,182,0.16)]" aria-hidden="true" />
                  <div className="absolute right-[19%] top-[27%] h-[36%] w-[27%] rounded-full border border-accent/35" aria-hidden="true" />
                  <div className="relative z-[1] flex w-full flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <span className="flex h-11 w-11 items-center justify-center rounded-full border border-accent/25 bg-bg/45 text-accent backdrop-blur-sm"><Path size={23} weight="light" /></span>
                      <span className="num rounded-full border border-white/10 bg-bg/45 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-fg-2 backdrop-blur-sm">all LPs / one fill</span>
                    </div>
                    <div className="max-w-[28rem]">
                      <h3 className="text-2xl font-medium">Best route, automatically</h3>
                      <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-fg-2">Tide quotes every eligible LP in one call, excludes your own liquidity, and executes the strongest single route.</p>
                      <div className="mt-6 flex items-center gap-2" aria-hidden="true"><span className="num text-[10px] uppercase tracking-[0.14em] text-fg-3">scan</span><span className="h-px flex-1 bg-gradient-to-r from-accent/70 via-accent/25 to-transparent" /><span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_14px_rgba(88,201,182,0.9)]" /></div>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.08} className="md:col-span-5">
              <div className="group h-full rounded-[1.25rem] bg-white/[0.04] p-1.5 ring-1 ring-white/[0.09]">
                <div className="relative flex h-full min-h-[23rem] overflow-hidden rounded-[0.95rem] bg-panel-2 p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <div className="absolute inset-x-0 top-0 h-[64%] opacity-60 transition-opacity duration-500 group-hover:opacity-80" aria-hidden="true"><TideWater /></div>
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(17,22,29,0.15)_0%,rgba(17,22,29,0.72)_48%,#151c25_78%)]" aria-hidden="true" />
                  <div className="absolute left-7 right-7 top-24 flex items-center gap-3 opacity-75" aria-hidden="true"><span className="num text-[10px] text-accent">TIDE</span><span className="h-px flex-1 bg-accent/70"/><span className="num text-[10px] text-fg-3">CPMM</span><span className="h-px w-[31%] bg-white/25"/></div>
                  <div className="relative z-[1] flex w-full flex-col justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full border border-accent/25 bg-bg/45 text-accent backdrop-blur-sm"><ChartLineUp size={23} weight="light" /></span>
                    <div><h3 className="text-2xl font-medium">Prove the price live</h3><p className="mt-3 text-sm leading-relaxed text-fg-2">Every quote is compared with a constant-product pool holding the same inventory.</p></div>
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal className="md:col-span-5">
              <div className="group h-full rounded-[1.25rem] bg-white/[0.04] p-1.5 ring-1 ring-white/[0.09]">
                <div className="relative flex h-full min-h-[20rem] overflow-hidden rounded-[0.95rem] bg-[#10201f] p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <div className="absolute -inset-x-[20%] -top-[42%] h-[115%] rotate-[-8deg] opacity-65 transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-y-2" aria-hidden="true"><GrainBand /></div>
                  <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(16,32,31,0.1)_0%,rgba(16,32,31,0.72)_48%,#10201f_82%)]" aria-hidden="true" />
                  <div className="absolute left-0 right-0 top-[42%] h-px bg-accent/30 shadow-[0_0_30px_rgba(88,201,182,0.35)]" aria-hidden="true" />
                  <div className="relative z-[1] flex w-full flex-col justify-between">
                    <div className="flex items-center justify-between"><span className="flex h-11 w-11 items-center justify-center rounded-full border border-accent/25 bg-bg/45 text-accent backdrop-blur-sm"><ShieldCheck size={23} weight="light" /></span><span className="num text-[10px] uppercase tracking-[0.16em] text-accent">limit locked</span></div>
                    <div><h3 className="text-2xl font-medium">Bounded execution</h3><p className="mt-3 text-sm leading-relaxed text-fg-2">Exact allowances and a visible slippage limit keep the transaction legible before signing.</p></div>
                  </div>
                </div>
              </div>
            </Reveal>
            <Reveal delay={0.08} className="md:col-span-7">
              <div className="group h-full rounded-[1.25rem] bg-white/[0.04] p-1.5 ring-1 ring-white/[0.09]">
                <div className="relative flex h-full min-h-[20rem] overflow-hidden rounded-[0.95rem] bg-panel p-7 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)]">
                  <div className="absolute inset-0 opacity-45 transition-opacity duration-500 group-hover:opacity-60" aria-hidden="true"><DitherField /></div>
                  <div className="absolute inset-0 bg-[linear-gradient(90deg,#11161d_0%,rgba(17,22,29,0.92)_42%,rgba(17,22,29,0.24)_100%)]" aria-hidden="true" />
                  <div className="absolute bottom-8 right-7 top-8 hidden w-[39%] grid-cols-2 gap-2 opacity-75 sm:grid" aria-hidden="true"><span className="rounded-md border border-white/10 bg-bg/35"/><span className="rounded-md border border-accent/20 bg-accent/[0.06]"/><span className="col-span-2 rounded-md border border-white/10 bg-bg/35"/><span className="rounded-md border border-accent/15 bg-bg/40"/><span className="rounded-md border border-white/10 bg-bg/35"/></div>
                  <div className="relative z-[1] flex w-full max-w-[31rem] flex-col justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-full border border-accent/25 bg-bg/45 text-accent backdrop-blur-sm"><CirclesFour size={23} weight="light" /></span>
                    <div><h3 className="text-2xl font-medium">All market context, one screen</h3><p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-fg-2">Candles, recent fills, route liquidity, curve parameters, and the order ticket stay visible together.</p></div>
                  </div>
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

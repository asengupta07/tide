import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "@phosphor-icons/react/dist/ssr";

import { Nav, Reveal, Stat } from "@/components/ui";
import { TideWater, GrainBand, DitherField } from "@/components/shaders";
import { LiveSplit } from "@/components/LiveSplit";

const ADDR = {
  router: "0x9A5883AA2068a133779cdaEB2b67Cc22f16b85B3",
  params: "0xeDb9BC901D74382170CE603b23aFB5FD43d28176",
  hook: "0x45DbC91351767e2C801623C87FbD88eA2Bc36A88",
  aqua: "0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a",
  strategy: "0x86a1ac9e81b0e6eb2749bce0304ede0d434dd445d93717c6035c75a2034ff15d",
};
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const scan = (a: string) => `https://sepolia.etherscan.io/address/${a}`;

export default function Landing() {
  return (
    <>
      <Nav current="landing" />
      <main className="flex-1">
        {/* Hero: asymmetric split, shader is the visual */}
        <section className="relative overflow-hidden border-b border-line">
          <div className="absolute inset-0 opacity-70">
            <TideWater />
          </div>
          <div className="absolute inset-0 bg-gradient-to-r from-bg via-bg/80 to-bg/20" />
          <div className="relative mx-auto grid min-h-[calc(100dvh-4rem)] max-w-7xl items-center gap-12 px-6 py-16 md:grid-cols-12 md:py-20">
            <div className="md:col-span-7">
              <h1 className="max-w-[14ch] text-5xl font-semibold leading-[1.02] tracking-tight md:text-6xl lg:text-7xl">
                Show the arbitrageur half the vault.
              </h1>
              <p className="mt-6 max-w-[42ch] text-lg leading-relaxed text-fg-2">
                Tide exposes a fraction of a maker&apos;s inventory per block and quotes everyone else on a deeper curve. On 1inch Aqua and Uniswap v4.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/app" className="btn btn-primary">Open dashboard</Link>
                <a href="/WHITEPAPER.pdf" className="btn btn-ghost">
                  Read the whitepaper <ArrowUpRight size={16} weight="bold" />
                </a>
              </div>
            </div>
            <div className="md:col-span-5">
              <LiveSplit />
            </div>
          </div>
        </section>

        {/* Problem, one number */}
        <section className="mx-auto max-w-7xl px-6 py-24">
          <Reveal>
            <p className="max-w-[60ch] text-2xl leading-snug tracking-tight text-fg md:text-3xl">
              Every block, the first trade against an AMM is at yesterday&apos;s price. The pool loses about
              <span className="num text-accent"> σ²/8 </span>
              of its value per unit time to whoever knows today&apos;s. Tide does not tax that trade. It shrinks what the trade can see.
            </p>
          </Reveal>
        </section>

        {/* Mechanism: unequal 3-column, first cell carries a shader */}
        <section id="mechanism" className="border-y border-line bg-bg-2">
          <div className="mx-auto max-w-7xl px-6 py-24">
            <Reveal>
              <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">One block of Tide</h2>
            </Reveal>
            <div className="mt-12 grid gap-px overflow-hidden rounded-panel border border-line bg-line md:grid-cols-[1.35fr_1fr_1fr]">
              <Reveal className="relative min-h-72 bg-panel p-6">
                <div className="absolute inset-0 opacity-40">
                  <DitherField />
                </div>
                <div className="relative">
                  <div className="num text-5xl font-semibold text-accent">λ</div>
                  <h3 className="mt-4 text-lg font-medium">Active split</h3>
                  <p className="mt-2 max-w-[34ch] text-sm leading-relaxed text-fg-2">
                    At the first quote of a block, λ of the reserves become active. The rest is passive and cannot be traded until the next block. The block&apos;s first fill sees only the active slice.
                  </p>
                </div>
              </Reveal>
              <Reveal delay={0.08} className="bg-panel p-6">
                <div className="num text-5xl font-semibold text-fg">N</div>
                <h3 className="mt-4 text-lg font-medium">Virtual depth</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-2">
                  Later fills in the block are priced as if the pool were N times deeper. Slippage of about q/(N·x) instead of q/x, backed by the passive part.
                </p>
              </Reveal>
              <Reveal delay={0.16} className="bg-panel p-6">
                <div className="num text-5xl font-semibold text-fg">δ</div>
                <h3 className="mt-4 text-lg font-medium">Drift bound</h3>
                <p className="mt-2 text-sm leading-relaxed text-fg-2">
                  A fill that would move the price more than δ from the block&apos;s anchor is re-priced on the real curve. The deep curve can never be walked further than δ.
                </p>
              </Reveal>
            </div>
            <p className="mt-6 max-w-[70ch] text-sm text-fg-3">
              Same math on both venues: three SwapVM opcodes on a redeployed Aqua router, and a v4 hook. A test asserts identical fills for identical trades.
            </p>
          </div>
        </section>

        {/* Results: figure + numbers */}
        <section id="results" className="mx-auto max-w-7xl px-6 py-24">
          <div className="grid items-center gap-12 md:grid-cols-12">
            <Reveal className="md:col-span-7">
              <div className="overflow-hidden rounded-panel border border-line bg-panel">
                <Image src="/research/fig_wealth.png" alt="LP wealth against HODL over one day for lambda 1, 0.5 and 0.25; lower lambda loses less" width={1280} height={720} className="w-full" priority={false} />
              </div>
              <p className="mt-3 text-xs text-fg-3">10,000 paths, σ = 60 % annualised, 12 s blocks. Fees not modelled, so every curve is pure arbitrage loss.</p>
            </Reveal>
            <div className="grid gap-10 md:col-span-5">
              <Reveal><Stat value="33%" label="less arbitrage loss at λ = 0.5" sub="43% at λ = 0.25. Closed form 1/(2 − λ), simulation agrees to three digits." /></Reveal>
              <Reveal delay={0.08}><Stat value="3.97×" label="less slippage for follow-on trades at N = 4" sub="Trade of 1 % of active reserves." /></Reveal>
              <Reveal delay={0.16}><Stat value="+33k" label="gas per fill over a plain constant-product fill" sub="Three parameter reads and one guard. Cacheable per block." /></Reveal>
            </div>
          </div>
        </section>

        {/* Governance band with grain shader */}
        <section id="governance" className="relative overflow-hidden border-y border-line">
          <div className="absolute inset-0 opacity-60">
            <GrainBand />
          </div>
          <div className="absolute inset-0 bg-gradient-to-b from-bg via-bg/60 to-bg" />
          <div className="relative mx-auto max-w-7xl px-6 py-24">
            <Reveal>
              <h2 className="max-w-[24ch] text-3xl font-semibold tracking-tight md:text-4xl">The knobs are ENS records. The hand on them is a human.</h2>
            </Reveal>
            <div className="mt-12 grid gap-6 md:grid-cols-4">
              {[
                ["eth-usdc.tide.eth", "λ, N and δ live as text records on an ENSv2 name on Sepolia. Anyone can read them. The contracts read them."],
                ["manager.tide.eth", "The agent has its own name and a role that lets it edit exactly those three records. Nothing else on the name."],
                ["World ID", "Before every write the agent asks the owner for a fresh authentication. Denied, expired or replayed means nothing is written."],
                ["One call to revoke", "The owner removes the agent's role per record and drops it as manager on-chain. Inventory never moved."],
              ].map(([t, b], i) => (
                <Reveal key={t} delay={i * 0.06}>
                  <div className="h-full rounded-panel border border-line bg-bg/60 p-5 backdrop-blur-sm">
                    <div className="num text-sm text-accent">{t}</div>
                    <p className="mt-3 text-sm leading-relaxed text-fg-2">{b}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Live: real addresses */}
        <section id="live" className="mx-auto max-w-7xl px-6 py-24">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight md:text-4xl">Live on Sepolia</h2>
            <p className="mt-3 max-w-[60ch] text-fg-2">Shipped through the official Aqua registry, filled by a resolver, swapped through the v4 hook, records written and read on-chain.</p>
          </Reveal>
          <Reveal className="mt-10">
            <div className="grid gap-px overflow-hidden rounded-panel border border-line bg-line md:grid-cols-2">
              {[
                ["TideRouter", "redeployed AquaSwapVMRouter with the three opcodes", ADDR.router],
                ["TideHook", "Uniswap v4 hook, same math", ADDR.hook],
                ["TideParams", "governed λ, N, δ; owner or manager only", ADDR.params],
                ["Aqua registry", "official 1inch, inventory stays in the wallet", ADDR.aqua],
              ].map(([n, d, a]) => (
                <a key={a} href={scan(a)} className="group flex items-center justify-between gap-6 bg-panel p-5 transition-colors hover:bg-panel-2">
                  <div>
                    <div className="font-medium">{n}</div>
                    <div className="text-sm text-fg-3">{d}</div>
                  </div>
                  <div className="num flex shrink-0 items-center gap-2 whitespace-nowrap text-sm text-fg-2 group-hover:text-accent">
                    {short(a)} <ArrowUpRight size={14} />
                  </div>
                </a>
              ))}
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-fg-3">
          <div>Tide, ETHGlobal Tokyo 2026. Built on arXiv 2602.09887 and 2605.19267.</div>
          <div className="flex gap-6">
            <a className="hover:text-fg" href="https://github.com/asengupta07/tide">GitHub</a>
            <a className="hover:text-fg" href="/WHITEPAPER.pdf">Whitepaper</a>
            <a className="hover:text-fg" href={`https://sepolia.app.ens.domains/eth-usdc.tide.eth`}>eth-usdc.tide.eth</a>
          </div>
        </div>
      </footer>
    </>
  );
}

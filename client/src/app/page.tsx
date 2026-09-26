import { ArrowUpRight, Fingerprint, Key, TextAa, Prohibit } from "@phosphor-icons/react/dist/ssr";

import { Nav, Reveal, Stat, Pill, Bezel } from "@/components/ui";
import { TideWater, GrainBand, DitherField } from "@/components/shaders";
import { LiveSplit } from "@/components/LiveSplit";
import { BlockAnimation } from "@/components/BlockAnimation";
import { WealthChart } from "@/components/WealthChart";

const ADDR = {
  router: "0x9A5883AA2068a133779cdaEB2b67Cc22f16b85B3",
  params: "0xeDb9BC901D74382170CE603b23aFB5FD43d28176",
  hook: "0x45DbC91351767e2C801623C87FbD88eA2Bc36A88",
  aqua: "0x1111113CCf1426A8E30e2bfF5E005d929bF6a90a",
};
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
const scan = (a: string) => `https://sepolia.etherscan.io/address/${a}`;

export default function Landing() {
  return (
    <>
      <Nav current="landing" />
      <main className="flex-1">
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div className="absolute inset-0">
            <TideWater />
          </div>
          <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_20%_40%,rgba(11,15,20,0.96)_0%,rgba(11,15,20,0.75)_45%,rgba(11,15,20,0.15)_100%)]" />
          <div className="relative mx-auto grid min-h-[100dvh] max-w-7xl items-center gap-14 px-6 pb-20 pt-32 md:grid-cols-12 md:pt-24">
            <div className="md:col-span-7">
              <h1 className="rise max-w-[17ch] text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.03em] md:text-6xl lg:text-7xl">
                Show the arbitrageur half the vault.
              </h1>
              <p className="rise rise-1 mt-7 max-w-[40ch] text-lg leading-relaxed text-fg-2">
                Tide exposes a fraction of a maker&apos;s inventory per block and quotes everyone else on a deeper curve. On 1inch Aqua and Uniswap v4.
              </p>
              <div className="rise rise-2 mt-9 flex flex-wrap gap-3">
                <Pill href="/app">Open dashboard</Pill>
                <Pill href="/WHITEPAPER.pdf" variant="ghost" external>Read the whitepaper</Pill>
              </div>
            </div>
            <div className="rise rise-3 md:col-span-5">
              <LiveSplit />
            </div>
          </div>
        </section>

        {/* The problem, one sentence */}
        <section className="mx-auto max-w-7xl px-6 py-28 md:py-36">
          <Reveal>
            <p className="max-w-[26ch] text-3xl font-medium leading-[1.15] tracking-tight md:text-5xl">
              Every block, the first trade against an AMM is at yesterday&apos;s price.
            </p>
            <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-fg-2">
              A constant-product pool loses about <span className="num text-fg">σ²/8</span> of its value per unit time to whoever knows today&apos;s. Tide does not tax that trade. It shrinks what the trade can see.
            </p>
          </Reveal>
        </section>

        {/* Mechanism: animated block, dither texture in the bezel */}
        <section id="mechanism" className="mx-auto max-w-7xl px-6 pb-28 md:pb-36">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">One block of Tide</h2>
          </Reveal>
          <Reveal delay={0.1} className="mt-12">
            <Bezel>
              <div className="relative overflow-hidden rounded-[calc(1.5rem-0.375rem)] p-6 md:p-10">
                <div className="absolute inset-0 opacity-[0.22]">
                  <DitherField />
                </div>
                <div className="absolute inset-0 bg-gradient-to-r from-panel via-panel/90 to-panel/40" />
                <div className="relative">
                  <BlockAnimation />
                </div>
              </div>
            </Bezel>
          </Reveal>
          <Reveal delay={0.15}>
            <p className="mt-6 max-w-[64ch] text-sm leading-relaxed text-fg-3">
              Same math on both venues: three SwapVM opcodes on a redeployed Aqua router, and a v4 hook. A test asserts identical fills for identical trades.
            </p>
          </Reveal>
        </section>

        {/* Results */}
        <section id="results" className="border-t border-line">
          <div className="mx-auto grid max-w-7xl items-center gap-14 px-6 py-28 md:grid-cols-12 md:py-36">
            <Reveal className="md:col-span-7">
              <Bezel>
                <div className="p-5 md:p-7">
                  <WealthChart />
                </div>
              </Bezel>
            </Reveal>
            <div className="grid gap-12 md:col-span-5 md:pl-6">
              <Reveal><Stat value="33%" label="less arbitrage loss at λ = 0.5" sub="43% at λ = 0.25. Closed form 1/(2 − λ); a 10,000-path simulation agrees to three digits." /></Reveal>
              <Reveal delay={0.08}><Stat value="3.97×" label="less slippage for follow-on trades at N = 4" sub="Trade of 1% of active reserves." /></Reveal>
              <Reveal delay={0.16}><Stat value="+33k" label="gas per fill over a plain constant-product fill" sub="Three parameter reads and one guard. Cacheable per block." /></Reveal>
            </div>
          </div>
        </section>

        {/* Governance: flow over grain */}
        <section id="governance" className="relative overflow-hidden border-t border-line">
          <div className="absolute inset-0 opacity-70">
            <GrainBand />
          </div>
          <div className="absolute inset-0 bg-[linear-gradient(180deg,var(--bg)_0%,rgba(11,15,20,0.55)_35%,rgba(11,15,20,0.55)_65%,var(--bg)_100%)]" />
          <div className="relative mx-auto max-w-7xl px-6 py-28 md:py-36">
            <Reveal>
              <h2 className="max-w-[22ch] text-3xl font-semibold tracking-tight md:text-5xl">The knobs are ENS records. The hand on them is a human.</h2>
            </Reveal>
            <Reveal delay={0.1} className="mt-14">
              <Bezel>
                <div className="grid-lines grid md:grid-cols-4">
                  {[
                    [TextAa, "eth-usdc.tide.eth", "λ, N and δ are text records on an ENSv2 name on Sepolia. Anyone can read them. The contracts read them."],
                    [Key, "manager.tide.eth", "The agent has its own name and a role that lets it edit exactly those three records. Nothing else on the name."],
                    [Fingerprint, "World ID", "Before every write the agent asks the owner for a fresh authentication. Denied, expired or replayed means nothing is written."],
                    [Prohibit, "One call to revoke", "The owner removes the agent's role per record and drops it as manager on-chain. Inventory never moved."],
                  ].map(([Icon, t, b]) => {
                    const I = Icon as typeof TextAa;
                    return (
                      <div key={t as string} className="p-6 md:p-7">
                        <I size={22} weight="light" className="text-accent" />
                        <div className="num mt-6 text-sm text-fg">{t as string}</div>
                        <p className="mt-3 text-sm leading-relaxed text-fg-2">{b as string}</p>
                      </div>
                    );
                  })}
                </div>
              </Bezel>
            </Reveal>
          </div>
        </section>

        {/* Live */}
        <section id="live" className="mx-auto max-w-7xl px-6 py-28 md:py-36">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">Live on Sepolia</h2>
            <p className="mt-5 max-w-[58ch] text-lg leading-relaxed text-fg-2">Shipped through the official Aqua registry, filled by a resolver, swapped through the v4 hook, records written and read on-chain.</p>
          </Reveal>
          <Reveal delay={0.1} className="mt-12">
            <Bezel>
              <div className="grid-lines grid md:grid-cols-2">
                {[
                  ["TideRouter", "redeployed AquaSwapVMRouter with the three opcodes", ADDR.router],
                  ["TideHook", "Uniswap v4 hook, same math", ADDR.hook],
                  ["TideParams", "governed λ, N, δ; owner or manager only", ADDR.params],
                  ["Aqua registry", "official 1inch, inventory stays in the wallet", ADDR.aqua],
                ].map(([n, d, a]) => (
                  <a key={a} href={scan(a)} className="group flex items-center justify-between gap-6 p-6 transition-colors duration-300 hover:bg-white/[0.03] md:p-7">
                    <div>
                      <div className="font-medium">{n}</div>
                      <div className="mt-1 text-sm text-fg-3">{d}</div>
                    </div>
                    <div className="num flex shrink-0 items-center gap-3 whitespace-nowrap text-sm text-fg-2">
                      {short(a)}
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.06] transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-px" style={{ transitionTimingFunction: "var(--ease-out)" }}>
                        <ArrowUpRight size={14} />
                      </span>
                    </div>
                  </a>
                ))}
              </div>
            </Bezel>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-10 text-sm text-fg-3">
          <div>Tide, ETHGlobal Tokyo 2026. Built on arXiv 2602.09887 and 2605.19267.</div>
          <div className="flex gap-6">
            <a className="transition-colors hover:text-fg" href="https://github.com/asengupta07/tide">GitHub</a>
            <a className="transition-colors hover:text-fg" href="/WHITEPAPER.pdf">Whitepaper</a>
            <a className="transition-colors hover:text-fg" href="https://sepolia.app.ens.domains/eth-usdc.tide.eth">eth-usdc.tide.eth</a>
          </div>
        </div>
      </footer>
    </>
  );
}

import { ArrowUpRight, Fingerprint, Key, TextAa, Prohibit } from "@phosphor-icons/react/dist/ssr";

import { Nav, Reveal, Stat, Pill, Bezel } from "@/components/ui";
import { ADDR } from "@/lib/chain";
import { TideWater, GrainBand, DitherField } from "@/components/shaders";
import { LiveSplit } from "@/components/LiveSplit";
import { BlockAnimation } from "@/components/BlockAnimation";
import { WealthChart } from "@/components/WealthChart";

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
          <div className="relative mx-auto grid min-h-[100dvh] max-w-7xl items-center gap-12 px-5 pb-16 pt-28 sm:px-7 sm:pb-20 sm:pt-32 lg:grid-cols-12 lg:gap-16 lg:px-10 lg:pt-28">
            <div className="lg:col-span-7">
              <h1 className="rise max-w-[17ch] text-[2.75rem] font-semibold leading-[1.02] tracking-[-0.03em] md:text-6xl lg:text-7xl">
                Never show the whole vault.
              </h1>
              <p className="rise rise-1 mt-7 max-w-[40ch] text-lg leading-relaxed text-fg-2">
                An AMM that exposes a fraction of its inventory per block. Less lost to arbitrage, deeper prices for everyone else.
              </p>
              <div className="rise rise-2 mt-9 flex flex-wrap gap-3">
                <Pill href="/trade">Compare live quotes</Pill>
                <Pill href="/app" variant="ghost">Provide liquidity</Pill>
              </div>
            </div>
            <div className="rise rise-3 lg:col-span-5">
              <LiveSplit />
            </div>
          </div>
        </section>

        {/* The problem, one sentence */}
        <section className="mx-auto max-w-7xl px-5 py-24 sm:px-7 md:py-32 lg:px-10 lg:py-36">
          <Reveal>
            <p className="max-w-[26ch] text-3xl font-medium leading-[1.15] tracking-tight md:text-5xl">
              The first trade of every block is a robbery at yesterday&apos;s price.
            </p>
            <p className="mt-6 max-w-[52ch] text-lg leading-relaxed text-fg-2">
              It costs a constant-product pool <span className="num text-fg">σ²/8</span> of its value per unit time. Fees tax it. Batching delays it. Tide shows it less.
            </p>
          </Reveal>
        </section>

        {/* Mechanism: animated block, dither texture in the bezel */}
        <section id="mechanism" className="mx-auto max-w-7xl px-5 pb-24 sm:px-7 md:pb-32 lg:px-10 lg:pb-36">
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
              Same math, two venues: three SwapVM opcodes on 1inch Aqua and a Uniswap v4 hook, one shared library. One test, identical fills.
            </p>
          </Reveal>
        </section>

        {/* Results */}
        <section id="results" className="border-t border-line">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-5 py-24 sm:px-7 md:py-32 lg:grid-cols-12 lg:gap-16 lg:px-10 lg:py-36">
            <Reveal className="lg:col-span-7">
              <Bezel>
                <div className="p-5 md:p-7">
                  <WealthChart />
                </div>
              </Bezel>
            </Reveal>
            <div className="grid gap-10 sm:grid-cols-3 lg:col-span-5 lg:grid-cols-1 lg:gap-12 lg:pl-6">
              <Reveal><Stat value="33%" label="less arbitrage loss at λ = 0.5" sub="43% at λ = 0.25. Closed form 1/(2 − λ); a 10,000-path simulation agrees to three digits." /></Reveal>
              <Reveal delay={0.08}><Stat value="3.97×" label="less slippage for follow-on trades at N = 4" sub="Trade of 1% of active reserves." /></Reveal>
              <Reveal delay={0.16}><Stat value="+20k" label="gas per fill over a plain constant-product fill" sub="One parameter read per opcode, the block state and the guard. Swap-only, measured in Foundry." /></Reveal>
            </div>
          </div>
        </section>

        {/* Governance: flow over grain */}
        <section id="governance" className="relative overflow-hidden border-t border-line">
          <div className="absolute inset-0 opacity-70">
            <GrainBand />
          </div>
          <div className="absolute inset-0 bg-[linear-gradient(180deg,var(--bg)_0%,rgba(11,15,20,0.55)_35%,rgba(11,15,20,0.55)_65%,var(--bg)_100%)]" />
          <div className="relative mx-auto max-w-7xl px-5 py-24 sm:px-7 md:py-32 lg:px-10 lg:py-36">
            <Reveal>
              <h2 className="max-w-[22ch] text-3xl font-semibold tracking-tight md:text-5xl">The knobs are ENS records. The guardrails are the owner&apos;s.</h2>
            </Reveal>
            <Reveal delay={0.1} className="mt-14">
              <Bezel>
                <div className="grid-lines grid lg:grid-cols-4">
                  {[
                    [TextAa, "eth-usdc.tide.eth", "λ, N, δ and the fee are text records on an ENSv2 name, mirrored on-chain in TideParams. Anyone can read them; the venues trade on the mirror."],
                    [Key, "manager.tide.eth", "The manager has its own name and a resolver role for exactly three records. Inside the owner's on-chain guardrails it acts alone."],
                    [Fingerprint, "World ID", "Inside the owner's guardrails the manager acts alone. Outside them nothing moves without a fresh World ID sign-in by the owner, then the owner's wallet."],
                    [Prohibit, "Revocable", "The owner removes the manager's role per record and drops it on-chain. Inventory never moved."],
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
        <section id="live" className="mx-auto max-w-7xl px-5 py-24 sm:px-7 md:py-32 lg:px-10 lg:py-36">
          <Reveal>
            <h2 className="text-3xl font-semibold tracking-tight md:text-5xl">On-chain, now</h2>
            <p className="mt-5 max-w-[58ch] text-lg leading-relaxed text-fg-2">Shipped through the official Aqua registry, filled by a resolver, swapped through the v4 hook. Every record written and read on-chain.</p>
          </Reveal>
          <Reveal delay={0.1} className="mt-12">
            <Bezel>
              <div className="grid-lines grid md:grid-cols-2">
                {[
                  ["TideRouter", "redeployed AquaSwapVMRouter with the three opcodes", ADDR.tideRouter],
                  ["TideHook", "Uniswap v4 hook, same math", ADDR.tideHook],
                  ["TideParams", "governed λ, N, δ; owner or manager only", ADDR.tideParams],
                  ["Aqua registry", "official 1inch, inventory never leaves the wallet", ADDR.aqua],
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
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-5 py-10 text-sm text-fg-3 sm:px-7 lg:px-10">
          <div>Tide. Built on arXiv 2602.09887 and 2605.19267.</div>
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

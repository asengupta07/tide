"use client";

/**
 * Ship a Tide strategy in four signatures:
 *   1. name it        backend registers <label>.tide.eth to your wallet with your own resolver (records seeded)
 *   2. approve        WETH and USDC allowances for the Aqua registry
 *   3. parameters     TideParams.init(strategyHash, λ, N, δ, manager)
 *   4. ship           Aqua.ship(router, order, tokens, amounts); inventory stays in your wallet
 *   then optionally   enable the manager: one multicall granting setText on λ/N/δ, and bind World ID
 */
import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useAccount,
  usePublicClient,
  useWriteContract,
  useSignMessage,
} from "wagmi";
import { WalletButton } from "@/components/WalletButton";
import {
  encodeAbiParameters,
  encodeFunctionData,
  formatUnits,
  parseUnits,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { packetToBytes } from "viem/ens";
import { Check, CircleNotch, ArrowRight } from "@phosphor-icons/react";

import { Nav, Bezel } from "@/components/ui";
import {
  ADDR,
  erc20Abi,
  aquaAbi,
  tideParamsAbi,
  tideAppAbi,
  resolverAbi,
  ORDER_TUPLE,
  short,
} from "@/lib/chain";
import { ownerMessage } from "@/lib/auth";
import { TemplateConfig, type Publication } from "@/lib/sharing";
import { maxDeltaBps } from "@/lib/bounds";
import { SUPPORTED_MARKETS, marketForTokens, sortedTokens, type MarketPair, type TokenMeta } from "@/lib/tokens";

type Step = "idle" | "running" | "done" | "error";
const PARENT = "tide.eth";

/** The on-chain box (N - 1) * delta <= 2 * fee, capped at the slider's 5 % range. */
const maxDelta = (n: number, fee: number) => Math.min(500, maxDeltaBps(n, fee));

export default function NewStrategy() {
  return (
    <Suspense
      fallback={<div className="p-32 text-fg-3">Loading strategy builder…</div>}
    >
      <WizardIdentity />
    </Suspense>
  );
}
function WizardIdentity() {
  const templateId = useSearchParams().get("template");
  const { address } = useAccount();
  return (
    <StrategyWizard
      key={`${address ?? "disconnected"}:${templateId ?? "blank"}`}
    />
  );
}

function StrategyWizard() {
  const { address, isConnected } = useAccount();
  const pc = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const templateId = useSearchParams().get("template");
  const [template, setTemplate] = useState<Publication | null>(null);
  const [templateError, setTemplateError] = useState("");
  const [templateReviewed, setTemplateReviewed] = useState(false);

  const [label, setLabel] = useState("");
  const [avail, setAvail] = useState<{
    available: boolean;
    reason?: string;
  } | null>(null);
  const [lambda, setLambda] = useState(5000);
  const [n, setN] = useState(4);
  const [delta, setDelta] = useState(20);
  const [fee, setFee] = useState(30);
  const [market, setMarket] = useState<MarketPair>(SUPPORTED_MARKETS[0]);
  const [baseAmt, setBaseAmt] = useState("0.1");
  const [quoteAmt, setQuoteAmt] = useState("300");
  const [enableAgent, setEnableAgent] = useState(false);
  const saltRef = useRef<string | null>(null);

  const [steps, setSteps] = useState<
    Record<string, { s: Step; tx?: string; err?: string }>
  >({});
  const [strat, setStrat] = useState<{
    name: string;
    orderHash: Hex;
    resolver: Address;
    label: string;
    salt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!templateId) return;
    const c = new AbortController();
    fetch(`/api/publications/${encodeURIComponent(templateId)}`, {
      cache: "no-store",
      signal: c.signal,
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error);
        return j as Publication;
      })
      .then((p) => {
        if (p.kind !== "template")
          throw new Error("This link is not a template.");
        const m = marketForTokens(p.tokenA, p.tokenB);
        if (!m)
          throw new Error(
            "This template uses a token pair this app does not support yet.",
          );
        const config = TemplateConfig.parse(p.config);
        setTemplate(p);
        setMarket(m);
        setBaseAmt(m.base.symbol === "WETH" ? "0.1" : "5");
        setQuoteAmt(m.base.symbol === "WETH" ? "300" : "90");
        setLambda(config.lambda);
        setN(config.N);
        setDelta(config.delta);
        setFee(config.fee);
        setEnableAgent(false);
        setTemplateReviewed(false);
        setTemplateError("");
      })
      .catch((e) => {
        if (!c.signal.aborted) setTemplateError(e.message);
      });
    return () => c.abort();
  }, [templateId]);

  useEffect(() => {
    if (!label) return;
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const a = await fetch(
          `/api/strategy/available?label=${encodeURIComponent(label)}`,
          { signal: controller.signal },
        ).then((r) => r.json());
        if (!a.available && templateId && !controller.signal.aborted) {
          setAvail({
            available: false,
            reason:
              "Choose a new name for this template. Existing strategies keep their own settings.",
          });
          return;
        }
        if (!a.available && address) {
          // a name you registered earlier but never finished shipping: pick it up where you left off
          const mine = await fetch(
            `/api/strategy/${encodeURIComponent(label)}`,
            { signal: controller.signal },
          )
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null);
          if (
            !controller.signal.aborted &&
            mine &&
            mine.owner?.toLowerCase() === address.toLowerCase()
          ) {
            setStrat({
              name: mine.name,
              orderHash: mine.orderHash,
              resolver: mine.resolver,
              label: mine.label,
              salt: mine.salt,
            });
            return setAvail({
              available: false,
              reason: `${label}.${PARENT} is already yours; continue below to finish shipping it`,
            });
          }
        }
        if (!controller.signal.aborted) setAvail(a);
      } catch {
        if (!controller.signal.aborted)
          setAvail({
            available: false,
            reason: "Could not check this name. Try again.",
          });
      }
    }, 350);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [label, address, templateId]);

  const set = (k: string, v: { s: Step; tx?: string; err?: string }) =>
    setSteps((p) => ({ ...p, [k]: v }));
  const run = async (k: string, fn: () => Promise<string | void>) => {
    set(k, { s: "running" });
    try {
      const tx = await fn();
      set(k, { s: "done", tx: tx ?? undefined });
    } catch (e) {
      set(k, {
        s: "error",
        err:
          (e as { shortMessage?: string }).shortMessage ?? (e as Error).message,
      });
      throw e;
    }
  };
  const wait = async (hash: Hex) => {
    const rc = await pc!.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error("transaction reverted");
    return hash;
  };

  const tokensSorted = (): [Address, Address] => sortedTokens(market);

  /** Top a token up to `need`: WETH wraps ETH, the test USDC mints, anything else must already be in the wallet. */
  const topUp = async (t: TokenMeta, have: bigint, need: bigint) => {
    if (have >= need) return;
    if (t.symbol === "WETH")
      return wait(
        await writeContractAsync({ address: t.address, abi: erc20Abi, functionName: "deposit", value: need - have }),
      );
    if (t.symbol === "USDC")
      return wait(
        await writeContractAsync({ address: t.address, abi: erc20Abi, functionName: "mint", args: [address!, need - have] }),
      );
    throw new Error(`not enough ${t.symbol} in the wallet: have ${formatUnits(have, t.decimals)}, need ${formatUnits(need, t.decimals)}`);
  };

  const ship = async () => {
    if (!address || !pc || !canShip) return;
    const salt = strat?.salt ?? (saltRef.current ??= String(Date.now()));
    setBusy(true);
    try {
      // 1. name
      let s = strat;
      if (!s) {
        await run("name", async () => {
          // the registrar pays for the name, so your wallet signs the request first
          const ts = Date.now();
          const sig = await signMessageAsync({
            message: ownerMessage(
              `name ${label} for ${address.toLowerCase()}`,
              ts,
            ),
          });
          const r = await fetch("/api/strategy/create", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              label,
              owner: address,
              tokenA: market.base.address,
              tokenB: market.quote.address,
              lambdaBps: lambda,
              n,
              deltaBps: delta,
              feeBps: fee,
              salt,
              ts,
              sig,
            }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          s = {
            name: j.name,
            orderHash: j.orderHash,
            resolver: j.resolver,
            label: j.label,
            salt: j.salt ?? salt,
          };
          setStrat(s);
          return j.txs?.register;
        });
      }
      const baseWei = parseUnits(baseAmt, market.base.decimals);
      const quoteWei = parseUnits(quoteAmt, market.quote.decimals);
      const amountOf = (t: Address) => (t.toLowerCase() === market.base.address.toLowerCase() ? baseWei : quoteWei);

      // 2. balances + approvals
      await run("approve", async () => {
        const read = (t: TokenMeta, fn: "balanceOf" | "allowance") =>
          pc.readContract({
            address: t.address,
            abi: erc20Abi,
            functionName: fn,
            args: fn === "balanceOf" ? [address] : [address, ADDR.aqua],
          }) as Promise<bigint>;
        const [bb, bq] = await Promise.all([read(market.base, "balanceOf"), read(market.quote, "balanceOf")]);
        await topUp(market.base, bb, baseWei);
        await topUp(market.quote, bq, quoteWei);
        const [ab, aq] = await Promise.all([read(market.base, "allowance"), read(market.quote, "allowance")]);
        let last: Hex | undefined;
        // exact allowances: Aqua may pull at most what you ship
        for (const [t, have, need] of [
          [market.base, ab, baseWei],
          [market.quote, aq, quoteWei],
        ] as const) {
          if (have < need)
            last = await wait(
              await writeContractAsync({ address: t.address, abi: erc20Abi, functionName: "approve", args: [ADDR.aqua, need] }),
            );
        }
        return last;
      });

      // 3. params
      await run("params", async () => {
        const p = (await pc.readContract({
          address: ADDR.tideParams,
          abi: tideParamsAbi,
          functionName: "params",
          args: [s!.orderHash],
        })) as { owner: Address };
        if (p.owner !== "0x0000000000000000000000000000000000000000") return;
        const [tokenA, tokenB] = tokensSorted();
        // through TideApp: it checks you are the maker, so nobody else can claim your order hash
        return wait(
          await writeContractAsync({
            address: ADDR.tideApp,
            abi: tideAppAbi,
            functionName: "init",
            args: [
              { maker: address, tokenA, tokenB, salt: BigInt(s!.salt) },
              lambda,
              n,
              delta,
              fee,
              enableAgent
                ? ADDR.agent
                : "0x0000000000000000000000000000000000000000",
            ],
          }),
        );
      });

      if (template?.config) {
        await run("bounds", async () =>
          wait(
            await writeContractAsync({
              address: ADDR.tideParams,
              abi: tideParamsAbi,
              functionName: "setBounds",
              args: [s!.orderHash, template.config!.bounds],
            }),
          ),
        );
      }

      // 4. ship
      await run("ship", async () => {
        const [tokenA, tokenB] = tokensSorted();
        const [bal] = (await pc.readContract({
          address: ADDR.aqua,
          abi: aquaAbi,
          functionName: "rawBalances",
          args: [address, ADDR.tideRouter, s!.orderHash, tokenA],
        })) as [bigint, number];
        if (bal > 0n) return;
        const order = (await pc.readContract({
          address: ADDR.tideApp,
          abi: tideAppAbi,
          functionName: "order",
          args: [{ maker: address, tokenA, tokenB, salt: BigInt(s!.salt) }],
        })) as { maker: Address; traits: bigint; data: Hex };
        const encoded = encodeAbiParameters(ORDER_TUPLE, [
          { maker: order.maker, traits: order.traits, data: order.data },
        ]);
        const amounts = [amountOf(tokenA), amountOf(tokenB)];
        return wait(
          await writeContractAsync({
            address: ADDR.aqua,
            abi: aquaAbi,
            functionName: "ship",
            args: [ADDR.tideRouter, encoded, [tokenA, tokenB], amounts],
          }),
        );
      });

      // 5. delegate to the manager: one multicall, three key-scoped grants
      if (enableAgent) {
        await run("delegate", async () => {
          const dns = toHex(packetToBytes(s!.name));
          const calls = ["lambda", "N", "delta"].map((k) =>
            encodeFunctionData({
              abi: resolverAbi,
              functionName: "grantSetterRoles",
              args: [
                encodeFunctionData({
                  abi: resolverAbi,
                  functionName: "setText",
                  args: [dns, k, ""],
                }),
                ADDR.agent,
              ],
            }),
          );
          return wait(
            await writeContractAsync({
              address: s!.resolver,
              abi: resolverAbi,
              functionName: "multicall",
              args: [calls],
            }),
          );
        });
      }
      router.push(`/app/${s!.label}?new=1`);
    } catch {
      /* step state carries the error */
    } finally {
      setBusy(false);
    }
  };

  const amountOk = (v: string, dec: number) =>
    /^\d+(\.\d+)?$/.test(v) &&
    Number(v) > 0 &&
    (v.split(".")[1]?.length ?? 0) <= dec;
  const canShip =
    isConnected &&
    (avail?.available || !!strat) &&
    amountOk(baseAmt, market.base.decimals) &&
    amountOk(quoteAmt, market.quote.decimals) &&
    !busy &&
    (!templateId ||
      (template?.id === templateId && templateReviewed && !templateError)) &&
    (n - 1) * delta <= 2 * fee;

  return (
    <>
      <Nav current="app" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 pt-28 sm:px-7 sm:pt-32 lg:px-10">
        <h1 className="text-4xl font-semibold tracking-tight">New strategy</h1>
        <p className="mt-2 max-w-[56ch] text-fg-2">
          Name it, choose how much of your inventory a block may see, ship. Your
          tokens stay in your wallet; Aqua pulls only at fill time.
        </p>

        <p className="mt-3 text-xs text-fg-3">
          New strategies are unlisted. Publish to Explore later from your
          strategy dashboard. On-chain records remain public.
        </p>
        {templateId && (
          <Bezel small className="mt-8">
            <section className="p-6">
              <div className="text-xs uppercase tracking-[0.2em] text-accent">
                Start from a shared idea
              </div>
              {templateError ? (
                <div role="alert" className="mt-3 text-bad">
                  {templateError}
                  <Link href="/app/new" className="ml-3 text-accent">
                    Start from scratch →
                  </Link>
                </div>
              ) : template?.id !== templateId ? (
                <p role="status" className="mt-3 text-fg-2">
                  Loading template…
                </p>
              ) : (
                <>
                  <h2 className="mt-3 text-2xl font-semibold">
                    {template.title}
                  </h2>
                  <p className="mt-2 text-xs text-fg-3">
                    By {short(template.owner)} · {market.base.symbol} / {market.quote.symbol} · Saved{" "}
                    {new Date(template.updatedAt).toLocaleDateString()}
                  </p>
                  <p className="mt-4 whitespace-pre-wrap break-words text-sm text-fg-2">
                    {template.description}
                  </p>
                  <p className="mt-4 text-sm text-fg-2">
                    {template.config!.lambda / 100}% exposure ·{" "}
                    {template.config!.N}× depth · {template.config!.delta / 100}
                    % drift · {template.config!.fee / 100}% fee
                  </p>
                  <p className="mt-2 text-sm text-fg-2">
                    Manager guardrails:{" "}
                    {template.config!.bounds.lambdaMin / 100}–
                    {template.config!.bounds.lambdaMax / 100}% exposure; max
                    depth {template.config!.bounds.nMax}×; max step{" "}
                    {template.config!.bounds.maxStepBps / 100} points; cooldown{" "}
                    {template.config!.bounds.cooldown}s.
                  </p>
                  <label className="mt-5 flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      disabled={busy || !!strat}
                      checked={templateReviewed}
                      onChange={(e) => setTemplateReviewed(e.target.checked)}
                      className="mt-1"
                    />
                    <span>
                      I have reviewed these parameters and guardrails. This
                      creates my own unlisted strategy. Agent access is optional
                      and stays off until I enable it below.
                    </span>
                  </label>
                  <p className="mt-3 text-xs text-fg-3">
                    You can adjust parameters below. Copied guardrails are
                    applied in a separate wallet transaction, and can be edited
                    on your dashboard.
                  </p>
                </>
              )}
            </section>
          </Bezel>
        )}

        {!isConnected && (
          <div className="mt-10 flex flex-col items-start gap-4 rounded-2xl border border-dashed border-white/10 p-6 text-sm text-fg-2 sm:flex-row sm:items-center">
            Connect a wallet to begin. <WalletButton size="md" />
          </div>
        )}

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <Bezel>
            <fieldset
              disabled={busy || (!!templateId && template?.id !== templateId)}
              className="space-y-8 p-6 md:p-8"
            >
              <Field
                label="Name"
                hint={
                  avail
                    ? avail.available
                      ? `${label}.${PARENT} is free`
                      : (avail.reason ?? "taken")
                    : `becomes <label>.${PARENT}, owned by your wallet`
                }
                ok={avail?.available}
              >
                <div className="flex items-center gap-2">
                  <input
                    value={label}
                    onChange={(e) => {
                      setLabel(
                        e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                      );
                      setAvail(null);
                      setStrat(null);
                      setSteps({});
                      saltRef.current = null;
                    }}
                    placeholder="eth-usdc-2"
                    className="num w-full rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-fg outline-none focus:border-accent"
                  />
                  <span className="num shrink-0 text-fg-3">.{PARENT}</span>
                </div>
              </Field>

              <Field
                label={`λ, inventory exposed per block: ${lambda / 100}%`}
                hint="lower cuts arbitrage loss, raises drift. The frontier suggests 50% at 60% volatility."
              >
                <input
                  disabled={!!strat}
                  type="range"
                  aria-label="visibility per block, percent"
                  aria-valuetext={`${lambda / 100} percent`}
                  min={1}
                  max={10000}
                  step={1}
                  value={lambda}
                  onChange={(e) => setLambda(Number(e.target.value))}
                  className="w-full"
                />
              </Field>
              <div className="grid gap-5 sm:grid-cols-3">
                <Field
                  label={`Fee: ${fee / 100}%`}
                  hint="on every trade; it is what backs the deep curve"
                >
                  <input
                    disabled={!!strat}
                    type="range"
                    aria-label="fee, percent"
                    aria-valuetext={`${fee / 100} percent`}
                    min={0}
                    max={Math.max(100, fee)}
                    step={1}
                    value={fee}
                    onChange={(e) => {
                      const f = Number(e.target.value);
                      setFee(f);
                      setDelta((d) => Math.min(d, maxDelta(n, f)));
                    }}
                    className="w-full"
                  />
                </Field>
                <Field
                  label={`N, virtual depth: ${n}×`}
                  hint="follow-on trades see a pool N times deeper"
                >
                  <input
                    disabled={!!strat}
                    type="range"
                    aria-label="virtual depth multiplier"
                    aria-valuetext={`${n} times`}
                    min={1}
                    max={64}
                    step={1}
                    value={n}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setN(v);
                      setDelta((d) => Math.min(d, maxDelta(v, fee)));
                    }}
                    className="w-full"
                  />
                </Field>
                <Field
                  label={`δ, drift bound: ${delta / 100}%`}
                  hint={`max price move the deep curve honours; the fee backs up to ${maxDelta(n, fee) / 100}% at ${n}×`}
                >
                  <input
                    disabled={!!strat}
                    type="range"
                    aria-label="drift band, percent"
                    aria-valuetext={`${delta / 100} percent`}
                    min={0}
                    max={Math.max(delta, maxDelta(n, fee))}
                    step={1}
                    value={delta}
                    onChange={(e) => setDelta(Number(e.target.value))}
                    className="w-full"
                  />
                </Field>
              </div>

              <Field
                label="Pair"
                hint={templateId ? "set by the template" : "the two tokens this strategy quotes"}
              >
                <div className="flex flex-wrap gap-2">
                  {SUPPORTED_MARKETS.map((m) => (
                    <button
                      key={m.key}
                      type="button"
                      disabled={!!templateId || busy || !!strat}
                      aria-pressed={m.key === market.key}
                      onClick={() => {
                        setMarket(m);
                        setBaseAmt(m.base.symbol === "WETH" ? "0.1" : "5");
                        setQuoteAmt(m.base.symbol === "WETH" ? "300" : "90");
                      }}
                      className={`h-9 rounded-full border px-4 text-sm transition-colors disabled:opacity-60 ${m.key === market.key ? "border-accent/60 bg-accent/10 text-fg" : "border-white/10 text-fg-3 hover:text-fg-2"}`}
                    >
                      {m.base.symbol} / {m.quote.symbol}
                    </button>
                  ))}
                </div>
              </Field>

              <div className="grid gap-5 sm:grid-cols-2">
                {(
                  [
                    [market.base, baseAmt, setBaseAmt],
                    [market.quote, quoteAmt, setQuoteAmt],
                  ] as const
                ).map(([t, v, set]) => (
                  <Field
                    key={t.symbol}
                    label={`${t.symbol} inventory`}
                    hint={t.symbol === "WETH" ? "wrapped from ETH if short" : t.symbol === "USDC" ? "minted if short" : "must be in your wallet"}
                  >
                    <input
                      aria-label={`${t.symbol} inventory`}
                      inputMode="decimal"
                      value={v}
                      onChange={(e) => set(e.target.value.trim())}
                      className={`num w-full rounded-xl border bg-white/[0.03] px-4 py-3 outline-none focus:border-accent ${v && !amountOk(v, t.decimals) ? "border-bad/50" : "border-white/10"}`}
                    />
                  </Field>
                ))}
              </div>

              <label className="flex items-start gap-3 text-sm">
                <input
                  disabled={!!strat}
                  type="checkbox"
                  checked={enableAgent}
                  onChange={(e) => setEnableAgent(e.target.checked)}
                  className="mt-1 accent-[var(--accent)]"
                />
                <span>
                  <span className="text-fg">
                    Let manager.tide.eth propose parameter changes
                  </span>
                  <span className="block text-xs text-fg-3">
                    Grants the agent setText on exactly λ, N and δ. Inside the{" "}
                    {template
                      ? "template guardrails reviewed above"
                      : "default guardrails (10% to 90% visibility, at most 25 points per change, one change an hour, N up to 8)"}
                    , which you can edit later, it applies changes itself;
                    beyond them it needs your fresh World ID sign-in and your
                    wallet. Revocable in one call.
                  </span>
                </span>
              </label>

              <button
                disabled={!canShip}
                onClick={ship}
                className="pill pill-primary disabled:opacity-40"
              >
                <span>{busy ? "Working…" : "Ship strategy"}</span>
                <span className="ico">
                  {busy ? (
                    <CircleNotch size={15} className="animate-spin" />
                  ) : (
                    <ArrowRight size={15} />
                  )}
                </span>
              </button>
            </fieldset>
          </Bezel>

          <Bezel small>
            <ol className="space-y-3 p-5">
              {[
                [
                  "name",
                  "Register the name",
                  "backend signs; resolver + subname to your wallet",
                ],
                [
                  "approve",
                  "Fund and approve",
                  "wrap / mint if short, approve Aqua",
                ],
                [
                  "params",
                  "Set parameters",
                  "TideApp.init from your wallet; guardrails start at their defaults",
                ],
                ...(template
                  ? [
                      [
                        "bounds",
                        "Apply template guardrails",
                        "your wallet sets the reviewed limits",
                      ],
                    ]
                  : []),
                ["ship", "Ship on Aqua", "one signature, nothing moves"],
                ...(enableAgent
                  ? [
                      [
                        "delegate",
                        "Delegate to the manager",
                        "three scoped grants in one multicall",
                      ],
                    ]
                  : []),
              ].map(([k, t, d]) => {
                const st = steps[k];
                return (
                  <li key={k} className="flex gap-3">
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] ${st?.s === "done" ? "border-accent bg-accent text-accent-ink" : st?.s === "running" ? "border-accent text-accent" : st?.s === "error" ? "border-bad text-bad" : "border-white/15 text-fg-3"}`}
                    >
                      {st?.s === "done" ? (
                        <Check size={12} weight="bold" />
                      ) : st?.s === "running" ? (
                        <CircleNotch size={12} className="animate-spin" />
                      ) : null}
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm text-fg">{t}</div>
                      <div className="text-xs text-fg-3">{d}</div>
                      {st?.tx && (
                        <a
                          className="num text-xs text-accent"
                          href={`https://sepolia.etherscan.io/tx/${st.tx}`}
                        >
                          {short(st.tx)}
                        </a>
                      )}
                      {st?.err && (
                        <div className="text-xs text-bad">{st.err}</div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </Bezel>
        </div>
      </main>
    </>
  );
}

function Field({
  label,
  hint,
  ok,
  children,
}: {
  label: string;
  hint?: string;
  ok?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm text-fg">{label}</label>
      {children}
      {hint && (
        <div
          className={`mt-1.5 text-xs ${ok === true ? "text-accent" : ok === false ? "text-bad" : "text-fg-3"}`}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

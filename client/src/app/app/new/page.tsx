'use client';

/**
 * Ship a Tide strategy in four signatures:
 *   1. name it        backend registers <label>.tide.eth to your wallet with your own resolver (records seeded)
 *   2. approve        WETH and USDC allowances for the Aqua registry
 *   3. parameters     TideParams.init(strategyHash, λ, N, δ, manager)
 *   4. ship           Aqua.ship(router, order, tokens, amounts); inventory stays in your wallet
 *   then optionally   enable the manager: one multicall granting setText on λ/N/δ, and bind World ID
 */
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  useAccount,
  usePublicClient,
  useWriteContract,
  useSignMessage,
} from 'wagmi';
import { WalletButton } from '@/components/WalletButton';
import {
  encodeAbiParameters,
  encodeFunctionData,
  parseEther,
  parseUnits,
  toHex,
  type Address,
  type Hex,
} from 'viem';
import { packetToBytes } from 'viem/ens';
import { Check, CircleNotch, ArrowRight } from '@phosphor-icons/react';

import { Nav, Bezel } from '@/components/ui';
import {
  ADDR,
  erc20Abi,
  aquaAbi,
  tideParamsAbi,
  tideAppAbi,
  resolverAbi,
  ORDER_TUPLE,
  short,
} from '@/lib/chain';
import { ownerMessage } from '@/lib/auth';
import { maxDeltaBps } from '@/lib/bounds';

type Step = 'idle' | 'running' | 'done' | 'error';
const PARENT = 'tide.eth';

/** The on-chain box (N - 1) * delta <= 2 * fee, capped at the slider's 5 % range. */
const maxDelta = (n: number, fee: number) => Math.min(500, maxDeltaBps(n, fee));

export default function NewStrategy() {
  const { address, isConnected } = useAccount();
  const pc = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();

  const [label, setLabel] = useState('');
  const [avail, setAvail] = useState<{
    available: boolean;
    reason?: string;
  } | null>(null);
  const [lambda, setLambda] = useState(5000);
  const [n, setN] = useState(4);
  const [delta, setDelta] = useState(20);
  const [fee, setFee] = useState(30);
  const [weth, setWeth] = useState('0.1');
  const [usdc, setUsdc] = useState('300');
  const [enableAgent, setEnableAgent] = useState(true);
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
    if (!label) return;
    const t = setTimeout(
      () =>
        fetch(`/api/strategy/available?label=${encodeURIComponent(label)}`)
          .then((r) => r.json())
          .then(setAvail),
      350,
    );
    return () => clearTimeout(t);
  }, [label]);

  const set = (k: string, v: { s: Step; tx?: string; err?: string }) =>
    setSteps((p) => ({ ...p, [k]: v }));
  const run = async (k: string, fn: () => Promise<string | void>) => {
    set(k, { s: 'running' });
    try {
      const tx = await fn();
      set(k, { s: 'done', tx: tx ?? undefined });
    } catch (e) {
      set(k, {
        s: 'error',
        err:
          (e as { shortMessage?: string }).shortMessage ?? (e as Error).message,
      });
      throw e;
    }
  };
  const wait = async (hash: Hex) => {
    const rc = await pc!.waitForTransactionReceipt({ hash });
    if (rc.status !== 'success') throw new Error('transaction reverted');
    return hash;
  };

  const tokensSorted = (): [Address, Address] =>
    ADDR.weth.toLowerCase() < ADDR.usdc.toLowerCase()
      ? [ADDR.weth, ADDR.usdc]
      : [ADDR.usdc, ADDR.weth];

  const ship = async () => {
    if (!address || !pc) return;
    const strategySalt = saltRef.current ?? String(Date.now());
    saltRef.current = strategySalt;
    setBusy(true);
    try {
      // 1. name
      let s = strat;
      if (!s) {
        await run('name', async () => {
          const r = await fetch('/api/strategy/create', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              label,
              owner: address,
              lambdaBps: lambda,
              n,
              deltaBps: delta,
              feeBps: fee,
              salt: strategySalt,
            }),
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error);
          s = {
            name: j.name,
            orderHash: j.orderHash,
            resolver: j.resolver,
            label: j.label,
            salt: j.salt ?? strategySalt,
          };
          setStrat(s);
          return j.txs?.register;
        });
      }
      const wethAmt = parseEther(weth);
      const usdcAmt = parseUnits(usdc, 6);

      // 2. balances + approvals
      await run('approve', async () => {
        const [bw, bu] = await Promise.all([
          pc.readContract({
            address: ADDR.weth,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          }),
          pc.readContract({
            address: ADDR.usdc,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          }),
        ]);
        if (bw < wethAmt)
          await wait(
            await writeContractAsync({
              address: ADDR.weth,
              abi: erc20Abi,
              functionName: 'deposit',
              value: wethAmt - bw,
            }),
          );
        if (bu < usdcAmt)
          await wait(
            await writeContractAsync({
              address: ADDR.usdc,
              abi: erc20Abi,
              functionName: 'mint',
              args: [address, usdcAmt - bu],
            }),
          );
        const [aw, au] = await Promise.all([
          pc.readContract({
            address: ADDR.weth,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [address, ADDR.aqua],
          }),
          pc.readContract({
            address: ADDR.usdc,
            abi: erc20Abi,
            functionName: 'allowance',
            args: [address, ADDR.aqua],
          }),
        ]);
        let last: Hex | undefined;
        // exact allowances: Aqua may pull at most what you ship
        if (aw < wethAmt)
          last = await wait(
            await writeContractAsync({
              address: ADDR.weth,
              abi: erc20Abi,
              functionName: 'approve',
              args: [ADDR.aqua, wethAmt],
            }),
          );
        if (au < usdcAmt)
          last = await wait(
            await writeContractAsync({
              address: ADDR.usdc,
              abi: erc20Abi,
              functionName: 'approve',
              args: [ADDR.aqua, usdcAmt],
            }),
          );
        return last;
      });

      // 3. params
      await run('params', async () => {
        const p = (await pc.readContract({
          address: ADDR.tideParams,
          abi: tideParamsAbi,
          functionName: 'params',
          args: [s!.orderHash],
        })) as { owner: Address };
        if (p.owner !== '0x0000000000000000000000000000000000000000') return;
        const [tokenA, tokenB] = tokensSorted();
        // through TideApp: it checks you are the maker, so nobody else can claim your order hash
        return wait(
          await writeContractAsync({
            address: ADDR.tideApp,
            abi: tideAppAbi,
            functionName: 'init',
            args: [
              { maker: address, tokenA, tokenB, salt: BigInt(s!.salt) },
              lambda,
              n,
              delta,
              fee,
              enableAgent
                ? ADDR.agent
                : '0x0000000000000000000000000000000000000000',
            ],
          }),
        );
      });

      // 4. ship
      await run('ship', async () => {
        const [tokenA, tokenB] = tokensSorted();
        const [bal] = (await pc.readContract({
          address: ADDR.aqua,
          abi: aquaAbi,
          functionName: 'rawBalances',
          args: [address, ADDR.tideRouter, s!.orderHash, tokenA],
        })) as [bigint, number];
        if (bal > 0n) return;
        const order = (await pc.readContract({
          address: ADDR.tideApp,
          abi: tideAppAbi,
          functionName: 'order',
          args: [
            { maker: address, tokenA, tokenB, salt: BigInt(strategySalt) },
          ],
        })) as { maker: Address; traits: bigint; data: Hex };
        const encoded = encodeAbiParameters(ORDER_TUPLE, [
          { maker: order.maker, traits: order.traits, data: order.data },
        ]);
        const amounts =
          tokenA === ADDR.weth ? [wethAmt, usdcAmt] : [usdcAmt, wethAmt];
        return wait(
          await writeContractAsync({
            address: ADDR.aqua,
            abi: aquaAbi,
            functionName: 'ship',
            args: [ADDR.tideRouter, encoded, [tokenA, tokenB], amounts],
          }),
        );
      });

      // 5. delegate to the manager: one multicall, three key-scoped grants
      if (enableAgent) {
        await run('delegate', async () => {
          const dns = toHex(packetToBytes(s!.name));
          const calls = ['lambda', 'N', 'delta'].map((k) =>
            encodeFunctionData({
              abi: resolverAbi,
              functionName: 'grantSetterRoles',
              args: [
                encodeFunctionData({
                  abi: resolverAbi,
                  functionName: 'setText',
                  args: [dns, k, ''],
                }),
                ADDR.agent,
              ],
            }),
          );
          return wait(
            await writeContractAsync({
              address: s!.resolver,
              abi: resolverAbi,
              functionName: 'multicall',
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
    (v.split('.')[1]?.length ?? 0) <= dec;
  const canShip =
    isConnected &&
    (avail?.available || !!strat) &&
    amountOk(weth, 18) &&
    amountOk(usdc, 6) &&
    !busy;

  return (
    <>
      <Nav current="app" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 pt-28 sm:px-7 sm:pt-32 lg:px-10">
        <h1 className="text-4xl font-semibold tracking-tight">New strategy</h1>
        <p className="mt-2 max-w-[56ch] text-fg-2">
          Name it, choose how much of your inventory a block may see, ship. Your
          tokens stay in your wallet; Aqua pulls only at fill time.
        </p>

        {!isConnected && (
          <div className="mt-10 flex flex-col items-start gap-4 rounded-2xl border border-dashed border-white/10 p-6 text-sm text-fg-2 sm:flex-row sm:items-center">
            Connect a wallet to begin. <WalletButton size="md" />
          </div>
        )}

        <div className="mt-10 grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <Bezel>
            <div className="space-y-8 p-6 md:p-8">
              <Field
                label="Name"
                hint={
                  avail
                    ? avail.available
                      ? `${label}.${PARENT} is free`
                      : (avail.reason ?? 'taken')
                    : `becomes <label>.${PARENT}, owned by your wallet`
                }
                ok={avail?.available}
              >
                <div className="flex items-center gap-2">
                  <input
                    value={label}
                    onChange={(e) => {
                      const next = e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]/g, '');
                      setLabel(next);
                      if (!next) setAvail(null);
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
                  type="range"
                  aria-label="visibility per block, percent"
                  aria-valuetext={`${lambda / 100} percent`}
                  min={500}
                  max={10000}
                  step={100}
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
                    type="range"
                    aria-label="fee, percent"
                    aria-valuetext={`${fee / 100} percent`}
                    min={1}
                    max={100}
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
                    type="range"
                    aria-label="virtual depth multiplier"
                    aria-valuetext={`${n} times`}
                    min={1}
                    max={16}
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
                    type="range"
                    aria-label="drift band, percent"
                    aria-valuetext={`${delta / 100} percent`}
                    min={1}
                    max={Math.max(1, maxDelta(n, fee))}
                    step={1}
                    value={delta}
                    onChange={(e) => setDelta(Number(e.target.value))}
                    className="w-full"
                  />
                </Field>
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="WETH inventory" hint="wrapped from ETH if short">
                  <input
                    aria-label="WETH inventory"
                    inputMode="decimal"
                    value={weth}
                    onChange={(e) => setWeth(e.target.value.trim())}
                    className={`num w-full rounded-xl border bg-white/[0.03] px-4 py-3 outline-none focus:border-accent ${weth && !amountOk(weth, 18) ? 'border-bad/50' : 'border-white/10'}`}
                  />
                </Field>
                <Field label="USDC inventory" hint="minted if short">
                  <input
                    aria-label="USDC inventory"
                    inputMode="decimal"
                    value={usdc}
                    onChange={(e) => setUsdc(e.target.value.trim())}
                    className={`num w-full rounded-xl border bg-white/[0.03] px-4 py-3 outline-none focus:border-accent ${usdc && !amountOk(usdc, 6) ? 'border-bad/50' : 'border-white/10'}`}
                  />
                </Field>
              </div>

              <label className="flex items-start gap-3 text-sm">
                <input
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
                    Grants the agent setText on exactly λ, N and δ. Inside
                    guardrails you can edit later (10% to 90% visibility, at
                    most 25 points per change, one change an hour, N up to 8) it
                    applies changes itself; beyond them it needs your fresh
                    World ID sign-in and your wallet. Revocable in one call.
                  </span>
                </span>
              </label>

              <button
                disabled={!canShip}
                onClick={ship}
                className="pill pill-primary disabled:opacity-40"
              >
                <span>{busy ? 'Working…' : 'Ship strategy'}</span>
                <span className="ico">
                  {busy ? (
                    <CircleNotch size={15} className="animate-spin" />
                  ) : (
                    <ArrowRight size={15} />
                  )}
                </span>
              </button>
            </div>
          </Bezel>

          <Bezel small>
            <ol className="space-y-3 p-5">
              {[
                [
                  'name',
                  'Register the name',
                  'backend signs; resolver + subname to your wallet',
                ],
                [
                  'approve',
                  'Fund and approve',
                  'wrap / mint if short, approve Aqua',
                ],
                [
                  'params',
                  'Set parameters',
                  'TideApp.init from your wallet; guardrails start at their defaults',
                ],
                ['ship', 'Ship on Aqua', 'one signature, nothing moves'],
                ...(enableAgent
                  ? [
                      [
                        'delegate',
                        'Delegate to the manager',
                        'three scoped grants in one multicall',
                      ],
                    ]
                  : []),
              ].map(([k, t, d]) => {
                const st = steps[k];
                return (
                  <li key={k} className="flex gap-3">
                    <span
                      className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] ${st?.s === 'done' ? 'border-accent bg-accent text-accent-ink' : st?.s === 'running' ? 'border-accent text-accent' : st?.s === 'error' ? 'border-bad text-bad' : 'border-white/15 text-fg-3'}`}
                    >
                      {st?.s === 'done' ? (
                        <Check size={12} weight="bold" />
                      ) : st?.s === 'running' ? (
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
          className={`mt-1.5 text-xs ${ok === true ? 'text-accent' : ok === false ? 'text-bad' : 'text-fg-3'}`}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

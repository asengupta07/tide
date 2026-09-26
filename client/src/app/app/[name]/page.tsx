'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  useAccount,
  useSignMessage,
  useWriteContract,
  usePublicClient,
} from 'wagmi';
import { type Hex } from 'viem';
import { ADDR, tideParamsAbi } from '@/lib/chain';
import { ownerMessage } from '@/lib/auth';
import {
  ArrowUpRight,
  ArrowRight,
  ShieldCheck,
  Fingerprint,
  Sparkle,
  CaretDown,
  CircleNotch,
  Fire,
  X,
} from '@phosphor-icons/react';

import { Nav, Bezel, Status } from '@/components/ui';
import { FrontierChart } from '@/components/FrontierChart';
import { CandleChart } from '@/components/CandleChart';
import { ImpactCurve } from '@/components/ImpactCurve';
import { TradePanel } from '@/components/TradePanel';
import { DitherField } from '@/components/shaders';

type Mgr = {
  sigma: number | null;
  measuredAt: number | null;
  ethPrice: number | null;
  lambdaStar: number | null;
  lastTick?: number;
  nextTick?: number;
  lastResult?: string;
  tickMinutes: number;
  minMoveBps: number;
  approvalSeconds?: number;
};

type Snapshot = {
  strategy: {
    label: string;
    name: string;
    owner: string;
    resolver: string;
    orderHash: string;
    tokenA: string;
    tokenB: string;
    salt: string;
  };
  agentEnabled: boolean;
  records: {
    name: string;
    lambda: number;
    N: number;
    delta: number;
    fee?: number;
    strategyHash: string;
  };
  onchain: {
    lambda: number;
    N: number;
    delta: number;
    fee: number;
    owner: string;
    manager: string;
  } | null;
  bounds: {
    lambdaMin: number;
    lambdaMax: number;
    nMax: number;
    maxStepBps: number;
    cooldown: number;
    lastManagerSet: number;
  } | null;
  block: {
    blockNumber: number;
    active: { weth: string; usdc: string };
    total: { weth: string; usdc: string };
  } | null;
  fills: {
    block: number;
    at: number | null;
    logIndex: number | null;
    tx: string;
    taker: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    amountOut: string;
  }[];
  proposals: {
    id: string;
    status: string;
    from: { lambda: number; N: number; delta: number };
    to: { lambda: number; N: number; delta: number };
    reason: string;
    sigma: number;
    approvalUrl?: string;
    blockedReason?: string;
    txs?: { ens?: string; params?: string };
    createdAt: number;
    auto?: boolean;
    outside?: string;
    needsApproval?: boolean;
  }[];
  log: { at: number; level: string; msg: string }[];
  deployment: {
    tideParams: string;
    tideRouter: string;
    tideApp: string;
    aqua: string;
    weth: string;
  };
  agent: string;
  bound: { subject: string; issuer: string; boundAt: number } | null;
  stale?: boolean;
  error?: string;
};

const num = (wei: string | undefined, dec: number) =>
  wei ? Number(BigInt(wei)) / 10 ** dec : 0;
const fmt = (v: number, d = 2) =>
  v.toLocaleString(undefined, { maximumFractionDigits: d });
const short = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : '');
const WETH = '0xfff9976782d46cc05630d1f6ebab18b2324d6b14';
const tx = (h?: string) => `https://sepolia.etherscan.io/tx/${h}`;
const ago = (t: number, now: number | null) => {
  if (now === null) return 'just now';
  const m = Math.round((now - t) / 60000);
  return m < 1
    ? 'just now'
    : m < 60
      ? `${m} min ago`
      : m < 1440
        ? `${Math.round(m / 60)} h ago`
        : `${Math.round(m / 1440)} d ago`;
};
const STATUS_TEXT: Record<string, string> = {
  pending: 'Waiting for your approval',
  approved: 'Approved. Outside your guardrails, so your wallet applies it',
  applied: 'Applied',
  blocked: 'Declined, nothing changed',
  expired: 'Timed out, nothing changed',
  failed: 'Approved but the write failed',
};

export default function Dashboard() {
  const { name } = useParams<{ name: string }>();
  const q = useSearchParams();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [s, setS] = useState<Snapshot | null>(null);
  const [sigma, setSigma] = useState(0.8);
  const [busy, setBusy] = useState(false);
  const [proposeErr, setProposeErr] = useState<string | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [mgr, setMgr] = useState<Mgr | null>(null);
  const sigmaTouchedRef = useRef(false); // the poll closes over the first render; a ref sees the click
  const [now, setNow] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null); // the suggestion shown in the modal

  const refresh = useCallback(async () => {
    // a failed poll (server restarting, offline) keeps the last snapshot on screen
    try {
      const [r, m] = await Promise.all([
        fetch(`/api/state?strategy=${encodeURIComponent(name)}`, {
          cache: 'no-store',
        }),
        fetch(`/api/agent/status`, { cache: 'no-store' })
          .then((x) => x.json())
          .catch(() => null),
      ]);
      if (r.ok) setS(await r.json());
      if (m) {
        setMgr(m);
        if (!sigmaTouchedRef.current && m.sigma)
          setSigma(Math.round(m.sigma * 20) / 20);
      }
      setNow(Date.now());
    } catch {
      // next tick retries
    }
  }, [name]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const interval = window.setInterval(() => void refresh(), 8000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(interval);
    };
  }, [refresh]);

  const propose = async () => {
    if (!s) return;
    setBusy(true);
    setProposeErr(null);
    try {
      const ts = Date.now();
      const sig = await signMessageAsync({
        message: ownerMessage(`ask the manager on ${s.strategy.name}`, ts),
      });
      const r = await fetch('/api/agent/propose', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ strategy: name, sigma, ts, sig }),
      });
      const p = await r.json();
      if (!r.ok) setProposeErr(p.error);
      else setFocusId(p.id);
      await refresh();
    } catch (e) {
      setProposeErr((e as Error).message.split('\n')[0]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Nav current="app" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-5 pb-20 pt-28 sm:px-7 sm:pt-32 lg:px-10">
        {!s ? (
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-3xl bg-white/[0.03]"
              />
            ))}
          </div>
        ) : s.error ? (
          <div className="rounded-3xl border border-bad/30 p-6 text-bad">
            {s.error}
          </div>
        ) : (
          <Body
            s={s}
            refresh={refresh}
            proposeErr={proposeErr}
            focusId={focusId}
            setFocusId={setFocusId}
            mgr={mgr}
            now={now}
            sigma={sigma}
            setSigma={(v) => {
              sigmaTouchedRef.current = true;
              setSigma(v);
            }}
            propose={propose}
            busy={busy}
            isOwner={
              !!address &&
              address.toLowerCase() === s.strategy.owner.toLowerCase()
            }
            justShipped={q.get('new') === '1'}
            advanced={advanced}
            setAdvanced={setAdvanced}
          />
        )}
      </main>
    </>
  );
}

function Body({
  s,
  mgr,
  now,
  sigma,
  proposeErr,
  setSigma,
  propose,
  busy,
  isOwner,
  justShipped,
  advanced,
  setAdvanced,
  refresh,
  focusId,
  setFocusId,
}: {
  s: Snapshot;
  refresh: () => Promise<void>;
  proposeErr: string | null;
  focusId: string | null;
  setFocusId: (id: string | null) => void;
  mgr: Mgr | null;
  now: number | null;
  sigma: number;
  setSigma: (n: number) => void;
  propose: () => void;
  busy: boolean;
  isOwner: boolean;
  justShipped: boolean;
  advanced: boolean;
  setAdvanced: (b: boolean) => void;
}) {
  const lambda = s.records.lambda / 100;
  const delta = s.records.delta / 100;
  const feeBps = s.onchain?.fee ?? s.records.fee ?? 30;
  const rebate = ((s.records.N - 1) * s.records.delta) / 2; // bps, the deep curve's best price improvement
  const w = {
    a: num(s.block?.active.weth, 18),
    t: num(s.block?.total.weth, 18),
  };
  const u = { a: num(s.block?.active.usdc, 6), t: num(s.block?.total.usdc, 6) };
  const hasSplit = (s.block?.blockNumber ?? 0) > 0;
  const pending = s.proposals.find((p) => p.status === 'pending');
  const focus = focusId ? s.proposals.find((p) => p.id === focusId) : undefined;
  useEffect(() => {
    if (!focusId) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFocusId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusId, setFocusId]);
  const fills = [...s.fills].reverse();
  const syncing =
    s.onchain &&
    (s.onchain.lambda !== s.records.lambda ||
      s.onchain.N !== s.records.N ||
      s.onchain.delta !== s.records.delta);
  const volatilityLabel =
    sigma <= 0.35
      ? 'Calm'
      : sigma <= 0.7
        ? 'Normal'
        : sigma <= 1
          ? 'Volatile'
          : 'Wild';
  const volatilityProgress = Math.round(((sigma - 0.2) / 1) * 100);
  const isHot = sigma >= 0.75;
  const volatilityHeat = Math.max(
    0,
    Math.min(1, (volatilityProgress - 55) / 45),
  );

  return (
    <>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="text-sm text-fg-3">
            {isOwner
              ? 'Your strategy'
              : `Strategy owned by ${short(s.strategy.owner)}`}
          </div>
          <h1 className="num mt-1 text-3xl font-semibold tracking-tight md:text-4xl">
            {s.records.name}
          </h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-fg-2">
            <ShieldCheck size={15} className="text-accent" />{' '}
            {isOwner
              ? 'Inventory in your wallet'
              : "Inventory stays in the owner's wallet"}
          </span>
          {s.stale && (
            <span
              className="inline-flex items-center gap-2 rounded-full border border-warn/40 px-3 py-1.5 text-warn"
              title="The last read from the chain failed; showing the previous snapshot."
            >
              Showing cached data
            </span>
          )}
          {s.agentEnabled && (
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 px-3 py-1.5 text-fg-2">
              <Sparkle size={15} className="text-accent" /> Manager on
            </span>
          )}
        </div>
      </div>

      {justShipped && (
        <div className="mt-6 rounded-2xl border border-accent/30 bg-accent/[0.06] p-5 text-sm leading-relaxed text-fg-2">
          Shipped. Nothing left your wallet. From now on, the first trade of
          every block can only reach {lambda}% of what you hold.
          {s.agentEnabled && !s.bound && isOwner
            ? ' Next: bind your World ID below so the manager can ask you for approvals.'
            : ''}
        </div>
      )}

      {/* Plain-language settings */}
      <section className="mt-10">
        <h2 className="text-lg font-medium">How this strategy trades</h2>
        <p className="mt-1 text-sm text-fg-3">
          {isOwner
            ? 'Four settings, stored on your ENS name and mirrored on-chain. The manager may move the first three inside your guardrails; only you can change the fee.'
            : "Four settings, stored on the owner's ENS name and mirrored on-chain."}
        </p>
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Setting
            big={`${lambda}%`}
            title="of your inventory is visible per block"
            body={`Arbitrage bots can only ever trade against ${lambda}% of your tokens in any block. The other ${100 - lambda}% is invisible to them until the next block.`}
          />
          <Setting
            big={`${s.records.N}×`}
            title="deeper prices for normal traders"
            body={`After the block's first trade, regular traders are quoted as if your pool were ${s.records.N} times larger, so they pay far less slippage.`}
          />
          <Setting
            big={`${delta}%`}
            title="band for the deep price"
            body={`The deep curve only serves trades that keep the price within ${delta}% of where the block's first trade left it. Anything bigger is quoted on the normal curve.`}
          />
          <Setting
            big={`${feeBps / 100}%`}
            title="fee on every trade"
            body={`Paid by the trader, kept in your inventory. It also backs the deep curve: the most that curve can improve a price, ${rebate / 100}% here, never exceeds the fee, so nobody can farm it.`}
          />
        </div>
        {!s.onchain && (
          <div className="mt-3 text-xs text-warn">
            This strategy has no on-chain parameters on the current contracts;
            the values above are its ENS records only.
          </div>
        )}
        {syncing && s.onchain && (
          <div className="mt-3 text-xs text-warn">
            The ENS records ({s.records.lambda / 100}% / {s.records.N}× /{' '}
            {s.records.delta / 100}%) and the on-chain values (
            {s.onchain.lambda / 100}% / {s.onchain.N}× / {s.onchain.delta / 100}
            %) differ. Trades use the on-chain values; an approved change is
            waiting for the owner&apos;s wallet.
          </div>
        )}
      </section>

      {/* Inventory this block */}
      <section className="mt-10">
        <Bezel>
          <div className="p-6 md:p-7">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-medium">Your inventory right now</h2>
              <span className="text-xs text-fg-3">
                {hasSplit
                  ? `last split at block ${s.block!.blockNumber}`
                  : 'no trades yet, first trade will do the split'}
              </span>
            </div>
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              <Inventory
                label="WETH"
                active={hasSplit ? w.a : w.t * (lambda / 100)}
                total={w.t}
                digits={4}
              />
              <Inventory
                label="USDC"
                active={hasSplit ? u.a : u.t * (lambda / 100)}
                total={u.t}
                digits={2}
              />
            </div>
            <p className="mt-5 text-sm text-fg-3">
              Bright is tradeable this block. Dim stays put. Both halves are in
              your wallet the whole time; Aqua only pulls when a trade actually
              fills.
            </p>
          </div>
        </Bezel>
      </section>

      {/* Market: candles with fills, execution preview, impact by size */}
      <section className="mt-10">
        <h2 className="text-lg font-medium">Market</h2>
        <p className="mt-1 text-sm text-fg-3">
          The price the strategy is trading around, every fill against it, and
          {isOwner
            ? ' what a trader would receive right now. Owner wallets can preview execution here but cannot fill their own liquidity.'
            : ' what a fill would get right now.'}
        </p>
        <div className="mt-5 grid gap-4 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
          <Bezel small>
            <div className="min-w-0 overflow-hidden p-5">
              <CandleChart fills={s.fills} weth={WETH} />
            </div>
          </Bezel>
          <Bezel small>
            <TradePanel
              strategy={s.strategy}
              totals={{ weth: w.t, usdc: u.t }}
              feeBps={feeBps}
              onFilled={refresh}
              mode={isOwner ? 'preview' : 'trade'}
            />
          </Bezel>
        </div>
        <Bezel small className="mt-4">
          <div className="p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-sm font-medium">
                Price impact by size, this block
              </div>
              <span className="text-xs text-fg-3">
                from live reserves, fee excluded
              </span>
            </div>
            <div className="mt-4">
              <ImpactCurve
                totalIn={w.t}
                totalOut={u.t}
                lambda={lambda / 100}
                N={s.onchain?.N ?? s.records.N}
                deltaBps={s.onchain?.delta ?? s.records.delta}
              />
            </div>
          </div>
        </Bezel>
      </section>

      {/* Manager */}
      <section className="mt-10">
        <h2 className="text-lg font-medium">Manager</h2>
        <p className="mt-1 max-w-[70ch] text-sm text-fg-3">
          {s.agentEnabled
            ? isOwner
              ? 'The manager watches volatility and adjusts how much of your inventory each block sees. Inside the guardrails below it acts on its own. Outside them it needs you: a fresh World ID sign-in, then your wallet.'
              : "The manager watches volatility and adjusts how much of the inventory each block sees. Inside the owner's guardrails it acts on its own. Outside them the owner has to sign in with World ID and apply with the wallet."
            : isOwner
              ? 'The manager is not enabled on this strategy. You change settings yourself.'
              : 'The manager is not enabled on this strategy.'}
        </p>

        {s.agentEnabled && (
          <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_1.3fr]">
            <Bezel small>
              <div className="relative h-full overflow-hidden rounded-[calc(1rem-0.25rem)] p-5 pb-10">
                <div
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-50 opacity-45"
                  aria-hidden="true"
                >
                  <DitherField />
                  <div className="absolute inset-0 bg-gradient-to-b from-panel via-panel/30 to-transparent" />
                </div>
                <div className="relative z-10 flex items-center gap-2 text-sm font-medium">
                  <Fingerprint size={16} className="text-accent" /> Your World
                  ID
                </div>
                {s.bound ? (
                  <p className="relative z-10 mt-2 text-sm text-fg-2">
                    Bound {ago(s.bound.boundAt, now)}. Every approval asks you
                    to sign in again, fresh.
                  </p>
                ) : isOwner ? (
                  <>
                    <p className="relative z-10 mt-2 text-sm text-fg-2">
                      Bind once so the manager knows who is allowed to approve.
                    </p>
                    <div className="relative z-10 mt-4">
                      <BindButton owner={s.strategy.owner} />
                    </div>
                  </>
                ) : (
                  <p className="relative z-10 mt-2 text-sm text-fg-3">
                    The owner has not bound a World ID yet.
                  </p>
                )}
                {mgr && (
                  <p className="relative z-10 mt-5 border-t border-white/[0.07] pt-4 text-xs leading-relaxed text-fg-2">
                    Autopilot: the manager checks the market every{' '}
                    {mgr.tickMinutes} min
                    {mgr.nextTick && now !== null
                      ? `, next in ${Math.max(0, Math.round((mgr.nextTick - now) / 60000))} min`
                      : ''}
                    . It acts when the suggested visibility moves by{' '}
                    {mgr.minMoveBps / 100} points or more: on its own inside the
                    guardrails, otherwise it asks you.
                  </p>
                )}
              </div>
            </Bezel>
            <Bezel small>
              <div className="flex h-full flex-col p-5">
                <div className="text-sm font-medium">Ask for a suggestion</div>
                <p className="mt-1 text-xs text-fg-3">
                  {mgr?.sigma
                    ? `ETH has moved about ${Math.round(mgr.sigma * 100)}% a year lately (hourly, last two weeks${mgr.ethPrice ? `, $${Math.round(mgr.ethPrice)}` : ''}). The frontier says ${mgr.lambdaStar !== null ? `${(mgr.lambdaStar ?? 0) / 100}%` : '…'} visibility for that. Slide to ask "what if".`
                    : 'Tell the manager how volatile the market feels. It reads the frontier and proposes a new visibility level.'}
                </p>

                <dl className="mt-5 grid grid-cols-2 border-y border-white/[0.07]">
                  <div className="py-3 pr-4">
                    <dt className="text-[11px] text-fg-3">
                      Measured volatility
                    </dt>
                    <dd className="num mt-0.5 text-lg font-medium text-fg">
                      {mgr?.sigma ? `${Math.round(mgr.sigma * 100)}%` : '—'}
                    </dd>
                  </div>
                  <div className="border-l border-white/[0.07] py-3 pl-4">
                    <dt className="text-[11px] text-fg-3">
                      Frontier visibility
                    </dt>
                    <dd className="num mt-0.5 text-lg font-medium text-accent">
                      {mgr?.lambdaStar !== null && mgr?.lambdaStar !== undefined
                        ? `${mgr.lambdaStar / 100}%`
                        : '—'}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5">
                  <div className="flex items-baseline justify-between gap-4">
                    <label
                      htmlFor="volatility-scenario"
                      className="text-xs font-medium text-fg-2"
                    >
                      What-if volatility
                    </label>
                    <span className="whitespace-nowrap text-xs text-fg-3">
                      <span className="num text-sm text-fg">
                        {Math.round(sigma * 100)}%
                      </span>{' '}
                      · {volatilityLabel}
                    </span>
                  </div>
                  <input
                    id="volatility-scenario"
                    type="range"
                    min={0.2}
                    max={1.2}
                    step={0.05}
                    value={sigma}
                    onChange={(e) => setSigma(Number(e.target.value))}
                    className={`volatility-slider mt-2 w-full ${isHot ? 'volatility-slider-hot' : ''}`}
                    style={
                      {
                        '--volatility-progress': `${volatilityProgress}%`,
                        '--volatility-heat': volatilityHeat,
                      } as React.CSSProperties
                    }
                  />
                  <div className="mt-1 flex justify-between text-[10px] text-fg-3">
                    <span>Calm</span>
                    <span
                      className={`inline-flex origin-right items-center gap-1 transition-colors ${isHot ? 'volatility-wild-hot text-[#ff8a5c]' : ''}`}
                    >
                      {isHot && (
                        <Fire
                          size={14}
                          weight="fill"
                          className="volatility-flame"
                        />
                      )}
                      Wild
                    </span>
                  </div>
                </div>

                <button
                  onClick={propose}
                  disabled={busy || !!pending}
                  className="pill pill-primary pill-sm mt-5 self-start disabled:opacity-40"
                >
                  <span>
                    {busy
                      ? 'Thinking…'
                      : pending
                        ? 'Suggestion waiting'
                        : 'Get a suggestion'}
                  </span>
                  <span className="ico">
                    <ArrowUpRight size={13} />
                  </span>
                </button>
                {proposeErr && (
                  <p className="mt-2 text-xs text-bad">{proposeErr}</p>
                )}
              </div>
            </Bezel>
          </div>
        )}

        {s.agentEnabled && s.bounds && (
          <Guardrails
            b={s.bounds}
            orderHash={s.strategy.orderHash}
            isOwner={isOwner}
          />
        )}

        {/* Suggestions */}
        {s.proposals.length > 0 && (
          <div className="mt-6">
            <div className="mb-3 flex items-baseline justify-between">
              <h3 className="text-sm font-medium">Suggestions</h3>
              <span className="text-xs text-fg-3">
                {s.proposals.length} so far, newest first
              </span>
            </div>
            <div className="max-h-[26rem] space-y-3 overflow-y-auto pr-1 [scrollbar-width:thin]">
              {s.proposals.map((p) => (
                <ProposalCard
                  key={p.id}
                  p={p}
                  now={now}
                  mgr={mgr}
                  isOwner={isOwner}
                  orderHash={s.strategy.orderHash}
                />
              ))}
            </div>
          </div>
        )}
        <AnimatePresence>
          {focus && (
            <motion.div
              className="fixed inset-0 z-40 flex items-end justify-center bg-bg/80 p-4 backdrop-blur-md sm:items-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setFocusId(null)}
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="The manager's suggestion"
                className="w-full max-w-xl"
                initial={{ opacity: 0, transform: 'translateY(16px)' }}
                animate={{ opacity: 1, transform: 'translateY(0px)' }}
                exit={{ opacity: 0, transform: 'translateY(16px)' }}
                transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-sm text-fg-2">
                    {focus.status === 'pending'
                      ? 'The manager suggests'
                      : 'The manager suggested'}
                  </span>
                  <button
                    onClick={() => setFocusId(null)}
                    aria-label="Close"
                    className="rounded-full p-1.5 text-fg-3 hover:bg-white/5 hover:text-fg"
                  >
                    <X size={16} />
                  </button>
                </div>
                <ProposalCard
                  p={focus}
                  now={now}
                  mgr={mgr}
                  isOwner={isOwner}
                  orderHash={s.strategy.orderHash}
                />
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Activity */}
      <section className="mt-10">
        <h2 className="text-lg font-medium">Trades</h2>
        <p className="mt-1 text-sm text-fg-3">
          Every fill against your inventory, newest first.
        </p>
        <div className="mt-5">
          {fills.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-white/10 p-6 text-sm text-fg-3">
              No trades yet. When a resolver fills against this strategy it
              shows up here.
            </div>
          ) : (
            <Bezel small>
              <ul className="divide-y divide-white/[0.06]">
                {fills.slice(0, 10).map((f) => {
                  const inW = f.tokenIn.toLowerCase() === WETH;
                  const a = inW
                    ? `${fmt(num(f.amountIn, 18), 4)} WETH`
                    : `${fmt(num(f.amountIn, 6))} USDC`;
                  const b = inW
                    ? `${fmt(num(f.amountOut, 6))} USDC`
                    : `${fmt(num(f.amountOut, 18), 4)} WETH`;
                  return (
                    <li
                      key={`${f.tx}-${f.logIndex}`}
                      className="flex flex-col items-start justify-between gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:gap-4"
                    >
                      <span>
                        A trader sold <span className="num">{a}</span> and
                        received <span className="num">{b}</span>{' '}
                        {isOwner ? 'from you' : 'from the strategy'}
                      </span>
                      <a
                        className="num shrink-0 text-xs text-accent"
                        href={tx(f.tx)}
                      >
                        block {f.block} ↗
                      </a>
                    </li>
                  );
                })}
              </ul>
            </Bezel>
          )}
        </div>
      </section>

      {/* Advanced */}
      <section className="mt-12">
        <button
          onClick={() => setAdvanced(!advanced)}
          className="flex items-center gap-2 text-sm text-fg-3 hover:text-fg"
        >
          <CaretDown
            size={14}
            className={`transition-transform ${advanced ? 'rotate-180' : ''}`}
          />{' '}
          Technical details
        </button>
        {advanced && (
          <div className="mt-5 grid gap-4 md:grid-cols-2">
            <Bezel small>
              <div className="num space-y-2 p-5 text-xs text-fg-2">
                <Row k="ENS name" v={s.records.name} />
                <Row k="Owner" v={s.strategy.owner} />
                <Row k="Resolver" v={s.strategy.resolver} />
                <Row k="Strategy hash" v={s.records.strategyHash} />
                <Row k="Manager" v={s.agent} />
                <Row k="Router" v={s.deployment.tideRouter} />
                <Row k="Aqua" v={s.deployment.aqua} />
                <Row
                  k="Records (lambda / N / delta, bps)"
                  v={`${s.records.lambda} / ${s.records.N} / ${s.records.delta}`}
                />
                <Row
                  k="On-chain TideParams"
                  v={
                    s.onchain
                      ? `${s.onchain.lambda} / ${s.onchain.N} / ${s.onchain.delta}`
                      : '–'
                  }
                />
              </div>
            </Bezel>
            <Bezel small>
              <div className="p-5">
                <div className="mb-2 text-xs text-fg-3">
                  Activeness frontier the manager reads
                </div>
                <FrontierChart sigma={sigma} />
              </div>
            </Bezel>
            <Bezel small className="md:col-span-2">
              <ul className="num max-h-64 space-y-1 overflow-auto p-5 text-xs">
                {s.log.map((l, i) => (
                  <li
                    key={i}
                    className={
                      l.level === 'warn'
                        ? 'text-warn'
                        : l.level === 'error'
                          ? 'text-bad'
                          : 'text-fg-2'
                    }
                  >
                    <span className="text-fg-3">
                      {new Date(l.at).toLocaleTimeString()}
                    </span>{' '}
                    {l.msg}
                  </li>
                ))}
              </ul>
            </Bezel>
          </div>
        )}
      </section>
    </>
  );
}

function ProposalCard({
  p,
  now,
  mgr,
  isOwner,
  orderHash,
}: {
  p: Snapshot['proposals'][number];
  now: number | null;
  mgr: Mgr | null;
  isOwner: boolean;
  orderHash: string;
}) {
    const dir =
      p.to.lambda < p.from.lambda
        ? 'show less'
        : p.to.lambda > p.from.lambda
          ? 'show more'
          : 'keep';
    return (
      <Bezel small>
        <div className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <span className="font-medium">
                {dir === 'keep'
                  ? 'Keep visibility at'
                  : `${dir[0].toUpperCase()}${dir.slice(1)} of your inventory:`}
              </span>{' '}
              <span className="num">
                {p.from.lambda / 100}% → {p.to.lambda / 100}%
              </span>
              {(p.to.N !== p.from.N ||
                p.to.delta !== p.from.delta) && (
                <span className="num text-fg-3">
                  {' '}
                  · deep curve {p.from.N}× within {p.from.delta / 100}
                  % → {p.to.N}× within {p.to.delta / 100}%
                </span>
              )}
            </div>
            <Status s={p.status} />
          </div>
          <p className="mt-2 text-sm text-fg-2">
            {humanReason(p.sigma, p.to.lambda, p.from.lambda)}
            {p.to.delta !== p.from.delta &&
              ` The deep-curve band moves to ${p.to.delta / 100}%: about three one-block price moves at this volatility, so a stale first trade gives nobody an edge, and no more than the fee can back.`}
          </p>
          <div className="mt-2 text-xs text-fg-3">
            {p.auto && p.status === 'applied'
              ? 'Applied by the manager, inside your guardrails'
              : (STATUS_TEXT[p.status] ?? p.status)}
            {p.outside && p.status !== 'applied'
              ? ` (${p.outside})`
              : ''}{' '}
            · {ago(p.createdAt, now)}
          </div>
          {p.status === 'approved' && !p.txs?.params && isOwner && (
            <ApplyButton p={p} orderHash={orderHash} />
          )}
          {p.status === 'pending' && p.needsApproval && isOwner && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <ApproveButton id={p.id} />
              <span className="text-xs text-fg-3">
                or ignore it: it expires{' '}
                {now === null
                  ? 'shortly'
                  : `${Math.max(0, Math.ceil((p.createdAt + (mgr?.approvalSeconds ?? 180) * 1000 - now) / 60000))} min from now`}{' '}
                and nothing changes.
              </span>
            </div>
          )}
          {p.blockedReason && (
            <div className="mt-2 text-xs text-bad">
              {p.blockedReason.replace(/^[a-z_]+: /, '')}
            </div>
          )}
          {p.txs && (
            <div className="mt-2 flex gap-4 text-xs">
              {p.txs.ens && (
                <a className="text-accent" href={tx(p.txs.ens)}>
                  ENS record ↗
                </a>
              )}
              {p.txs.params && (
                <a className="text-accent" href={tx(p.txs.params)}>
                  on-chain setting ↗
                </a>
              )}
            </div>
          )}
        </div>
      </Bezel>
    );
}

function humanReason(sigma: number, to: number, from: number) {
  const v = Math.round(sigma * 100);
  if (to < from)
    return `Markets look volatile (about ${v}% a year). Showing less inventory per block cuts what bots can take from you, at the cost of your token mix drifting a bit more.`;
  if (to > from)
    return `Markets look calm (about ${v}% a year). Bots take little at this volatility, so showing more inventory earns more fees than it loses.`;
  return `At about ${v}% volatility the current setting is already the best trade-off.`;
}

type GuardrailDraft = {
  lambdaMin: number;
  lambdaMax: number;
  nMax: number;
  maxStepBps: number;
  cooldown: number;
};

function GuardrailNumberInput({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-xs text-fg-3">
      {label}
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="num mt-1 w-full rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-fg outline-none focus:border-accent"
      />
    </label>
  );
}
/** The owner's guardrails for the manager: what it may change on its own. Edited in percent and minutes, stored in bps and seconds. */
function Guardrails({
  b,
  orderHash,
  isOwner,
}: {
  b: NonNullable<Snapshot['bounds']>;
  orderHash: string;
  isOwner: boolean;
}) {
  const { writeContractAsync } = useWriteContract();
  const pc = usePublicClient();
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState<GuardrailDraft>({
    lambdaMin: b.lambdaMin,
    lambdaMax: b.lambdaMax,
    nMax: b.nMax,
    maxStepBps: b.maxStepBps,
    cooldown: b.cooldown,
  });
  const [busy, setBusy] = useState<'wallet' | 'mining' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const problem = !(
    v.lambdaMin > 0 &&
    v.lambdaMin <= v.lambdaMax &&
    v.lambdaMax <= 10_000
  )
    ? 'visibility range must sit between 0 and 100 %, low before high'
    : !(v.maxStepBps > 0 && v.maxStepBps <= 10_000)
      ? 'the largest move must be between 0 and 100 points'
      : !(Number.isInteger(v.nMax) && v.nMax >= 1 && v.nMax <= 64)
        ? 'deepest curve must be a whole number from 1 to 64'
        : !(v.cooldown >= 60)
          ? 'at least one minute between changes'
          : null;
  const save = async () => {
    if (problem || !pc) return;
    setErr(null);
    try {
      setBusy('wallet');
      const h = await writeContractAsync({
        address: ADDR.tideParams,
        abi: tideParamsAbi,
        functionName: 'setBounds',
        args: [
          orderHash as Hex,
          {
            lambdaMin: v.lambdaMin,
            lambdaMax: v.lambdaMax,
            nMax: v.nMax,
            maxStepBps: v.maxStepBps,
            cooldown: v.cooldown,
          },
        ],
      });
      setBusy('mining');
      const rc = await pc.waitForTransactionReceipt({ hash: h });
      if (rc.status !== 'success') throw new Error('the transaction reverted');
      setTx(h);
      setEdit(false);
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message.split('\n')[0]);
    } finally {
      setBusy(null);
    }
  };
  const update = (key: keyof GuardrailDraft) => (value: number) =>
    setV((current) => ({ ...current, [key]: value }));
  return (
    <Bezel small className="mt-4">
      <div className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">
              Guardrails for the manager
            </div>
            <p className="mt-1 text-xs text-fg-3">
              {isOwner
                ? 'What it may change on its own. Anything beyond this needs your fresh World ID sign-in and your wallet. Stored on-chain; the contract refuses the manager outside them.'
                : 'What the manager may change on its own. Anything beyond this needs the owner. Stored on-chain.'}
            </p>
          </div>
          {isOwner && !edit && (
            <button
              onClick={() => setEdit(true)}
              className="pill pill-ghost pill-sm"
            >
              <span>Edit</span>
              <span className="ico">
                <ArrowRight size={13} />
              </span>
            </button>
          )}
        </div>
        {!edit ? (
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <div>
              <dt className="text-[11px] text-fg-3">Visibility range</dt>
              <dd className="num mt-0.5 text-lg font-medium">
                {b.lambdaMin / 100}% to {b.lambdaMax / 100}%
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-fg-3">Largest move per change</dt>
              <dd className="num mt-0.5 text-lg font-medium">
                {b.maxStepBps / 100} points
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-fg-3">Deepest curve</dt>
              <dd className="num mt-0.5 text-lg font-medium">{b.nMax}×</dd>
            </div>
            <div>
              <dt className="text-[11px] text-fg-3">Between changes</dt>
              <dd className="num mt-0.5 text-lg font-medium">
                {Math.round(b.cooldown / 60)} min
              </dd>
            </div>
          </dl>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-5">
            <GuardrailNumberInput
              value={v.lambdaMin}
              onChange={update('lambdaMin')}
              label="min visibility, bps"
            />
            <GuardrailNumberInput
              value={v.lambdaMax}
              onChange={update('lambdaMax')}
              label="max visibility, bps"
            />
            <GuardrailNumberInput
              value={v.maxStepBps}
              onChange={update('maxStepBps')}
              label="max move, bps"
            />
            <GuardrailNumberInput
              value={v.nMax}
              onChange={update('nMax')}
              label="deepest curve, N"
            />
            <GuardrailNumberInput
              value={v.cooldown}
              onChange={update('cooldown')}
              label="between changes, s"
            />
            <div className="flex items-end gap-2 sm:col-span-5">
              <button
                onClick={save}
                disabled={busy !== null}
                className="pill pill-primary pill-sm disabled:opacity-40"
              >
                <span>
                  {busy === 'wallet'
                    ? 'Confirm in your wallet…'
                    : busy === 'mining'
                      ? 'Waiting for the block…'
                      : 'Save guardrails'}
                </span>
                <span className="ico">
                  {busy ? (
                    <CircleNotch size={13} className="animate-spin" />
                  ) : (
                    <ArrowRight size={13} />
                  )}
                </span>
              </button>
              <button
                onClick={() => setEdit(false)}
                className="text-xs text-fg-3"
              >
                Cancel
              </button>
              {problem && <span className="text-xs text-warn">{problem}</span>}
            </div>
          </div>
        )}
        {tx && (
          <p className="mt-3 text-xs text-fg-3">
            Saved:{' '}
            <a
              className="text-accent"
              href={`https://sepolia.etherscan.io/tx/${tx}`}
            >
              {tx.slice(0, 18)}…
            </a>
          </p>
        )}
        {err && <p className="mt-2 text-xs text-bad">{err}</p>}
      </div>
    </Bezel>
  );
}

/** Owner fetches the World approval link for a pending proposal with a wallet signature, then goes there. */
function ApproveButton({ id }: { id: string }) {
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const ts = Date.now();
      const sig = await signMessageAsync({
        message: ownerMessage(`approve proposal ${id}`, ts),
      });
      const r = await fetch(`/api/agent/approval?id=${id}&ts=${ts}&sig=${sig}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      window.location.href = j.url;
    } catch (e) {
      setErr((e as Error).message.split('\n')[0]);
      setBusy(false);
    }
  };
  return (
    <div>
      <button
        onClick={go}
        disabled={busy}
        className="pill pill-primary pill-sm disabled:opacity-40"
      >
        <span>{busy ? 'Sign in your wallet…' : 'Approve with World ID'}</span>
        <span className="ico">
          {busy ? (
            <CircleNotch size={13} className="animate-spin" />
          ) : (
            <ArrowRight size={13} />
          )}
        </span>
      </button>
      {err && <p className="mt-1 text-xs text-bad">{err}</p>}
    </div>
  );
}

/** Owner applies an approved, out-of-guardrails change with their own wallet. Verified on-chain before it is marked. */
function ApplyButton({
  p,
  orderHash,
}: {
  p: Snapshot['proposals'][number];
  orderHash: string;
}) {
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<'wallet' | 'mining'>('wallet');
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const h = await writeContractAsync({
        address: ADDR.tideParams,
        abi: tideParamsAbi,
        functionName: 'set',
        args: [orderHash as Hex, p.to.lambda, p.to.N, p.to.delta],
      });
      setPhase('mining');
      const r = await fetch('/api/agent/applied', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: p.id, tx: h }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      window.location.reload();
    } catch (e) {
      setErr((e as Error).message.split('\n')[0]);
      setBusy(false);
    }
  };
  return (
    <div className="mt-3">
      <button
        onClick={go}
        disabled={busy}
        className="pill pill-primary pill-sm disabled:opacity-40"
      >
        <span>
          {busy
            ? phase === 'wallet'
              ? 'Confirm in your wallet…'
              : 'Waiting for the block…'
            : 'Apply on-chain'}
        </span>
        <span className="ico">
          {busy ? (
            <CircleNotch size={13} className="animate-spin" />
          ) : (
            <ArrowRight size={13} />
          )}
        </span>
      </button>
      {err && <p className="mt-1 text-xs text-bad">{err}</p>}
    </div>
  );
}

/** Sign a short message with the connected wallet, then start the World ID bind with that proof. */
function BindButton({ owner }: { owner: string }) {
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    setErr(null);
    try {
      const ts = Date.now();
      const sig = await signMessageAsync({
        message: ownerMessage(`bind World ID to ${owner.toLowerCase()}`, ts),
      });
      const url = new URL('/api/world/bind', window.location.origin);
      url.search = new URLSearchParams({
        owner,
        ts: String(ts),
        sig,
      }).toString();
      const r = await fetch(url.toString());
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      window.location.assign(j.url);
    } catch (e) {
      setErr((e as Error).message.split('\n')[0]);
      setBusy(false);
    }
  };
  return (
    <div>
      <button
        onClick={go}
        disabled={busy}
        className="pill pill-primary pill-sm disabled:opacity-40"
      >
        <span>{busy ? 'Sign in your wallet…' : 'Bind World ID'}</span>
        <span className="ico">
          {busy ? (
            <CircleNotch size={13} className="animate-spin" />
          ) : (
            <ArrowRight size={13} />
          )}
        </span>
      </button>
      <p className="mt-2 text-xs text-fg-3">
        Your wallet signs one message first, so only you can bind a World ID to
        this strategy.
      </p>
      {err && <p className="mt-1 text-xs text-bad">{err}</p>}
    </div>
  );
}

function Setting({
  big,
  title,
  body,
}: {
  big: string;
  title: string;
  body: string;
}) {
  return (
    <Bezel small>
      <div className="p-5">
        <div className="num text-4xl font-semibold tracking-tight text-accent">
          {big}
        </div>
        <div className="mt-1 text-sm font-medium">{title}</div>
        <p className="mt-2 text-xs leading-relaxed text-fg-3">{body}</p>
      </div>
    </Bezel>
  );
}

function Inventory({
  label,
  active,
  total,
  digits,
}: {
  label: string;
  active: number;
  total: number;
  digits: number;
}) {
  const pct = total > 0 ? Math.min(100, (active / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="num text-sm text-fg-2">
          {fmt(total, digits)} total
        </span>
      </div>
      <div className="relative mt-3 h-3 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{
            width: `${pct}%`,
            transition: 'width 900ms var(--ease-out)',
          }}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs text-fg-3">
        <span className="num text-accent">
          {fmt(active, digits)} tradeable now
        </span>
        <span className="num">{fmt(total - active, digits)} held back</span>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="shrink-0 text-fg-3">{k}</span>
      <span className="truncate">{v}</span>
    </div>
  );
}

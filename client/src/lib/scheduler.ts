/**
 * The manager's clock. Every AGENT_TICK_MINUTES (default 15) it measures realised volatility, reads the
 * frontier, and for each strategy where it is delegated, the owner is bound, and nothing is pending, it
 * proposes a change when lambda* differs from the current lambda by at least AGENT_MIN_MOVE_BPS (default
 * 500). Inside the owner's guardrails the change is applied at once; outside them a proposal waits for
 * the owner's fresh World ID approval and wallet.
 */
import { listStrategies } from "./registry";
import { getBound, hasPending, appendLog, lastCheckAt } from "./store";
import { agentEnabled, currentRecords, deltaStar, lambdaStar, propose, strategyFee } from "./agent";
import { realisedVolatility } from "./volatility";
import { withinBounds } from "./tide";
import { publicClient } from "./ens/client";
import { safeError } from "./auth";

type TickInfo = { lastTick?: number; nextTick?: number; sigma?: number; measuredAt?: number; lastResult?: string; running: boolean };
const g = globalThis as unknown as { __tideTick?: TickInfo; __tideTimer?: NodeJS.Timeout };
g.__tideTick ??= { running: false };

export const tickMinutes = () => Number(process.env.AGENT_TICK_MINUTES ?? "15");
export const minMoveBps = () => Number(process.env.AGENT_MIN_MOVE_BPS ?? "500");

export function tickInfo(): TickInfo {
  return g.__tideTick!;
}

/** tickInfo with lastTick/nextTick filled from the log when this process has not ticked yet. */
export async function tickStatus(): Promise<TickInfo> {
  const info = g.__tideTick!;
  if (info.lastTick === undefined) {
    const at = await lastCheckAt().catch(() => null);
    if (at) {
      info.lastTick = at;
      info.nextTick = at + tickMinutes() * 60_000;
    }
  }
  return info;
}

/**
 * Run a check if the last one is older than the tick interval. Serverless hosts have no long-lived process,
 * so routes that traffic hits anyway (dashboard status, market list) call this in the background and the
 * manager keeps its schedule as long as anyone is looking. Idempotent: the check itself skips strategies with
 * a pending proposal, respects the on-chain cooldown and the minimum move.
 */
export async function tickIfStale(): Promise<string | null> {
  const info = await tickStatus();
  if (info.running) return null;
  if (info.lastTick && Date.now() - info.lastTick < tickMinutes() * 60_000) return null;
  return tick("on demand");
}

export async function tick(reason = "schedule"): Promise<string> {
  const info = g.__tideTick!;
  if (info.running) return "already running";
  info.running = true;
  const out: string[] = [];
  try {
    const vol = await realisedVolatility();
    info.sigma = vol.sigma;
    info.measuredAt = vol.measuredAt;
    const target = lambdaStar(vol.sigma);
    for (const s of await listStrategies()) {
      try {
      if (!(await agentEnabled(s).catch(() => false))) continue;
      if (await hasPending(s.name)) {
        out.push(`${s.label}: proposal pending`);
        continue;
      }
      const rec = await currentRecords(s);
      const ds = deltaStar(vol.sigma, await strategyFee(s, rec), rec.N);
      const lambdaOff = Math.abs(target - rec.lambda) >= minMoveBps();
      // delta only moves when it leaves a wide band around delta*, so a noisy sigma does not spam proposals
      const deltaOff = ds.N !== rec.N || rec.delta < 0.75 * ds.delta || rec.delta > 1.5 * ds.delta;
      if (!lambdaOff && !deltaOff) {
        out.push(`${s.label}: lambda ${rec.lambda} within ${minMoveBps()} bps of lambda* ${target}, delta ${rec.delta} near delta* ${ds.delta}`);
        continue;
      }
      if (!(await getBound(s.owner)) && !(await withinBounds(publicClient(), s.orderHash, target, ds.N, ds.delta)).ok) {
        out.push(`${s.label}: change is outside the guardrails and the owner has not bound a World ID, nothing to do`);
        continue;
      }
      const p = await propose(s.name, vol.sigma);
      out.push(`${s.label}: ${p.auto ? "applied" : "proposed, needs the owner"} lambda ${p.from.lambda} -> ${p.to.lambda}, delta ${p.from.delta} -> ${p.to.delta}`);
      } catch (e) {
        out.push(`${s.label}: ${safeError(e)}`); // one strategy's failure must not stop the others
      }
    }
    const summary = `σ ${(vol.sigma * 100).toFixed(0)}%, λ* ${target}: ${out.join("; ") || "no strategies"}`;
    await appendLog("info", `manager check (${reason}): ${summary}`);
    info.lastResult = summary;
    return summary;
  } catch (e) {
    const msg = `manager check failed: ${safeError(e)}`;
    await appendLog("warn", msg);
    info.lastResult = msg;
    return msg;
  } finally {
    info.running = false;
    info.lastTick = Date.now();
    info.nextTick = Date.now() + tickMinutes() * 60_000;
  }
}

/** Start the interval once per process. */
export function startScheduler() {
  if (g.__tideTimer) return;
  const ms = tickMinutes() * 60_000;
  g.__tideTick!.nextTick = Date.now() + 30_000;
  g.__tideTimer = setInterval(() => void tick(), ms);
  setTimeout(() => void tick("startup"), 30_000);
}

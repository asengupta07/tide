/**
 * The manager's clock. Every AGENT_TICK_MINUTES (default 15) it measures realised volatility, reads the
 * frontier, and for each strategy where it is delegated, the owner is bound, and nothing is pending, it
 * proposes a change when lambda* differs from the current lambda by at least AGENT_MIN_MOVE_BPS (default
 * 500). Proposals still go through the owner's fresh World ID approval; the clock never writes.
 */
import { listStrategies } from "./registry";
import { load, update, log } from "./store";
import { agentEnabled, currentRecords, deltaStar, lambdaStar, propose, strategyFee } from "./agent";
import { realisedVolatility } from "./volatility";

type TickInfo = { lastTick?: number; nextTick?: number; sigma?: number; measuredAt?: number; lastResult?: string; running: boolean };
const g = globalThis as unknown as { __tideTick?: TickInfo; __tideTimer?: NodeJS.Timeout };
g.__tideTick ??= { running: false };

export const tickMinutes = () => Number(process.env.AGENT_TICK_MINUTES ?? "15");
export const minMoveBps = () => Number(process.env.AGENT_MIN_MOVE_BPS ?? "500");

export function tickInfo(): TickInfo {
  return g.__tideTick!;
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
    const state = load();
    for (const s of listStrategies()) {
      if (!(await agentEnabled(s).catch(() => false))) continue;
      if (!state.bound[s.owner.toLowerCase()]) {
        out.push(`${s.label}: owner not bound`);
        continue;
      }
      if (state.proposals.some((p) => p.strategy === s.name && p.status === "pending")) {
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
      const p = await propose(s.name, vol.sigma);
      out.push(`${s.label}: proposed lambda ${p.from.lambda} -> ${p.to.lambda}, delta ${p.from.delta} -> ${p.to.delta}`);
    }
    const summary = `σ ${(vol.sigma * 100).toFixed(0)}%, λ* ${target}: ${out.join("; ") || "no strategies"}`;
    update((st) => log(st, "info", `manager check (${reason}): ${summary}`));
    info.lastResult = summary;
    return summary;
  } catch (e) {
    const msg = `manager check failed: ${(e as Error).message}`;
    update((st) => log(st, "warn", msg));
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

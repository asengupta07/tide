export async function register() {
  // The in-process scheduler needs a long-lived Node process. On Vercel the functions are short-lived, so the
  // cron in vercel.json calls /api/agent/tick instead.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.AGENT_AUTOPILOT !== "off" && !process.env.VERCEL) {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}

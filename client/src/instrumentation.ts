export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.AGENT_AUTOPILOT !== "off") {
    const { startScheduler } = await import("./lib/scheduler");
    startScheduler();
  }
}

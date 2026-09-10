import type { Client } from "discord.js";
import { runDailySweepForGuild } from "./dailyService.js";
import { logger } from "./loggingService.js";

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Every 15 min: post due solutions first, then today's problem. Catches up after downtime. */
export function startDailyScheduler(client: Client, intervalMs = 15 * 60 * 1000): void {
  if (timer) return;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      for (const [, guild] of client.guilds.cache) {
        try {
          const res = await runDailySweepForGuild(guild);
          if (res.problem === "posted" || res.solutions > 0) {
            logger.info("DAILY", `Sweep guild ${guild.id}: problem=${res.problem} solutions=${res.solutions}`);
          }
        } catch (err) {
          logger.warn("DAILY", `Sweep failed for guild ${guild.id}: ${String(err)}`);
        }
      }
    } finally {
      running = false;
    }
  };
  // Run once shortly after startup (catch-up), then on interval.
  setTimeout(() => void sweep(), 30 * 1000);
  timer = setInterval(() => void sweep(), intervalMs);
  timer.unref?.();
  logger.info("DAILY", "Daily scheduler started (15 min interval).");
}

export function stopDailyScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

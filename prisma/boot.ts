import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

/**
 * Boot guard, run before the bot starts (`npm run prestart`).
 * Idempotent: applies pending migrations, then seeds the problem pool
 * ONLY when the DailyProblem table is empty (never wipes existing data).
 */
function sh(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) throw new Error(`boot step failed: ${cmd} ${args.join(" ")}`);
}

async function main(): Promise<void> {
  console.log("[BOOT] prisma migrate deploy...");
  sh("npx", ["prisma", "migrate", "deploy"]);

  const prisma = new PrismaClient();
  try {
    const count = await prisma.dailyProblem.count();
    console.log(`[BOOT] DailyProblem rows: ${count}`);
    if (count === 0) {
      const here = dirname(fileURLToPath(import.meta.url));
      if (existsSync(join(here, "data", "mathnet-curated.jsonl"))) {
        console.log("[BOOT] empty pool, seeding curated problems...");
        sh("npx", ["tsx", "prisma/seed-daily.ts"]);
      } else {
        console.log("[BOOT] no curated file found, skipping seed.");
      }
    }
  } finally {
    await prisma.$disconnect();
  }
  console.log("[BOOT] done.");
}

main().catch((err) => {
  console.error("[BOOT] failed:", err);
  process.exit(1);
});

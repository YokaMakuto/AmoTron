import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const here = dirname(fileURLToPath(import.meta.url));
const jsonlPath = join(here, "data", "mathnet-curated.jsonl");

async function main(): Promise<void> {
  if (!existsSync(jsonlPath)) {
    console.log("[SEED-DAILY] No curated file found, skipping.");
    return;
  }
  const lines = readFileSync(jsonlPath, "utf-8").split("\n").filter(Boolean);
  let upserted = 0;
  for (const line of lines) {
    const r = JSON.parse(line) as {
      id: string;
      problemMarkdown: string;
      solutionMarkdown: string;
      topics: string[];
      competition: string;
      country: string;
      hardness: string;
      hardnessReason?: string;
      problemType?: string;
      finalAnswer?: string | null;
      imageCount?: number;
    };
    await prisma.dailyProblem.upsert({
      where: { id: r.id },
      update: {
        problemMarkdown: r.problemMarkdown,
        solutionMarkdown: r.solutionMarkdown,
        topics: JSON.stringify(r.topics ?? []),
        competition: r.competition,
        country: r.country,
        hardness: r.hardness,
        hardnessReason: r.hardnessReason,
        problemType: r.problemType,
        finalAnswer: r.finalAnswer,
        imageCount: r.imageCount ?? 0,
      },
      create: {
        id: r.id,
        problemMarkdown: r.problemMarkdown,
        solutionMarkdown: r.solutionMarkdown,
        topics: JSON.stringify(r.topics ?? []),
        competition: r.competition,
        country: r.country,
        hardness: r.hardness,
        hardnessReason: r.hardnessReason,
        problemType: r.problemType,
        finalAnswer: r.finalAnswer,
        imageCount: r.imageCount ?? 0,
      },
    });
    upserted += 1;
  }
  console.log(`[SEED-DAILY] Upserted ${upserted} daily problems.`);
}

main()
  .catch((err) => {
    console.error("[SEED-DAILY] Failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

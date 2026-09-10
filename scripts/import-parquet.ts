/**
 * Offline ETL (Node, no Python needed): ShadenA/MathNet parquet -> curated JSONL.
 *
 * Downloads per-competition parquet files straight from the HuggingFace CDN
 * (one fast request per file — no rate-limited row paging), parses them with
 * hyparquet, and appends NEW problem ids to prisma/data/mathnet-curated.jsonl
 * (dedupe by id, full reshuffle). Afterwards run: npm run seed:daily
 *
 * Usage:
 *   npx tsx scripts/import-parquet.ts --configs Asia_Pacific_Mathematics_Olympiad_APMO,IMO
 *   npx tsx scripts/import-parquet.ts --all            # full backfill (56 files)
 *   npx tsx scripts/import-parquet.ts --configs IMO --language English --seed 42
 *
 * Note: source figure bytes are skipped (the renderer draws its own card);
 * image refs become "[Figure N]" placeholders.
 */
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { parquetReadObjects } from "hyparquet";

const DATASET = "ShadenA/MathNet";
const HF_API = `https://huggingface.co/api/datasets/${DATASET}`;
const HF_RESOLVE = `https://huggingface.co/datasets/${DATASET}/resolve/main`;

const KEEP_COLUMNS = [
  "id",
  "problem_markdown",
  "solutions_markdown",
  "topics_flat",
  "language",
  "competition",
  "country",
  "problem_type",
  "final_answer",
];

const HARD_COMPETITIONS = ["imo", "shortlist", "apmo", "memo", "bmo", "egmo", "ibero"];
const EASY_COMPETITIONS = ["junior", "jbmo", "baltic", "nzmo", "round one", "concurso final"];

function args(): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const a = process.argv[i] ?? "";
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = process.argv[i + 1] && !process.argv[i + 1]!.startsWith("--") ? process.argv[i + 1]! : "true";
      out[key] = val;
      if (val !== "true") i += 1;
    }
  }
  return out;
}

function computeHardness(
  competition: string,
  problemType: string | null,
  solutionLen: number,
  topicCount: number,
): { hardness: string; reason: string } {
  const comp = competition.toLowerCase();
  let level: number;
  let reason: string;
  if (HARD_COMPETITIONS.some((k) => comp.includes(k))) {
    level = 2;
    reason = `${competition} is an international/regional olympiad`;
  } else if (EASY_COMPETITIONS.some((k) => comp.includes(k))) {
    level = 0;
    reason = `${competition} is a junior/entry round`;
  } else {
    level = 1;
    reason = `${competition || "Unknown competition"} treated as national level`;
  }
  const adj: string[] = [];
  if (solutionLen > 2000) {
    level += 1;
    adj.push("long proof");
  }
  if (topicCount >= 3) {
    level += 1;
    adj.push("multi-domain topics");
  }
  if (problemType === "answer only") {
    level -= 1;
    adj.push("answer-only format");
  }
  level = Math.max(0, Math.min(2, level));
  if (adj.length > 0) reason += ` (${adj.join(", ")})`;
  return { hardness: ["Easy", "Medium", "Hard"][level] as string, reason };
}

function cleanMarkdown(md: unknown, maxLen: number): string | null {
  if (typeof md !== "string" || !md.trim()) return null;
  const cleaned = md.trim().replace(/!\[.*?\]\(attached_image_(\d+)\.png\)/g, "[Figure $1]");
  return cleaned.length > maxLen ? null : cleaned;
}

function shuffle<T>(arr: T[], seed: number): T[] {
  let s = seed;
  const rnd = () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

async function listParquet(prefixes: string[]): Promise<string[]> {
  const res = await fetch(HF_API);
  if (!res.ok) throw new Error(`HF API ${res.status}`);
  const data = (await res.json()) as { siblings?: { rfilename: string }[] };
  const files = (data.siblings ?? []).map((s) => s.rfilename);
  return files.filter((f) => f.endsWith(".parquet") && prefixes.some((p) => f.startsWith(`data/${p}/`)));
}

async function download(url: string, dest: string): Promise<void> {
  const head = await fetch(url, { method: "HEAD" });
  const expected = Number(head.headers.get("content-length") ?? 0);
  if (existsSync(dest) && expected > 0 && statSync(dest).size === expected) {
    console.log(`[ETL] cached ${dest} (${(expected / 1048576).toFixed(1)} MB)`);
    return;
  }
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`download ${res.status} for ${url}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  let done = 0;
  const { Transform } = await import("node:stream");
  const progress = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      done += chunk.length;
      if (total > 0 && done % (4 * 1048576) < chunk.length) {
        console.log(`[ETL] ... ${(done / 1048576).toFixed(0)}/${(total / 1048576).toFixed(0)} MB`);
      }
      cb(null, chunk);
    },
  });
  await pipeline(res.body as unknown as NodeJS.ReadableStream, progress, createWriteStream(dest));
  console.log(`[ETL] downloaded ${dest} (${(done / 1048576).toFixed(1)} MB)`);
}

async function main(): Promise<void> {
  const a = args();
  const language = a["language"] ?? "English";
  const seed = Number(a["seed"] ?? 42);
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, "..", a["out"] ?? "prisma/data/mathnet-curated.jsonl");
  const parquetDir = resolve(here, "..", a["parquet-dir"] ?? "prisma/data/parquet");
  mkdirSync(parquetDir, { recursive: true });

  const prefixes = a["all"] === "true" ? ["all"] : (a["configs"] ?? "Asia_Pacific_Mathematics_Olympiad_APMO,IMO").split(",");
  const files = await listParquet(prefixes);
  if (files.length === 0) throw new Error(`no parquet files for prefixes: ${prefixes.join(", ")}`);
  console.log(`[ETL] ${files.length} parquet file(s): ${files.join(", ")}`);

  const seen = new Set<string>();
  const curated: Record<string, unknown>[] = [];
  if (existsSync(outPath)) {
    for (const line of readFileSync(outPath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const c = JSON.parse(line) as { id?: unknown };
        if (typeof c.id === "string") {
          seen.add(c.id);
          curated.push(c as Record<string, unknown>);
        }
      } catch { /* skip */ }
    }
  }
  console.log(`[ETL] existing pool: ${curated.length} rows`);

  let added = 0;
  for (const f of files) {
    const local = resolve(parquetDir, f.replaceAll("/", "__"));
    await download(`${HF_RESOLVE}/${f}`, local);
    // hyparquet needs a bare ArrayBuffer (Node Buffers are pooled views).
    const buf = readFileSync(local);
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    const rows = (await parquetReadObjects({ file: ab, columns: KEEP_COLUMNS })) as Record<string, unknown>[];
    console.log(`[ETL] ${f}: ${rows.length} rows`);
    for (const row of rows) {
      if (language && String(row["language"] ?? "") !== language) continue;
      const id = String(row["id"] ?? "");
      if (!id || seen.has(id)) continue;
      const problem = cleanMarkdown(row["problem_markdown"], 3500);
      const sols = Array.isArray(row["solutions_markdown"]) ? (row["solutions_markdown"] as unknown[]) : [];
      const solution = cleanMarkdown(sols.length > 0 ? sols[0] : "", 6000);
      if (!problem || !solution) continue;
      const topics = Array.isArray(row["topics_flat"]) ? (row["topics_flat"] as unknown[]).map(String) : [];
      const competition = String(row["competition"] ?? "Unknown");
      const { hardness, reason } = computeHardness(competition, (row["problem_type"] as string) ?? null, solution.length, topics.length);
      seen.add(id);
      curated.push({
        id,
        problemMarkdown: problem,
        solutionMarkdown: solution,
        topics,
        competition,
        country: String(row["country"] ?? "Unknown"),
        hardness,
        hardnessReason: reason,
        problemType: (row["problem_type"] as string) ?? null,
        finalAnswer: (row["final_answer"] as string) ?? null,
        imageCount: 0,
      });
      added += 1;
    }
    console.log(`[ETL] +${added} new rows so far (pool ${curated.length})`);
  }

  shuffle(curated, seed);
  writeFileSync(outPath, curated.map((c) => JSON.stringify(c)).join("\n") + "\n", "utf-8");
  writeFileSync(
    resolve(dirname(outPath), "manifest.json"),
    JSON.stringify(
      {
        source: DATASET,
        language,
        count: curated.length,
        seed,
        license: "CC-BY-4.0 (respect per-country copyright; see country/competition fields)",
        hardness: "heuristic, staff-overridable",
        images: "source figure bytes skipped; renderer draws its own card",
      },
      null,
      2,
    ),
    "utf-8",
  );
  console.log(`[ETL] done: +${added} new, pool ${curated.length} -> ${outPath}`);
}

main().catch((err) => {
  console.error("[ETL] failed:", err);
  process.exitCode = 1;
});

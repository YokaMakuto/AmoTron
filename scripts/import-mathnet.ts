/**
 * Offline ETL (Node, no Python needed): ShadenA/MathNet -> curated JSONL.
 *
 * Pulls rows page by page from the HuggingFace datasets-server API,
 * filters to one language, drops oversized markdown (Discord limits),
 * computes a heuristic hardness (MathNet v0 has NO difficulty column),
 * shuffles deterministically, and writes prisma/data/mathnet-curated.jsonl
 * + manifest.json. Afterwards run: npm run seed:daily
 *
 * Usage:
 *   npx tsx scripts/import-mathnet.ts [--limit 30000] [--language English]
 *       [--out prisma/data/mathnet-curated.jsonl] [--seed 42]
 *
 * Note: source figure bytes are NOT imported by this path (the renderer
 * draws its own card); image refs become "[Figure N]" placeholders.
 */
import { appendFileSync, existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATASET = "ShadenA/MathNet";
const PAGE = 100;

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

/** Deterministic shuffle (mulberry32). */
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

interface ApiRow {
  row: Record<string, unknown>;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function fetchRows(offset: number): Promise<ApiRow[]> {
  const url =
    `https://datasets-server.huggingface.co/rows?dataset=${DATASET}` +
    `&config=all&split=train&offset=${offset}&length=${PAGE}`;
  let lastErr = "";
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const res = await fetch(url);
    if (res.ok) return ((await res.json()) as { rows?: ApiRow[] }).rows ?? [];
    const retryAfter = Number(res.headers.get("retry-after") ?? 0);
    const wait = (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1500 * 2 ** attempt) + Math.random() * 500;
    lastErr = `rows API ${res.status} at offset ${offset} (attempt ${attempt}/8)`;
    console.log(`[ETL] ${lastErr} — waiting ${Math.round(wait)}ms`);
    await sleep(wait);
  }
  throw new Error(lastErr);
}

async function main(): Promise<void> {
  const a = args();
  const limit = Number(a["limit"] ?? 30000);
  const language = a["language"] ?? "English";
  const seed = Number(a["seed"] ?? 42);
  const here = dirname(fileURLToPath(import.meta.url));
  const outPath = resolve(here, "..", a["out"] ?? "prisma/data/mathnet-curated.jsonl");
  const rawPath = resolve(dirname(outPath), "mathnet-raw.jsonl");
  const statePath = resolve(dirname(outPath), "etl-state.json");
  const fresh = a["fresh"] === "true";

  if (fresh) {
    for (const f of [rawPath, statePath]) {
      try {
        if (existsSync(f)) unlinkSync(f);
      } catch { /* ignore */ }
    }
  }

  // Resume: rebuild seen-ids from the incremental raw file + saved offset.
  const curated: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let offset = 0;
  if (existsSync(rawPath)) {
    for (const line of readFileSync(rawPath, "utf-8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const c = JSON.parse(line) as { id?: unknown };
        if (typeof c.id === "string") {
          seen.add(c.id);
          curated.push(c as Record<string, unknown>);
        }
      } catch { /* skip bad line */ }
    }
  }
  if (existsSync(statePath)) {
    try {
      offset = Number((JSON.parse(readFileSync(statePath, "utf-8")) as { offset?: unknown }).offset ?? 0) || 0;
    } catch { /* start over */ }
  }
  if (curated.length > 0) console.log(`[ETL] resuming with ${curated.length} kept rows from offset ${offset}...`);
  let fetched = offset;

  for (;;) {
    const rows = await fetchRows(offset);
    if (rows.length === 0) break;
    fetched += rows.length;

    for (const { row } of rows) {
      if (curated.length >= limit) break;
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
      const entry = {
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
      };
      curated.push(entry);
      appendFileSync(rawPath, JSON.stringify(entry) + "\n", "utf-8");
    }
    if (curated.length >= limit) break;
    offset += rows.length;
    writeFileSync(statePath, JSON.stringify({ offset }), "utf-8");
    if (rows.length < PAGE) break;
    await sleep(300); // stay under the API rate limit
    if (offset % 2000 === 0) console.log(`[ETL] scanned ${offset} rows, kept ${curated.length}...`);
  }

  shuffle(curated, seed);
  const lines = curated.map((c) => JSON.stringify(c)).join("\n") + "\n";
  writeFileSync(outPath, lines, "utf-8");
  writeFileSync(
    resolve(dirname(outPath), "manifest.json"),
    JSON.stringify(
      {
        source: DATASET,
        language,
        count: curated.length,
        scanned: fetched,
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
  for (const f of [rawPath, statePath]) {
    try {
      if (existsSync(f)) unlinkSync(f);
    } catch { /* ignore */ }
  }
  console.log(`[ETL] scanned ${fetched} rows, wrote ${curated.length} -> ${outPath}`);
}

main().catch((err) => {
  console.error("[ETL] failed:", err);
  process.exitCode = 1;
});

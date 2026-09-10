import {
  AttachmentBuilder,
  ChannelType,
  type Guild,
  type Message,
  type TextChannel,
} from "discord.js";
import { prisma } from "../database/prisma.js";
import { ensureGuildConfig, setGuildConfig } from "../database/repositories/configRepository.js";
import { writeAudit } from "../database/repositories/auditRepository.js";
import { logger } from "./loggingService.js";
import { renderMessageImage, type CardOpts } from "./latexRender.js";
import { BotError } from "../utils/errors.js";

export type Hardness = "Easy" | "Medium" | "Hard";

/** Plain-text chunking: Discord messages cap at 2000 chars. */
export const DISCORD_MESSAGE_LIMIT = 1950;

export interface DailyProblemRow {
  id: string;
  problemMarkdown: string;
  solutionMarkdown: string;
  topics: string;
  competition: string;
  country: string;
  hardness: string;
  hardnessReason: string | null;
  problemType: string | null;
  finalAnswer: string | null;
  timesUsed: number;
  lastUsedAt: Date | null;
}

/** Pure: parse stored JSON topics list. Never throws. */
export function parseTopics(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** Pure: short topic labels for the embed (last segment of "A > B > C"). */
export function shortTopics(topics: string[], max = 3): string {
  if (topics.length === 0) return "General";
  return topics
    .slice(0, max)
    .map((t) => t.split(">").map((s) => s.trim()).pop() ?? t)
    .join(" · ")
    .slice(0, 200);
}

/**
 * Pure: split markdown into plain-message chunks (Discord 2000-char cap).
 * Posted as raw text so LaTeX renderer bots pick it up (embeds are ignored
 * by them). No truncation — the full problem/solution is always delivered.
 */
export function chunkText(md: string, limit = DISCORD_MESSAGE_LIMIT): string[] {
  const text = md.trim();
  if (text.length <= limit) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n\n", limit);
    if (cut < limit * 0.4) cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.4) cut = limit;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest) chunks.push(rest);
  return chunks;
}

/**
 * Pure (legacy): split long markdown into a preview chunk + flag for file fallback.
 * Kept for tests; posting now uses chunkText (full text, no truncation).
 */
export function splitForDiscord(md: string, previewLimit = 3500): { preview: string; needsFile: boolean } {
  if (md.length <= previewLimit) return { preview: md, needsFile: false };
  const cut = md.lastIndexOf("\n\n", previewLimit);
  const at = cut > previewLimit * 0.5 ? cut : previewLimit;
  return { preview: md.slice(0, at) + "\n\n…(truncated — full text attached)", needsFile: true };
}

/** Pure: "HH:MM" UTC validation. */
export function isValidDailyTime(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

/** Pure: has today's UTC date already been posted? Compares YYYY-MM-DD. */
export function alreadyPostedToday(postedAt: Date | null | undefined, now = new Date()): boolean {
  if (!postedAt) return false;
  return postedAt.toISOString().slice(0, 10) === now.toISOString().slice(0, 10);
}

/** Pure: is it time to post today? nowUtc "HH:MM" >= configured time and not yet posted. */
export function shouldPostNow(dailyTimeUtc: string, lastPostedAt: Date | null | undefined, now = new Date()): boolean {
  if (alreadyPostedToday(lastPostedAt, now)) return false;
  const hh = now.getUTCHours().toString().padStart(2, "0");
  const mm = now.getUTCMinutes().toString().padStart(2, "0");
  return `${hh}:${mm}` >= dailyTimeUtc;
}

/** Pure: does a stored topics JSON list match a keyword (case-insensitive)? */
export function matchesTopic(topicsJson: string | null | undefined, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return false;
  return parseTopics(topicsJson).some((t) => t.toLowerCase().includes(kw));
}

/** Pure: does a competition name match a keyword (case-insensitive)? */
export function matchesCompetition(competition: string | null | undefined, keyword: string): boolean {
  const kw = keyword.trim().toLowerCase();
  if (!kw) return false;
  return (competition ?? "").toLowerCase().includes(kw);
}

/** Least-used first, then oldest, then random — guarantees full rotation before repeats. */
export async function pickNextProblem(): Promise<DailyProblemRow | null> {
  const rows = await prisma.dailyProblem.findMany({
    orderBy: [{ timesUsed: "asc" }, { lastUsedAt: "asc" }],
    take: 20,
  });
  if (rows.length === 0) return null;
  const pool = rows.filter((r) => r.timesUsed === rows[0]!.timesUsed);
  return pool[Math.floor(Math.random() * pool.length)] as DailyProblemRow;
}

async function fetchDailyChannel(guild: Guild, channelId: string): Promise<TextChannel | null> {
  try {
    const ch = await guild.channels.fetch(channelId);
    if (ch && ch.type === ChannelType.GuildText) return ch as TextChannel;
    return null;
  } catch {
    return null;
  }
}

/**
 * Best-effort single-image render. Never throws: on failure the plain-text
 * post still goes out without an attachment.
 */
async function tryRenderImage(md: string, name: string, card: CardOpts): Promise<AttachmentBuilder[]> {
  try {
    const png = await renderMessageImage(md, card);
    return [new AttachmentBuilder(png, { name })];
  } catch (err) {
    logger.warn("LATEX", `Full-message render failed, posting text only: ${String(err)}`);
    return [];
  }
}

/** Pure: "Sep 10" style UTC date for the in-image card header. */
export function formatCardDate(now = new Date()): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[now.getUTCMonth()]} ${now.getUTCDate()}`;
}

function cardFooter(p: DailyProblemRow): string {
  return `${p.competition} • ${p.country} • MathNet CC-BY-4.0`;
}

/**
 * Image-only post: the message carries just the rendered PNG, no text.
 * Falls back to plain text chunks if rendering failed, so a post is
 * never lost.
 */
async function sendImageOrText(
  channel: TextChannel,
  md: string,
  fileName: string,
  card: CardOpts,
  replyTo?: Message,
): Promise<Message> {
  const files = await tryRenderImage(md, fileName, card);
  if (files.length > 0) {
    return replyTo ? await replyTo.reply({ files }) : await channel.send({ files });
  }
  return sendPlainChunks(channel, chunkText(md), replyTo);
}

/**
 * Send chunks as plain messages. First chunk is a reply when `replyTo` is
 * given, the rest follow as plain messages. Rendered math images ride on the
 * first message. Returns the first message.
 */
async function sendPlainChunks(
  channel: TextChannel,
  chunks: string[],
  replyTo?: Message,
  files: AttachmentBuilder[] = [],
): Promise<Message> {
  const head = chunks[0];
  if (!head || !head.trim()) throw new BotError("EMPTY_TEXT", "Nothing to post.");
  const first = replyTo
    ? await replyTo.reply({ content: head, files })
    : await channel.send({ content: head, files });
  for (const c of chunks.slice(1)) {
    await channel.send({ content: c });
  }
  return first;
}

/**
 * Post today's problem if due. Idempotent per UTC day: skips when a DailyPost
 * already exists for this guild today.
 */
export async function postDailyIfDue(guild: Guild, now = new Date()): Promise<"posted" | "skipped" | "disabled"> {
  const config = await ensureGuildConfig(guild.id);
  if (!config.dailyEnabled || !config.dailyChannelId) return "disabled";
  if (!shouldPostNow(config.dailyTimeUtc, await lastPostDate(guild.id), now)) return "skipped";

  const channel = await fetchDailyChannel(guild, config.dailyChannelId);
  if (!channel) {
    logger.warn("DAILY", `Guild ${guild.id}: daily channel ${config.dailyChannelId} not found.`);
    return "skipped";
  }

  const problem = await pickNextProblem();
  if (!problem) {
    logger.warn("DAILY", "No daily problems seeded. Run: npx tsx prisma/seed-daily.ts");
    return "skipped";
  }

  const dayNumber = config.dailyCursor + 1;
  // Image-only: the message carries just the rendered PNG, no text.
  // (Renderer bots ignore bot-authored messages, so our own black card
  // is the readable copy; MathNet source lives in the in-image footer.)
  const msg = await sendImageOrText(
    channel,
    problem.problemMarkdown,
    "problem.png",
    { title: `Daily Problem — ${formatCardDate(now)}`, footer: cardFooter(problem) },
  );
  const dueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  await prisma.dailyPost.create({
    data: {
      guildId: guild.id,
      problemId: problem.id,
      problemMessageId: msg.id,
      solutionDueAt: dueAt,
    },
  });
  await prisma.dailyProblem.update({
    where: { id: problem.id },
    data: { timesUsed: { increment: 1 }, lastUsedAt: now },
  });
  await setGuildConfig(guild.id, { dailyCursor: dayNumber });
  await writeAudit({
    guildId: guild.id,
    action: "DAILY_POSTED",
    channelId: channel.id,
    metadata: { problemId: problem.id, dayNumber },
  });
  logger.info("DAILY", `Posted #${dayNumber} (${problem.id}) in guild ${guild.id}.`);
  return "posted";
}

/** Post solutions whose 24h window elapsed and which are still unsolved. */
export async function postDueSolutions(guild: Guild, now = new Date()): Promise<number> {
  const config = await ensureGuildConfig(guild.id);
  if (!config.dailyEnabled || !config.dailyChannelId) return 0;
  const channel = await fetchDailyChannel(guild, config.dailyChannelId);
  if (!channel) return 0;

  const due = await prisma.dailyPost.findMany({
    where: { guildId: guild.id, solved: false, solutionDueAt: { lte: now } },
    orderBy: { postedAt: "asc" },
    take: 5,
  });
  let count = 0;
  for (const post of due) {
    const problem = (await prisma.dailyProblem.findUnique({
      where: { id: post.problemId },
    })) as DailyProblemRow | null;
    if (!problem) continue;
    const card = { title: "Solution", footer: cardFooter(problem) };
    try {
      let solutionMessageId: string | undefined;
      if (post.problemMessageId) {
        try {
          const orig = await channel.messages.fetch(post.problemMessageId);
          solutionMessageId = (await sendImageOrText(channel, problem.solutionMarkdown, "solution.png", card, orig)).id;
        } catch {
          solutionMessageId = (await sendImageOrText(channel, problem.solutionMarkdown, "solution.png", card)).id;
        }
      } else {
        solutionMessageId = (await sendImageOrText(channel, problem.solutionMarkdown, "solution.png", card)).id;
      }
      await prisma.dailyPost.update({
        where: { id: post.id },
        data: { solved: true, solutionMessageId },
      });
      count += 1;
    } catch (err) {
      logger.warn("DAILY", `Failed to post solution for ${post.problemId}: ${String(err)}`);
    }
  }
  return count;
}

/** Reveal today's (or latest unsolved) solution on demand. */
export async function revealSolutionNow(guild: Guild, actorUserId?: string): Promise<DailyProblemRow> {
  const latest = await prisma.dailyPost.findFirst({
    where: { guildId: guild.id, solved: false },
    orderBy: { postedAt: "desc" },
  });
  if (!latest) throw new BotError("NO_UNSOLVED", "No unsolved daily problem. Wait for the next one!");
  const config = await ensureGuildConfig(guild.id);
  const channel = config.dailyChannelId ? await fetchDailyChannel(guild, config.dailyChannelId) : null;
  if (!channel) throw new BotError("NO_CHANNEL", "Daily channel is not configured.");
  const problem = (await prisma.dailyProblem.findUnique({
    where: { id: latest.problemId },
  })) as DailyProblemRow | null;
  if (!problem) throw new BotError("NOT_FOUND", "Problem data missing.");
  const sent = await sendImageOrText(channel, problem.solutionMarkdown, "solution.png", {
    title: "Solution",
    footer: cardFooter(problem),
  });
  await prisma.dailyPost.update({
    where: { id: latest.id },
    data: { solved: true, solutionMessageId: sent.id },
  });
  await writeAudit({ guildId: guild.id, action: "DAILY_SOLUTION_REVEALED", actorUserId, metadata: { problemId: problem.id } });
  return problem;
}

async function lastPostDate(guildId: string): Promise<Date | null> {
  // Only scheduled posts gate the daily cadence; on-demand requests
  // (kind=requested) must never swallow the scheduled problem.
  const latest = await prisma.dailyPost.findFirst({
    where: { guildId, kind: "scheduled" },
    orderBy: { postedAt: "desc" },
    select: { postedAt: true },
  });
  return latest?.postedAt ?? null;
}

export interface RequestFilter {
  id?: string;
  topic?: string;
  competition?: string;
}

/**
 * Post a specific problem on demand (by MathNet id, or a random match for a
 * topic keyword). Image-only card, solution auto-posts in 24h like scheduled
 * ones but never blocks the daily cadence (kind=requested).
 */
export async function requestProblem(
  guild: Guild,
  filter: RequestFilter,
  actorUserId?: string,
  now = new Date(),
): Promise<DailyProblemRow> {
  const id = filter.id?.trim();
  const topic = filter.topic?.trim();
  const competition = filter.competition?.trim();
  if (!id && !topic && !competition) {
    throw new BotError("NO_FILTER", "Give an `id` (see `/daily history`), a `topic` keyword, or a `competition` (e.g. `IMO 2026`).");
  }

  let problem: DailyProblemRow | null = null;
  if (id) {
    problem = (await prisma.dailyProblem.findUnique({ where: { id } })) as DailyProblemRow | null;
    if (!problem) throw new BotError("NOT_FOUND", `No problem with id \`${id}\`. Pick one from \`/daily history\`.`);
  } else {
    const candidates = (await prisma.dailyProblem.findMany({
      where: {
        ...(topic ? { topics: { contains: topic } } : {}),
        ...(competition ? { competition: { contains: competition } } : {}),
      },
      orderBy: [{ timesUsed: "asc" }, { lastUsedAt: "asc" }],
      take: 50,
    })) as DailyProblemRow[];
    const pool = candidates.filter(
      (c) =>
        (!topic || matchesTopic(c.topics, topic)) &&
        (!competition || matchesCompetition(c.competition, competition)),
    );
    if (pool.length === 0) {
      const what = [topic ? `topic \`${topic}\`` : "", competition ? `competition \`${competition}\`` : ""]
        .filter(Boolean)
        .join(" + ");
      throw new BotError("NO_MATCH", `No problems matching ${what}. Try another keyword — the pool grows when you import more of MathNet (see \`npm run etl:mathnet\`).`);
    }
    const least = pool[0]!.timesUsed;
    const fresh = pool.filter((c) => c.timesUsed === least);
    problem = fresh[Math.floor(Math.random() * fresh.length)] as DailyProblemRow;
  }

  const config = await ensureGuildConfig(guild.id);
  if (!config.dailyEnabled || !config.dailyChannelId) {
    throw new BotError("DAILY_OFF", "Daily problems are not enabled. An admin can set this up with `/config daily-channel` + `/config daily-enable`.");
  }
  const channel = await fetchDailyChannel(guild, config.dailyChannelId);
  if (!channel) throw new BotError("NO_CHANNEL", "Daily channel is not configured.");

  const msg = await sendImageOrText(channel, problem.problemMarkdown, "problem.png", {
    title: `Requested Problem — ${formatCardDate(now)}`,
    footer: cardFooter(problem),
  });
  await prisma.dailyPost.create({
    data: {
      guildId: guild.id,
      problemId: problem.id,
      problemMessageId: msg.id,
      kind: "requested",
      solutionDueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    },
  });
  await prisma.dailyProblem.update({
    where: { id: problem.id },
    data: { timesUsed: { increment: 1 }, lastUsedAt: now },
  });
  await writeAudit({
    guildId: guild.id,
    action: "DAILY_REQUESTED",
    actorUserId,
    channelId: channel.id,
    metadata: { problemId: problem.id, filter },
  });
  logger.info("DAILY", `Requested ${problem.id} posted in guild ${guild.id} by ${actorUserId ?? "?"}).`);
  return problem;
}

/** Sweep one guild: solutions first, then today's problem. Returns counts for logging. */
export async function runDailySweepForGuild(
  guild: Guild,
  now = new Date(),
): Promise<{ solutions: number; problem: string }> {
  const solutions = await postDueSolutions(guild, now);
  const problem = await postDailyIfDue(guild, now);
  return { solutions, problem };
}

// --- Admin configuration helpers (called by /config) ---

export async function setDailyChannel(guildId: string, channelId: string, actorUserId?: string) {
  const config = await setGuildConfig(guildId, { dailyChannelId: channelId });
  await writeAudit({ guildId, action: "CONFIG_DAILY_CHANNEL_SET", actorUserId, metadata: { channelId } });
  return config;
}

export async function setDailyTime(guildId: string, timeUtc: string, actorUserId?: string) {
  if (!isValidDailyTime(timeUtc)) throw new BotError("BAD_TIME", "Use HH:MM in 24h UTC (e.g. 07:00).");
  const config = await setGuildConfig(guildId, { dailyTimeUtc: timeUtc });
  await writeAudit({ guildId, action: "CONFIG_DAILY_TIME_SET", actorUserId, metadata: { timeUtc } });
  return config;
}

export async function setDailyEnabled(guildId: string, enabled: boolean, actorUserId?: string) {
  const config = await setGuildConfig(guildId, { dailyEnabled: enabled });
  await writeAudit({
    guildId,
    action: enabled ? "CONFIG_DAILY_ENABLED" : "CONFIG_DAILY_DISABLED",
    actorUserId,
  });
  return config;
}

export async function getTodayPost(guildId: string) {
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  return prisma.dailyPost.findFirst({
    where: { guildId, postedAt: { gte: startOfDay } },
    orderBy: { postedAt: "desc" },
  });
}

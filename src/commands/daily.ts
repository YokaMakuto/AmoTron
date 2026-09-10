import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { prisma } from "../database/prisma.js";
import {
  getTodayPost,
  parseTopics,
  requestProblem,
  revealSolutionNow,
  shortTopics,
} from "../services/dailyService.js";
import { toUserMessage } from "../utils/errors.js";

export const dailyData = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Daily MathNet problem: hardness, topics, solution")
  .addSubcommand((s) => s.setName("today").setDescription("Show today's problem"))
  .addSubcommand((s) => s.setName("solution").setDescription("Reveal the solution (staff or after 24h)"))
  .addSubcommand((s) => s.setName("history").setDescription("Show the last 5 daily problems"))
  .addSubcommand((s) =>
    s
      .setName("get")
      .setDescription("Ask for a specific problem by id, topic, or competition")
      .addStringOption((o) => o.setName("id").setDescription("Problem id from /daily history (e.g. 06op)"))
      .addStringOption((o) =>
        o.setName("topic").setDescription("Topic keyword, e.g. geometry, algebra, combinatorics"),
      )
      .addStringOption((o) =>
        o.setName("competition").setDescription("Competition, e.g. IMO 2026, APMO, IMO Shortlist"),
      ),
  );

async function isStaff(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild || !interaction.member) return false;
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const staffRoles = await prisma.staffRole.findMany({ where: { guildId: interaction.guild.id } });
  return staffRoles.some((r) => member.roles.cache.has(r.roleId));
}

export async function executeDaily(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand();
  try {
    if (sub === "today") {
      const post = await getTodayPost(guildId);
      if (!post) {
        await interaction.reply({
          ephemeral: true,
          content: "No daily problem posted yet today. Enable with `/config daily-enable`, or wait for the scheduled time.",
        });
        return;
      }
      const problem = await prisma.dailyProblem.findUnique({ where: { id: post.problemId } });
      if (!problem) {
        await interaction.reply({ content: "Problem data missing.", ephemeral: true });
        return;
      }
      const topics = parseTopics(problem.topics);
      await interaction.reply({
        ephemeral: true,
        content:
          `**Today's problem**\n` +
          `Topics: ${shortTopics(topics)}\n` +
          `Source: ${problem.competition} • ${problem.country}\n` +
          (post.solved ? "Solution already revealed — see the channel." : "Solution drops 24h after posting (or `/daily solution`)."),
      });
      return;
    }
    if (sub === "solution") {
      const post = await getTodayPost(guildId);
      const due = !post || new Date() >= post.solutionDueAt;
      if (!due && !(await isStaff(interaction))) {
        await interaction.reply({
          ephemeral: true,
          content: "The solution unlocks 24h after posting. Ask staff to reveal it early.",
        });
        return;
      }
      const problem = await revealSolutionNow(interaction.guild, interaction.user.id);
      await interaction.reply({
        ephemeral: true,
        content: `Solution for \`${problem.id}\` posted in the daily channel.`,
      });
      return;
    }
    if (sub === "history") {
      const posts = await prisma.dailyPost.findMany({
        where: { guildId },
        orderBy: { postedAt: "desc" },
        take: 5,
      });
      if (posts.length === 0) {
        await interaction.reply({ content: "No daily problems yet.", ephemeral: true });
        return;
      }
      const lines: string[] = [];
      for (const p of posts) {
        const prob = await prisma.dailyProblem.findUnique({ where: { id: p.problemId } });
        lines.push(
          `• \`${p.problemId}\` ${prob?.competition ?? ""} — ${p.solved ? "solved" : "open"}`,
        );
      }
      await interaction.reply({ ephemeral: true, content: `**Last ${posts.length} daily problems**\n${lines.join("\n")}` });
      return;
    }
    if (sub === "get") {
      const id = interaction.options.getString("id") ?? undefined;
      const topic = interaction.options.getString("topic") ?? undefined;
      const competition = interaction.options.getString("competition") ?? undefined;
      if (!id && !topic && !competition) {
        await interaction.reply({
          ephemeral: true,
          content: "Give an `id` (see `/daily history`), a `topic` (e.g. `/daily get topic:geometry`), or a `competition` (e.g. `/daily get competition:IMO 2026`).",
        });
        return;
      }
      // Rendering takes a couple of seconds — defer to stay in the 3s window.
      await interaction.deferReply({ ephemeral: true });
      try {
        const problem = await requestProblem(interaction.guild, { id, topic, competition }, interaction.user.id);
        await interaction.editReply(`Posted \`${problem.id}\` (${problem.competition}) in the daily channel. Solution drops in 24h.`);
      } catch (err) {
        await interaction.editReply(toUserMessage(err, "Could not fetch that problem"));
      }
      return;
    }
    await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
  } catch (err) {
    await interaction.reply({ content: toUserMessage(err, "Daily command failed"), ephemeral: true });
  }
}

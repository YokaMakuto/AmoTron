import type { Guild, TextChannel } from "discord.js";
import { EmbedBuilder } from "discord.js";

type LogLevel = "info" | "warn" | "error";

function line(level: LogLevel, tag: string, message: string): void {
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`[${tag}] ${message}`);
}

export const logger = {
  info: (tag: string, message: string) => line("info", tag, message),
  warn: (tag: string, message: string) => line("warn", tag, message),
  error: (tag: string, message: string, err?: unknown) => {
    line("error", tag, message);
    if (err) console.error(err);
  },
};

/** Best-effort embed to the configured Discord log channel; never throws. */
export async function sendLogEmbed(
  guild: Guild,
  logChannelId: string | null | undefined,
  opts: { title: string; description: string; color?: number },
): Promise<void> {
  if (!logChannelId) return;
  try {
    const channel = await guild.channels.fetch(logChannelId);
    if (!channel || !channel.isTextBased()) return;
    const embed = new EmbedBuilder()
      .setTitle(opts.title)
      .setDescription(opts.description.slice(0, 4000))
      .setColor(opts.color ?? 0x5865f2)
      .setTimestamp();
    await (channel as TextChannel).send({ embeds: [embed] });
  } catch (err) {
    logger.warn("LOG", `Failed to send log embed: ${String(err)}`);
  }
}

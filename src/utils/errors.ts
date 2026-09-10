import { DiscordAPIError } from "discord.js";

export class BotError extends Error {
  readonly userMessage: string;
  readonly code: string;

  constructor(code: string, message: string, userMessage?: string) {
    super(message);
    this.name = "BotError";
    this.code = code;
    this.userMessage = userMessage ?? message;
  }
}

/** Translate raw Discord API errors into actionable explanations. */
export function describeDiscordError(error: unknown): string | null {
  if (!(error instanceof DiscordAPIError)) return null;
  switch (error.code) {
    case 50013:
      return (
        "Missing Permissions: the bot's role needs Manage Channels + Manage Roles, " +
        "must sit ABOVE all staff/trigger roles in Server Settings → Roles, " +
        "and must not be denied access in the private category's ⚙ → Permissions."
      );
    case 50001:
      return "Missing Access: the bot cannot see the category/channel. Check the category's ⚙ → Permissions for the bot role.";
    case 10003:
      return "Unknown Channel: the channel was deleted.";
    case 10011:
      return "Unknown Role: a configured role no longer exists. Run /config show and fix roles.";
    default:
      return `Discord API error ${error.code}: ${error.message}`;
  }
}

export function toUserMessage(error: unknown, fallback: string): string {
  if (error instanceof BotError) return error.userMessage;
  const described = describeDiscordError(error);
  if (described) return `${fallback}. ${described}`;
  if (error instanceof Error && error.message) return `${fallback}: ${error.message}`;
  return fallback;
}

import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] ?? fallback;
}

export const env = {
  discordToken: required("DISCORD_TOKEN"),
  clientId: optional("CLIENT_ID"),
  guildId: optional("GUILD_ID"),
  databaseUrl: optional("DATABASE_URL", "file:./dev.db"),
  logLevel: optional("LOG_LEVEL", "info"),
};

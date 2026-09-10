import { prisma } from "../prisma.js";

export async function upsertUser(args: {
  guildId: string;
  discordUserId: string;
  usernameSnapshot?: string;
}): Promise<void> {
  await prisma.user.upsert({
    where: {
      guildId_discordUserId: { guildId: args.guildId, discordUserId: args.discordUserId },
    },
    update: { usernameSnapshot: args.usernameSnapshot },
    create: {
      guildId: args.guildId,
      discordUserId: args.discordUserId,
      usernameSnapshot: args.usernameSnapshot,
    },
  });
}

export async function findUser(guildId: string, discordUserId: string) {
  return prisma.user.findUnique({
    where: { guildId_discordUserId: { guildId, discordUserId } },
  });
}

import { prisma } from "../prisma.js";

export async function getGuildConfig(guildId: string) {
  return prisma.guildConfig.findUnique({ where: { guildId } });
}

export async function ensureGuildConfig(guildId: string) {
  return prisma.guildConfig.upsert({
    where: { guildId },
    update: {},
    create: { guildId },
  });
}

export async function setGuildConfig(
  guildId: string,
  data: {
    privateCategoryId?: string | null;
    logChannelId?: string | null;
    removalAction?: string;
    dailyChannelId?: string | null;
    dailyTimeUtc?: string;
    dailyEnabled?: boolean;
    dailyCursor?: number;
  },
) {
  return prisma.guildConfig.upsert({
    where: { guildId },
    update: data,
    create: { guildId, ...data },
  });
}

export async function listTriggerRoles(guildId: string) {
  return prisma.triggerRole.findMany({ where: { guildId }, orderBy: { createdAt: "asc" } });
}

export async function addTriggerRole(guildId: string, roleId: string) {
  return prisma.triggerRole.upsert({
    where: { guildId_roleId: { guildId, roleId } },
    update: {},
    create: { guildId, roleId },
  });
}

export async function removeTriggerRole(guildId: string, roleId: string) {
  return prisma.triggerRole.deleteMany({ where: { guildId, roleId } });
}

export async function listStaffRoles(guildId: string) {
  return prisma.staffRole.findMany({ where: { guildId }, orderBy: { createdAt: "asc" } });
}

export async function addStaffRole(guildId: string, roleId: string) {
  return prisma.staffRole.upsert({
    where: { guildId_roleId: { guildId, roleId } },
    update: {},
    create: { guildId, roleId },
  });
}

export async function removeStaffRole(guildId: string, roleId: string) {
  return prisma.staffRole.deleteMany({ where: { guildId, roleId } });
}

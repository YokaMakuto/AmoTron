import { prisma } from "../prisma.js";
import type { RoomStatus } from "../../types/index.js";

export async function findActiveRoom(guildId: string, discordUserId: string) {
  return prisma.privateRoom.findUnique({
    where: { guildId_discordUserId_status: { guildId, discordUserId, status: "ACTIVE" } },
  });
}

export async function findRoomByChannel(channelId: string) {
  return prisma.privateRoom.findUnique({ where: { channelId } });
}

export async function listActiveRooms(guildId: string) {
  return prisma.privateRoom.findMany({
    where: { guildId, status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
  });
}

export async function createActiveRoom(args: {
  guildId: string;
  discordUserId: string;
  channelId: string;
  categoryId?: string;
}) {
  return prisma.privateRoom.create({
    data: {
      guildId: args.guildId,
      discordUserId: args.discordUserId,
      channelId: args.channelId,
      categoryId: args.categoryId,
      status: "ACTIVE",
    },
  });
}

export async function updateRoomStatus(
  id: number,
  status: RoomStatus,
  extra: { closedAt?: Date | null; deletedAt?: Date | null } = {},
) {
  return prisma.privateRoom.update({ where: { id }, data: { status, ...extra } });
}

export async function updateRoomChannel(id: number, channelId: string) {
  return prisma.privateRoom.update({ where: { id }, data: { channelId } });
}

import { prisma } from "../prisma.js";
import type { AuditAction } from "../../types/index.js";

export async function writeAudit(args: {
  guildId: string;
  action: AuditAction;
  actorUserId?: string;
  targetUserId?: string;
  channelId?: string;
  roleId?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      guildId: args.guildId,
      action: args.action,
      actorUserId: args.actorUserId,
      targetUserId: args.targetUserId,
      channelId: args.channelId,
      roleId: args.roleId,
      metadata: args.metadata ? JSON.stringify(args.metadata) : null,
    },
  });
}

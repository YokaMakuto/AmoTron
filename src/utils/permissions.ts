import { PermissionFlagsBits, type OverwriteResolvable } from "discord.js";

/**
 * Single source of permission-overwrite logic. Every creation and every
 * sync goes through here so staff/owner/everyone rules cannot drift.
 */
export function buildPrivateOverwrites(args: {
  guildEveryoneId: string;
  ownerUserId: string;
  staffRoleIds: string[];
}): OverwriteResolvable[] {
  const overwrites: OverwriteResolvable[] = [
    {
      id: args.guildEveryoneId,
      deny: [PermissionFlagsBits.ViewChannel],
    },
    {
      id: args.ownerUserId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    },
  ];

  for (const roleId of args.staffRoleIds) {
    if (roleId === args.guildEveryoneId || roleId === args.ownerUserId) continue;
    overwrites.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    });
  }

  return overwrites;
}

/** Overwrites for a closed room: owner keeps read access, loses Send. */
export function buildClosedOverwrites(args: {
  guildEveryoneId: string;
  ownerUserId: string;
  staffRoleIds: string[];
}): OverwriteResolvable[] {
  return [
    { id: args.guildEveryoneId, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: args.ownerUserId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: [PermissionFlagsBits.SendMessages],
    },
    ...args.staffRoleIds
      .filter((r) => r !== args.guildEveryoneId && r !== args.ownerUserId)
      .map((roleId) => ({
        id: roleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
        ] as const,
      })),
  ];
}

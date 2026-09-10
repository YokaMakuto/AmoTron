import type { Guild, TextChannel } from "discord.js";
import { buildClosedOverwrites, buildPrivateOverwrites } from "../utils/permissions.js";

export async function applyOpenPermissions(
  channel: TextChannel,
  guild: Guild,
  ownerUserId: string,
  staffRoleIds: string[],
): Promise<void> {
  await channel.permissionOverwrites.set(
    buildPrivateOverwrites({
      guildEveryoneId: guild.roles.everyone.id,
      ownerUserId,
      staffRoleIds,
    }),
  );
}

export async function applyClosedPermissions(
  channel: TextChannel,
  guild: Guild,
  ownerUserId: string,
  staffRoleIds: string[],
): Promise<void> {
  await channel.permissionOverwrites.set(
    buildClosedOverwrites({
      guildEveryoneId: guild.roles.everyone.id,
      ownerUserId,
      staffRoleIds,
    }),
  );
}

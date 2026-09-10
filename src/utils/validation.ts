import type { Guild, GuildMember } from "discord.js";
import { ChannelType, PermissionFlagsBits } from "discord.js";

export interface StartupWarning {
  code: string;
  message: string;
}

/** Validate bot readiness for a guild; returns warnings instead of throwing. */
export function validateGuildSetup(
  guild: Guild,
  opts: { categoryId?: string | null; staffRoleIds: string[]; triggerRoleIds: string[] },
): StartupWarning[] {
  const warnings: StartupWarning[] = [];
  const me = guild.members.me;

  if (!me) {
    warnings.push({ code: "NO_BOT_MEMBER", message: "Bot member object not cached yet." });
    return warnings;
  }

  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    warnings.push({ code: "NO_MANAGE_CHANNELS", message: "WARNING: Bot cannot ManageChannels." });
  }
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    warnings.push({ code: "NO_MANAGE_ROLES", message: "WARNING: Bot cannot ManageRoles." });
  }

  if (opts.categoryId) {
    const category = guild.channels.cache.get(opts.categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
      warnings.push({
        code: "BAD_CATEGORY",
        message: "WARNING: Private category does not exist or is not a category.",
      });
    } else {
      // Guild-wide permission is not enough: category overwrites can deny the bot.
      const inCategory = me.permissionsIn(category);
      if (!inCategory.has(PermissionFlagsBits.ManageChannels)) {
        warnings.push({
          code: "NO_MANAGE_CHANNELS_IN_CATEGORY",
          message:
            "WARNING: Bot lacks Manage Channels inside the private category (category ⚙ → Permissions may deny the bot role).",
        });
      }
      if (!inCategory.has(PermissionFlagsBits.ViewChannel)) {
        warnings.push({
          code: "NO_VIEW_IN_CATEGORY",
          message: "WARNING: Bot cannot view the private category.",
        });
      }
      // Discord rejects managing overwrites involving roles above the bot.
      const botTop = me.roles.highest.position;
      for (const roleId of [...opts.staffRoleIds, ...opts.triggerRoleIds]) {
        const role = guild.roles.cache.get(roleId);
        if (role && botTop <= role.position) {
          warnings.push({
            code: "ROLE_ABOVE_BOT",
            message: `WARNING: Role @${role.name} is above the bot's role — drag the bot role higher in Server Settings → Roles.`,
          });
        }
      }
    }
  } else {
    warnings.push({ code: "NO_CATEGORY", message: "WARNING: No private category configured." });
  }

  for (const roleId of [...opts.staffRoleIds, ...opts.triggerRoleIds]) {
    if (!guild.roles.cache.has(roleId)) {
      warnings.push({
        code: "MISSING_ROLE",
        message: `WARNING: Configured role ${roleId} no longer exists.`,
      });
    }
  }

  return warnings;
}

export function memberHasRole(member: GuildMember, roleId: string): boolean {
  return member.roles.cache.has(roleId);
}

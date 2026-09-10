import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import { findActiveRoom, listActiveRooms } from "../database/repositories/roomRepository.js";
import { getGuildSetup } from "../services/configurationService.js";
import {
  closeRoom,
  deleteRoom,
  ensureRoom,
  renameRoom,
  reopenRoom,
  syncRoom,
} from "../services/privateRoomService.js";
import { isStaff } from "../services/roleService.js";
import { toUserMessage } from "../utils/errors.js";

export const roomData = new SlashCommandBuilder()
  .setName("room")
  .setDescription("Manage private student rooms")
  .addSubcommand((s) =>
    s.setName("create").setDescription("Create a private room for a user")
      .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName("delete").setDescription("Delete a user's private room (requires confirmation)")
      .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true))
      .addBooleanOption((o) => o.setName("confirm").setDescription("Confirm deletion").setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName("close").setDescription("Close a user's room (preserve history)")
      .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName("reopen").setDescription("Reopen a closed room")
      .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName("rename").setDescription("Rename a user's room")
      .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true))
      .addStringOption((o) => o.setName("name").setDescription("New name").setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName("info").setDescription("Show info about a user's room")
      .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName("sync").setDescription("Repair a user's room")
      .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true)),
  )
  .addSubcommand((s) =>
    s.setName("list").setDescription("List active rooms")
      .addIntegerOption((o) => o.setName("page").setDescription("Page number (25 per page)").setMinValue(1)),
  );

async function requireStaff(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild) return false;
  const member = interaction.member as GuildMember | null;
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (member.permissions.has(PermissionFlagsBits.ManageChannels)) return true;
  const { staffRoleIds } = await getGuildSetup(interaction.guild.id);
  return isStaff(member, staffRoleIds);
}

export async function executeRoom(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }
  if (!(await requireStaff(interaction))) {
    await interaction.reply({ content: "You don't have permission to manage rooms.", ephemeral: true });
    return;
  }

  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  try {
    if (sub === "list") {
      const page = interaction.options.getInteger("page") ?? 1;
      const rooms = await listActiveRooms(guild.id);
      const perPage = 25;
      const slice = rooms.slice((page - 1) * perPage, page * perPage);
      const totalPages = Math.max(1, Math.ceil(rooms.length / perPage));
      const lines = slice.map((r) => `<@${r.discordUserId}> — <#${r.channelId}> (\`${r.status}\`)`);
      await interaction.reply({
        ephemeral: true,
        content: `**Active rooms** (page ${page}/${totalPages}, ${rooms.length} total)\n${lines.join("\n") || "None."}`,
      });
      return;
    }

    const user = interaction.options.getUser("user", true);
    const target = await guild.members.fetch(user.id).catch(() => null);

    switch (sub) {
      case "create": {
        if (!target) {
          await interaction.reply({ content: "User is not in this server.", ephemeral: true });
          return;
        }
        const result = await ensureRoom(guild, target, { actorUserId: interaction.user.id });
        await interaction.reply({
          content:
            result.outcome === "created"
              ? `Private room created for ${user}.`
              : `${user} already has an active private room: <#${result.channelId}>.`,
        });
        break;
      }
      case "close": {
        const channel = await closeRoom(guild, user.id, interaction.user.id);
        await interaction.reply({ content: `Private room closed for ${user}: <#${channel.id}>.` });
        break;
      }
      case "reopen": {
        const channel = await reopenRoom(guild, user.id, interaction.user.id);
        await interaction.reply({ content: `Private room reopened for ${user}: <#${channel.id}>.` });
        break;
      }
      case "delete": {
        const confirm = interaction.options.getBoolean("confirm", true);
        await deleteRoom(guild, user.id, { actorUserId: interaction.user.id, confirmed: confirm });
        await interaction.reply({ content: `Private room deleted for ${user}.` });
        break;
      }
      case "rename": {
        const name = interaction.options.getString("name", true);
        const channel = await renameRoom(guild, user.id, name, interaction.user.id);
        await interaction.reply({ content: `Room renamed to <#${channel.id}>.` });
        break;
      }
      case "info": {
        const room = await findActiveRoom(guild.id, user.id);
        if (!room) {
          await interaction.reply({ content: `${user} has no active private room.`, ephemeral: true });
          return;
        }
        await interaction.reply({
          ephemeral: true,
          content:
            `**Room info for ${user}**\nDiscord ID: \`${room.discordUserId}\`\n` +
            `Channel: <#${room.channelId}>\nStatus: \`${room.status}\`\nCreated: ${room.createdAt.toISOString()}`,
        });
        break;
      }
      case "sync": {
        const result = await syncRoom(guild, user.id);
        await interaction.reply({ content: `Sync result for ${user}: \`${result.outcome}\`.`, ephemeral: true });
        break;
      }
      default:
        await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
    }
  } catch (err) {
    await interaction.reply({ content: toUserMessage(err, "Room command failed"), ephemeral: true });
  }
}

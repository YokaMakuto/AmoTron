import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import {
  addStaff,
  addTrigger,
  getGuildSetup,
  removeStaff,
  removeTrigger,
  setCategory,
  setLogChannel,
  setRemovalAction,
} from "../services/configurationService.js";
import { setDailyChannel, setDailyEnabled, setDailyTime } from "../services/dailyService.js";
import { syncAllRooms } from "../services/privateRoomService.js";
import { REMOVAL_ACTIONS } from "../types/index.js";
import { toUserMessage } from "../utils/errors.js";

export const configData = new SlashCommandBuilder()
  .setName("config")
  .setDescription("Manage AMO bot configuration (administrators only)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) => s.setName("show").setDescription("Show current configuration"))
  .addSubcommand((s) =>
    s
      .setName("trigger-role-add")
      .setDescription("Add a trigger role")
      .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("trigger-role-remove")
      .setDescription("Remove a trigger role")
      .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("staff-role-add")
      .setDescription("Add a staff role")
      .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("staff-role-remove")
      .setDescription("Remove a staff role")
      .addRoleOption((o) => o.setName("role").setDescription("Role").setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("category")
      .setDescription("Set the private-rooms category")
      .addChannelOption((o) =>
        o.setName("category").setDescription("Category").addChannelTypes(ChannelType.GuildCategory).setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("removal-action")
      .setDescription("What happens when a user loses all trigger roles")
      .addStringOption((o) =>
        o
          .setName("action")
          .setDescription("Removal action")
          .setRequired(true)
          .addChoices(...REMOVAL_ACTIONS.map((a) => ({ name: a, value: a }))),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("log-channel")
      .setDescription("Set the Discord log channel")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Log channel").addChannelTypes(ChannelType.GuildText).setRequired(true),
      ),
  )
  .addSubcommand((s) => s.setName("sync-all").setDescription("Repair permissions on all active rooms"))
  .addSubcommand((s) =>
    s
      .setName("daily-channel")
      .setDescription("Set the daily-problem channel")
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Daily channel").addChannelTypes(ChannelType.GuildText).setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("daily-time")
      .setDescription("Daily posting time in UTC (HH:MM)")
      .addStringOption((o) => o.setName("time").setDescription("e.g. 07:00").setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("daily-enable")
      .setDescription("Enable or disable daily problems")
      .addBooleanOption((o) => o.setName("enabled").setDescription("Enable?").setRequired(true)),
  );

export async function executeConfig(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }
  const guildId = interaction.guild.id;
  const sub = interaction.options.getSubcommand();
  try {
    switch (sub) {
      case "show": {
        const { config, triggerRoleIds, staffRoleIds } = await getGuildSetup(guildId);
        await interaction.reply({
          ephemeral: true,
          content:
            `**Config**\nCategory: ${config.privateCategoryId ? `<#${config.privateCategoryId}>` : "—"}\n` +
            `Log channel: ${config.logChannelId ? `<#${config.logChannelId}>` : "—"}\n` +
            `Removal action: \`${config.removalAction}\`\n` +
            `Trigger roles: ${triggerRoleIds.map((r) => `<@&${r}>`).join(" ") || "—"}\n` +
            `Staff roles: ${staffRoleIds.map((r) => `<@&${r}>`).join(" ") || "—"}\n` +
            `Daily: ${config.dailyEnabled ? "on" : "off"} in ${config.dailyChannelId ? `<#${config.dailyChannelId}>` : "—"} at \`${config.dailyTimeUtc}\` UTC`,
        });
        break;
      }
      case "trigger-role-add": {
        const role = interaction.options.getRole("role", true);
        if (!interaction.guild.roles.cache.has(role.id)) {
          await interaction.reply({ content: "That role does not exist in this server.", ephemeral: true });
          return;
        }
        await addTrigger(guildId, role.id, interaction.user.id);
        await interaction.reply({ content: `${role} added to trigger roles.`, ephemeral: true });
        break;
      }
      case "trigger-role-remove": {
        const role = interaction.options.getRole("role", true);
        await removeTrigger(guildId, role.id, interaction.user.id);
        await interaction.reply({ content: `${role} removed from trigger roles.`, ephemeral: true });
        break;
      }
      case "staff-role-add": {
        const role = interaction.options.getRole("role", true);
        if (!interaction.guild.roles.cache.has(role.id)) {
          await interaction.reply({ content: "That role does not exist in this server.", ephemeral: true });
          return;
        }
        await addStaff(guildId, role.id, interaction.user.id);
        await interaction.reply({ content: `${role} added as staff. Run \`/config sync-all\` to update existing rooms.`, ephemeral: true });
        break;
      }
      case "staff-role-remove": {
        const role = interaction.options.getRole("role", true);
        await removeStaff(guildId, role.id, interaction.user.id);
        await interaction.reply({ content: `${role} removed from staff.`, ephemeral: true });
        break;
      }
      case "category": {
        const channel = interaction.options.getChannel("category", true);
        await setCategory(guildId, channel.id, interaction.user.id);
        await interaction.reply({ content: `Private category set to <#${channel.id}>.`, ephemeral: true });
        break;
      }
      case "removal-action": {
        const action = interaction.options.getString("action", true);
        await setRemovalAction(guildId, action, interaction.user.id);
        await interaction.reply({ content: `Removal action set to \`${action}\`.`, ephemeral: true });
        break;
      }
      case "log-channel": {
        const channel = interaction.options.getChannel("channel", true);
        await setLogChannel(guildId, channel.id, interaction.user.id);
        await interaction.reply({ content: `Log channel set to <#${channel.id}>.`, ephemeral: true });
        break;
      }
      case "sync-all": {
        await interaction.deferReply({ ephemeral: true });
        const { synced, missing, failed } = await syncAllRooms(interaction.guild);
        await interaction.editReply(
          `Synced ${synced} rooms, marked ${missing} missing as DELETED, ${failed} failed.` +
            (failed > 0
              ? " Check logs / bot role position (Server Settings → Roles: bot role must be above staff roles) and Manage Channels in the category."
              : ""),
        );
        break;
      }
      case "daily-channel": {
        const channel = interaction.options.getChannel("channel", true);
        await setDailyChannel(guildId, channel.id, interaction.user.id);
        await interaction.reply({ content: `Daily problems will post in <#${channel.id}>.`, ephemeral: true });
        break;
      }
      case "daily-time": {
        const time = interaction.options.getString("time", true);
        await setDailyTime(guildId, time, interaction.user.id);
        await interaction.reply({ content: `Daily posting time set to \`${time}\` UTC.`, ephemeral: true });
        break;
      }
      case "daily-enable": {
        const enabled = interaction.options.getBoolean("enabled", true);
        await setDailyEnabled(guildId, enabled, interaction.user.id);
        await interaction.reply({
          content: enabled
            ? "Daily problems enabled. Make sure a daily channel is set (`/config daily-channel`)."
            : "Daily problems disabled.",
          ephemeral: true,
        });
        break;
      }
      default:
        await interaction.reply({ content: "Unknown subcommand.", ephemeral: true });
    }
  } catch (err) {
    const msg = toUserMessage(err, "Config command failed");
    if (interaction.deferred) await interaction.editReply(msg);
    else await interaction.reply({ content: msg, ephemeral: true });
  }
}

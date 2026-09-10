import {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { setCategory, getGuildSetup, addTrigger, addStaff } from "../services/configurationService.js";
import { listActiveRooms } from "../database/repositories/roomRepository.js";
import { toUserMessage } from "../utils/errors.js";

export const setupData = new SlashCommandBuilder()
  .setName("setup")
  .setDescription("Initial AMO bot setup (administrators only)")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) =>
    s
      .setName("category")
      .setDescription("Set the private-rooms category")
      .addChannelOption((o) =>
        o.setName("category").setDescription("Category channel").addChannelTypes(ChannelType.GuildCategory).setRequired(true),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName("trigger-role")
      .setDescription("Add a private-room trigger role")
      .addRoleOption((o) => o.setName("role").setDescription("Trigger role").setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName("staff-role")
      .setDescription("Add a staff role that can see all rooms")
      .addRoleOption((o) => o.setName("role").setDescription("Staff role").setRequired(true)),
  )
  .addSubcommand((s) => s.setName("status").setDescription("Show current configuration"));

export async function executeSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }
  const sub = interaction.options.getSubcommand();
  try {
    if (sub === "category") {
      const channel = interaction.options.getChannel("category", true);
      await setCategory(interaction.guild.id, channel.id, interaction.user.id);
      await interaction.reply({ content: `Private category set to <#${channel.id}>.`, ephemeral: true });
    } else if (sub === "trigger-role") {
      const role = interaction.options.getRole("role", true);
      await addTrigger(interaction.guild.id, role.id, interaction.user.id);
      await interaction.reply({ content: `${role} has been added to the private-room trigger roles.`, ephemeral: true });
    } else if (sub === "staff-role") {
      const role = interaction.options.getRole("role", true);
      await addStaff(interaction.guild.id, role.id, interaction.user.id);
      await interaction.reply({ content: `${role} has been added as a staff role.`, ephemeral: true });
    } else {
      const { config, triggerRoleIds, staffRoleIds } = await getGuildSetup(interaction.guild.id);
      const rooms = await listActiveRooms(interaction.guild.id);
      await interaction.reply({
        ephemeral: true,
        content:
          `**Config**\nCategory: ${config.privateCategoryId ? `<#${config.privateCategoryId}>` : "—"}\n` +
          `Removal action: \`${config.removalAction}\`\n` +
          `Trigger roles: ${triggerRoleIds.map((r) => `<@&${r}>`).join(" ") || "—"}\n` +
          `Staff roles: ${staffRoleIds.map((r) => `<@&${r}>`).join(" ") || "—"}\n` +
          `Active rooms: ${rooms.length}`,
      });
    }
  } catch (err) {
    await interaction.reply({ content: toUserMessage(err, "Setup failed"), ephemeral: true });
  }
}

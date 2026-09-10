import {
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { closeRoom } from "../services/privateRoomService.js";
import { toUserMessage } from "../utils/errors.js";

export const closeData = new SlashCommandBuilder()
  .setName("close")
  .setDescription("Close a user's private room (alias for /room close)")
  .addUserOption((o) => o.setName("user").setDescription("Target user").setRequired(true));

export async function executeClose(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "This command only works in a server.", ephemeral: true });
    return;
  }
  try {
    const user = interaction.options.getUser("user", true);
    const channel = await closeRoom(interaction.guild, user.id, interaction.user.id);
    await interaction.reply({ content: `Private room closed for ${user}: <#${channel.id}>.` });
  } catch (err) {
    await interaction.reply({ content: toUserMessage(err, "Close failed"), ephemeral: true });
  }
}

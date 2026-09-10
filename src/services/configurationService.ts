import {
  addStaffRole,
  addTriggerRole,
  ensureGuildConfig,
  getGuildConfig,
  listStaffRoles,
  listTriggerRoles,
  removeStaffRole,
  removeTriggerRole,
  setGuildConfig,
} from "../database/repositories/configRepository.js";
import { writeAudit } from "../database/repositories/auditRepository.js";
import { isRemovalAction, type RemovalAction } from "../types/index.js";
import { BotError } from "../utils/errors.js";

export async function getGuildSetup(guildId: string) {
  const [config, triggerRoles, staffRoles] = await Promise.all([
    ensureGuildConfig(guildId),
    listTriggerRoles(guildId),
    listStaffRoles(guildId),
  ]);
  return {
    config,
    triggerRoleIds: triggerRoles.map((r) => r.roleId),
    staffRoleIds: staffRoles.map((r) => r.roleId),
  };
}

export async function getRemovalAction(guildId: string): Promise<RemovalAction> {
  const config = await getGuildConfig(guildId);
  if (config && isRemovalAction(config.removalAction)) return config.removalAction;
  return "KEEP_CHANNEL";
}

export async function setCategory(guildId: string, categoryId: string, actorUserId?: string) {
  const config = await setGuildConfig(guildId, { privateCategoryId: categoryId });
  await writeAudit({
    guildId,
    action: "CONFIG_CATEGORY_SET",
    actorUserId,
    metadata: { categoryId },
  });
  return config;
}

export async function setLogChannel(guildId: string, channelId: string, actorUserId?: string) {
  const config = await setGuildConfig(guildId, { logChannelId: channelId });
  await writeAudit({
    guildId,
    action: "CONFIG_LOG_CHANNEL_SET",
    actorUserId,
    metadata: { channelId },
  });
  return config;
}

export async function setRemovalAction(guildId: string, action: string, actorUserId?: string) {
  if (!isRemovalAction(action)) throw new BotError("BAD_ACTION", `Unknown removal action: ${action}`);
  const config = await setGuildConfig(guildId, { removalAction: action });
  await writeAudit({ guildId, action: "CONFIG_REMOVAL_ACTION_SET", actorUserId, metadata: { action } });
  return config;
}

export async function addTrigger(guildId: string, roleId: string, actorUserId?: string) {
  const row = await addTriggerRole(guildId, roleId);
  await writeAudit({ guildId, action: "CONFIG_TRIGGER_ROLE_ADDED", actorUserId, roleId });
  return row;
}

export async function removeTrigger(guildId: string, roleId: string, actorUserId?: string) {
  await removeTriggerRole(guildId, roleId);
  await writeAudit({ guildId, action: "CONFIG_TRIGGER_ROLE_REMOVED", actorUserId, roleId });
}

export async function addStaff(guildId: string, roleId: string, actorUserId?: string) {
  const row = await addStaffRole(guildId, roleId);
  await writeAudit({ guildId, action: "CONFIG_STAFF_ROLE_ADDED", actorUserId, roleId });
  return row;
}

export async function removeStaff(guildId: string, roleId: string, actorUserId?: string) {
  await removeStaffRole(guildId, roleId);
  await writeAudit({ guildId, action: "CONFIG_STAFF_ROLE_REMOVED", actorUserId, roleId });
}

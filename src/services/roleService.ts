import type { GuildMember } from "discord.js";

// Pure role-diff logic kept free of DB/Discord I/O so it is unit-testable.

export function toRoleSet(member: Pick<GuildMember, "roles">): Set<string> {
  return new Set(member.roles.cache.keys());
}

export function hasAnyRole(member: Pick<GuildMember, "roles">, roleIds: string[]): boolean {
  return roleIds.some((id) => member.roles.cache.has(id));
}

export function hasAnyTriggerRole(
  member: Pick<GuildMember, "roles">,
  triggerRoleIds: string[],
): boolean {
  return hasAnyRole(member, triggerRoleIds);
}

export function isStaff(member: Pick<GuildMember, "roles">, staffRoleIds: string[]): boolean {
  return hasAnyRole(member, staffRoleIds);
}

/** Roles present in newMember but absent in oldMember, restricted to trigger roles. */
export function getNewlyAddedTriggerRoles(
  oldMember: Pick<GuildMember, "roles">,
  newMember: Pick<GuildMember, "roles">,
  triggerRoleIds: string[],
): string[] {
  return triggerRoleIds.filter(
    (id) => !oldMember.roles.cache.has(id) && newMember.roles.cache.has(id),
  );
}

/** Trigger roles present before but absent after. */
export function getRemovedTriggerRoles(
  oldMember: Pick<GuildMember, "roles">,
  newMember: Pick<GuildMember, "roles">,
  triggerRoleIds: string[],
): string[] {
  return triggerRoleIds.filter(
    (id) => oldMember.roles.cache.has(id) && !newMember.roles.cache.has(id),
  );
}

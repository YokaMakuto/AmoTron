import { describe, expect, it } from "vitest";
import { PermissionFlagsBits } from "discord.js";
import { buildClosedOverwrites, buildPrivateOverwrites } from "../src/utils/permissions";

describe("permissions", () => {
  it("denies @everyone and allows owner + all staff roles", () => {
    const overwrites = buildPrivateOverwrites({
      guildEveryoneId: "everyone",
      ownerUserId: "owner",
      staffRoleIds: ["s1", "s2", "s3"],
    });
    // everyone + owner + 3 staff
    expect(overwrites).toHaveLength(5);

    const everyone = overwrites[0] as { deny: unknown };
    expect(everyone.deny).toContain(PermissionFlagsBits.ViewChannel);

    const owner = overwrites[1] as { allow: unknown[] };
    expect(owner.allow).toContain(PermissionFlagsBits.SendMessages);
  });

  it("closed rooms deny SendMessages for the owner but keep read access", () => {
    const overwrites = buildClosedOverwrites({
      guildEveryoneId: "everyone",
      ownerUserId: "owner",
      staffRoleIds: ["s1"],
    });
    const owner = overwrites[1] as { allow: unknown[]; deny: unknown[] };
    expect(owner.allow).toContain(PermissionFlagsBits.ViewChannel);
    expect(owner.deny).toContain(PermissionFlagsBits.SendMessages);
  });

  it("grants the new staff roles access in both open and closed rooms", () => {
    const staffRoleIds = ["1541005855263162429", "1541005855263162432"];
    const open = buildPrivateOverwrites({
      guildEveryoneId: "everyone",
      ownerUserId: "owner",
      staffRoleIds,
    });
    for (const staffRoleId of staffRoleIds) {
      const openStaff = open.find((o) => (o as { id: string }).id === staffRoleId) as {
        allow: unknown[];
      };
      expect(openStaff).toBeDefined();
      expect(openStaff.allow).toContain(PermissionFlagsBits.ViewChannel);
      expect(openStaff.allow).toContain(PermissionFlagsBits.SendMessages);
      expect(openStaff.allow).toContain(PermissionFlagsBits.ReadMessageHistory);
    }

    const closed = buildClosedOverwrites({
      guildEveryoneId: "everyone",
      ownerUserId: "owner",
      staffRoleIds,
    });
    for (const staffRoleId of staffRoleIds) {
      const closedStaff = closed.find((o) => (o as { id: string }).id === staffRoleId) as {
        allow: unknown[];
      };
      expect(closedStaff).toBeDefined();
      expect(closedStaff.allow).toContain(PermissionFlagsBits.ViewChannel);
      expect(closedStaff.allow).toContain(PermissionFlagsBits.SendMessages);
      expect(closedStaff.allow).toContain(PermissionFlagsBits.ReadMessageHistory);
    }
  });
});

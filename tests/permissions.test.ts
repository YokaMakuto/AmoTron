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
});

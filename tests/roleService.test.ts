import { describe, expect, it } from "vitest";
import {
  getNewlyAddedTriggerRoles,
  getRemovedTriggerRoles,
  hasAnyTriggerRole,
  isStaff,
} from "../src/services/roleService";

// Minimal GuildMember stub: only roles.cache is consumed by roleService.
function memberWithRoles(roleIds: string[]) {
  return { roles: { cache: new Map(roleIds.map((id) => [id, { id }])) } } as never;
}

const TRIGGERS = ["t1", "t2", "t3"];
const STAFF = ["s1", "s2"];

describe("roleService", () => {
  it("detects a newly added trigger role (absent before, present after)", () => {
    const added = getNewlyAddedTriggerRoles(memberWithRoles([]), memberWithRoles(["t1"]), TRIGGERS);
    expect(added).toEqual(["t1"]);
  });

  it("ignores unrelated roles and already-present roles", () => {
    const added = getNewlyAddedTriggerRoles(
      memberWithRoles(["t1"]),
      memberWithRoles(["t1", "other"]),
      TRIGGERS,
    );
    expect(added).toEqual([]);
  });

  it("detects multiple trigger roles added at once", () => {
    const added = getNewlyAddedTriggerRoles(memberWithRoles([]), memberWithRoles(["t1", "t2"]), TRIGGERS);
    expect(added).toEqual(["t1", "t2"]);
  });

  it("detects removed trigger roles", () => {
    const removed = getRemovedTriggerRoles(
      memberWithRoles(["t1", "t2"]),
      memberWithRoles(["t2"]),
      TRIGGERS,
    );
    expect(removed).toEqual(["t1"]);
  });

  it("hasAnyTriggerRole is true when any trigger present", () => {
    expect(hasAnyTriggerRole(memberWithRoles(["t2"]), TRIGGERS)).toBe(true);
    expect(hasAnyTriggerRole(memberWithRoles(["other"]), TRIGGERS)).toBe(false);
  });

  it("supports multiple staff roles", () => {
    expect(isStaff(memberWithRoles(["s2"]), STAFF)).toBe(true);
    expect(isStaff(memberWithRoles(["nobody"]), STAFF)).toBe(false);
  });
});

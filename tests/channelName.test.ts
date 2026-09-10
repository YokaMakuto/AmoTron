import { describe, expect, it } from "vitest";
import { buildRoomTopic, parseRoomTopic, sanitizeChannelName } from "../src/utils/channelName";

describe("channelName", () => {
  it("sanitizes usernames into safe channel names", () => {
    expect(sanitizeChannelName("Assil")).toBe("assil");
    expect(sanitizeChannelName("Student Assil!")).toBe("student-assil");
    expect(sanitizeChannelName("---")).toBe("user");
  });

  it("respects Discord length limits", () => {
    expect(sanitizeChannelName("a".repeat(500)).length).toBeLessThanOrEqual(90);
  });

  it("round-trips the recovery topic", () => {
    const topic = buildRoomTopic("123456789012345678");
    expect(topic).toBe("private-room:user:123456789012345678");
    expect(parseRoomTopic(topic)).toBe("123456789012345678");
    expect(parseRoomTopic("something else")).toBeNull();
    expect(parseRoomTopic(null)).toBeNull();
  });
});

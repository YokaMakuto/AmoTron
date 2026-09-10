import { describe, expect, it } from "vitest";
import {
  alreadyPostedToday,
  chunkText,
  formatCardDate,
  isValidDailyTime,
  matchesCompetition,
  matchesTopic,
  parseTopics,
  shortTopics,
  shouldPostNow,
  splitForDiscord,
} from "../src/services/dailyService.js";

describe("daily pure helpers", () => {
  it("parseTopics handles JSON, empty, and garbage", () => {
    expect(parseTopics(JSON.stringify(["a", "b"]))).toEqual(["a", "b"]);
    expect(parseTopics(null)).toEqual([]);
    expect(parseTopics("not-json")).toEqual([]);
  });

  it("shortTopics uses last taxonomy segment", () => {
    const t = ["Geometry > Plane Geometry > Circles > Tangents", "Algebra > Polynomials"];
    expect(shortTopics(t)).toContain("Tangents");
    expect(shortTopics([])).toBe("General");
  });

  it("splitForDiscord flags oversized markdown for file fallback", () => {
    expect(splitForDiscord("short").needsFile).toBe(false);
    const long = "x".repeat(4000);
    const res = splitForDiscord(long);
    expect(res.needsFile).toBe(true);
    expect(res.preview.length).toBeLessThanOrEqual(3600);
  });

  it("isValidDailyTime accepts HH:MM UTC only", () => {
    expect(isValidDailyTime("07:00")).toBe(true);
    expect(isValidDailyTime("23:59")).toBe(true);
    expect(isValidDailyTime("24:00")).toBe(false);
    expect(isValidDailyTime("7:00")).toBe(false);
    expect(isValidDailyTime("nope")).toBe(false);
  });

  it("alreadyPostedToday compares UTC dates", () => {
    const now = new Date("2026-09-10T08:00:00Z");
    expect(alreadyPostedToday(new Date("2026-09-10T07:00:00Z"), now)).toBe(true);
    expect(alreadyPostedToday(new Date("2026-09-09T23:00:00Z"), now)).toBe(false);
    expect(alreadyPostedToday(null, now)).toBe(false);
  });

  it("matchesTopic is case-insensitive on any topic path", () => {
    const raw = JSON.stringify(["Geometry > Plane Geometry > Circles > Tangents", "Algebra > Polynomials"]);
    expect(matchesTopic(raw, "geometry")).toBe(true);
    expect(matchesTopic(raw, "TANGENTS")).toBe(true);
    expect(matchesTopic(raw, "number theory")).toBe(false);
    expect(matchesTopic(raw, "  ")).toBe(false);
    expect(matchesTopic(null, "geometry")).toBe(false);
  });

  it("matchesCompetition is case-insensitive substring", () => {
    expect(matchesCompetition("IMO 2006 Shortlisted Problems", "imo")).toBe(true);
    expect(matchesCompetition("IMO 2006 Shortlisted Problems", "SHORTLIST")).toBe(true);
    expect(matchesCompetition("Baltic Way 1993", "imo")).toBe(false);
    expect(matchesCompetition(null, "imo")).toBe(false);
    expect(matchesCompetition("APMO", "")).toBe(false);
  });

  it("formatCardDate uses UTC month/day", () => {
    expect(formatCardDate(new Date("2026-09-10T01:00:00Z"))).toBe("Sep 10");
    expect(formatCardDate(new Date("2026-01-05T23:59:59Z"))).toBe("Jan 5");
  });

  it("shouldPostNow respects time and once-per-day", () => {
    const now = new Date("2026-09-10T08:00:00Z");
    expect(shouldPostNow("07:00", null, now)).toBe(true);
    expect(shouldPostNow("09:00", null, now)).toBe(false);
    expect(shouldPostNow("07:00", new Date("2026-09-10T07:05:00Z"), now)).toBe(false);
  });

  it("chunkText keeps short text whole and splits long text under the cap", () => {
    expect(chunkText("short")).toEqual(["short"]);
    const long = `${"a".repeat(1900)}\n\n${"b".repeat(500)}`;
    const chunks = chunkText(long);
    expect(chunks.length).toBe(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1950);
    expect(chunks.join("\n\n")).toBe(long);
  });
});

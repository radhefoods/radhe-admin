import { describe, expect, it } from "vitest";
import {
  berlinDay,
  berlinOffsetMinutes,
  berlinToDate,
  berlinToIso,
  formatDate,
  formatDateTime,
  formatDay,
  formatDeadline,
  formatDuration,
  formatRelative,
  formatShortDateTime,
  toBerlinIso,
  toLocalInput,
} from "./dates";

describe("printing moments in German time", () => {
  it("prints summer time two hours ahead of UTC", () => {
    expect(formatDateTime("2026-09-28T10:15:00.000Z")).toBe(
      "28 Sep 2026, 12:15",
    );
  });

  it("prints winter time one hour ahead of UTC", () => {
    expect(formatDateTime("2026-12-01T10:15:00.000Z")).toBe(
      "1 Dec 2026, 11:15",
    );
  });

  it("moves to the next German day late in the UTC evening", () => {
    // The API's example of a deadline: the end of 3 October in Germany.
    expect(formatDateTime("2026-10-03T21:59:59.000Z")).toBe(
      "3 Oct 2026, 23:59",
    );
    expect(formatDate("2026-10-03T22:30:00.000Z")).toBe("4 Oct 2026");
  });

  it("prints a deadline with its weekday", () => {
    expect(formatDeadline("2026-10-09T21:59:59.000Z")).toBe("Fri 9 Oct, 23:59");
  });

  it("shortens today and this year", () => {
    const now = new Date("2026-10-04T18:00:00.000Z");
    expect(formatShortDateTime("2026-10-04T08:05:00.000Z", now)).toBe(
      "Today, 10:05",
    );
    expect(formatShortDateTime("2026-09-28T10:15:00.000Z", now)).toBe(
      "28 Sep, 12:15",
    );
    expect(formatShortDateTime("2025-09-28T10:15:00.000Z", now)).toBe(
      "28 Sep 2025, 12:15",
    );
  });

  it("prints a dash for a missing value", () => {
    expect(formatDateTime(null)).toBe("—");
    expect(formatDate(undefined)).toBe("—");
    expect(formatDateTime("not a date")).toBe("—");
  });
});

describe("calendar days", () => {
  it("prints a day as written", () => {
    expect(formatDay("2026-10-05")).toBe("5 Oct 2026");
    expect(formatDay("2026-10-05", { weekday: true })).toBe("Mon 5 Oct 2026");
    expect(formatDay("2026-10-05", { year: false })).toBe("5 Oct");
  });

  it("names the German day of a moment", () => {
    expect(berlinDay("2026-10-03T21:59:59.000Z")).toBe("2026-10-03");
    expect(berlinDay("2026-10-03T22:00:00.000Z")).toBe("2026-10-04");
  });
});

describe("reading German time", () => {
  it("knows the offset of summer and winter", () => {
    expect(berlinOffsetMinutes("2026-07-01T12:00:00Z")).toBe(120);
    expect(berlinOffsetMinutes("2026-01-01T12:00:00Z")).toBe(60);
  });

  it("turns a typed deadline into ISO with the German offset", () => {
    // A typed moment in September, with the summer-time offset.
    expect(berlinToIso("2026-09-26T23:59")).toBe("2026-09-26T23:59:00+02:00");
    expect(berlinToIso("2026-12-18T23:59")).toBe("2026-12-18T23:59:00+01:00");
    expect(berlinToDate("2026-09-26T23:59")?.toISOString()).toBe(
      "2026-09-26T21:59:00.000Z",
    );
  });

  it("handles the night the clocks go forward (29 March 2026)", () => {
    expect(berlinToIso("2026-03-29T01:59")).toBe("2026-03-29T01:59:00+01:00");
    expect(berlinToIso("2026-03-29T03:00")).toBe("2026-03-29T03:00:00+02:00");
    // 02:30 does not exist: it moves forward by the skipped hour.
    expect(berlinToIso("2026-03-29T02:30")).toBe("2026-03-29T03:30:00+02:00");
  });

  it("handles the night the clocks go back (25 October 2026)", () => {
    // 02:30 exists twice: the first one, still summer time, is meant.
    expect(berlinToIso("2026-10-25T02:30")).toBe("2026-10-25T02:30:00+02:00");
    expect(berlinToIso("2026-10-25T03:30")).toBe("2026-10-25T03:30:00+01:00");
    expect(berlinToIso("2026-10-24T23:59")).toBe("2026-10-24T23:59:00+02:00");
  });

  it("refuses what is not a date and time", () => {
    expect(berlinToIso("")).toBeNull();
    expect(berlinToIso("2026-09-26")).toBeNull();
    expect(berlinToIso("2026-13-01T10:00")).toBeNull();
    expect(berlinToIso("2026-09-26T24:00")).toBeNull();
  });

  it("round-trips a moment through the input value", () => {
    for (const iso of [
      "2026-09-26T21:59:00.000Z",
      "2026-01-15T08:30:00.000Z",
      "2026-03-29T01:30:00.000Z",
      "2026-10-25T00:30:00.000Z",
    ]) {
      expect(berlinToDate(toLocalInput(iso))?.toISOString()).toBe(iso);
    }
  });

  it("prints a moment with the German offset", () => {
    expect(toBerlinIso("2026-09-26T21:59:00.000Z")).toBe(
      "2026-09-26T23:59:00+02:00",
    );
  });
});

describe("distances", () => {
  it("prints the two largest units", () => {
    expect(formatDuration(31 * 3600_000)).toBe("1d 7h");
    expect(formatDuration(48 * 3600_000)).toBe("2d");
    expect(formatDuration(200 * 60_000)).toBe("3h 20m");
    expect(formatDuration(12 * 60_000)).toBe("12m");
    expect(formatDuration(20_000)).toBe("under a minute");
  });

  it("says whether a moment lies ahead or behind", () => {
    const now = new Date("2026-10-04T12:00:00.000Z");
    expect(formatRelative("2026-10-05T19:00:00.000Z", now)).toBe("in 1d 7h");
    expect(formatRelative("2026-10-04T09:00:00.000Z", now)).toBe("3h ago");
    expect(formatRelative("2026-10-04T11:59:50.000Z", now)).toBe("just now");
  });
});

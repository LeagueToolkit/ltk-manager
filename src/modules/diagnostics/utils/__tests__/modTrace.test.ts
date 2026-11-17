import { describe, expect, it } from "vitest";

import type { RowReading, TraceRow } from "@/lib/tauri";

import { formatWhen, rowDetail, rowText, traceFix } from "../modTrace";

const NOW = new Date(2026, 10, 17, 21, 0, 0);
/** A time on the day of `NOW`, as the backend sends it. */
const TODAY = new Date(2026, 10, 17, 19, 1, 0).toISOString();

function rows(...readings: RowReading[]): TraceRow[] {
  return readings.map((reading) => ({ state: "pass", ...reading }));
}

describe("formatWhen", () => {
  it("returns the clock for a time on the day of now", () => {
    expect(formatWhen(TODAY, NOW)).toBe("19:01");
  });

  it("returns the date with the clock for another day", () => {
    const yesterday = new Date(2026, 10, 16, 19, 1, 0);

    expect(formatWhen(yesterday.toISOString(), NOW)).toBe(
      yesterday.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }),
    );
  });
});

describe("rowText", () => {
  it("words the enabled row for both answers", () => {
    expect(rowText({ row: "enabled", enabled: true, profile: "Default" })).toBe(
      "Enabled in profile Default",
    );
    expect(rowText({ row: "enabled", enabled: false, profile: "Default" })).toBe(
      "Not enabled in profile Default",
    );
  });

  it("words the health of the mod with the time of the check", () => {
    const checked: RowReading = {
      row: "health",
      check: { health: "repairable", checkedAt: TODAY },
    };

    expect(rowText(checked, NOW)).toBe("Has problems that a repair fixes, checked 19:01");
    expect(rowText({ row: "health", check: null })).toBe("Health not checked");
  });

  it("words the build with the time of the build", () => {
    expect(rowText({ row: "overlay", reading: "built", builtAt: TODAY }, NOW)).toBe(
      "In the overlay, built 19:01",
    );
  });

  it("lists the archives with their count", () => {
    expect(rowText({ row: "archives", archives: ["Aatrox.wad.client"] })).toBe(
      "Patches 1 archive: Aatrox.wad.client",
    );
    expect(rowText({ row: "archives", archives: ["Aatrox.wad.client", "Global.wad.client"] })).toBe(
      "Patches 2 archives: Aatrox.wad.client, Global.wad.client",
    );
    expect(rowText({ row: "archives", archives: [] })).toBe("Patches no game archive");
  });

  it("words an advisory with the sentence of its code", () => {
    expect(rowText({ row: "advisory", code: "layers-unset" })).toBe(
      "No layer is chosen. The base layer alone is used.",
    );
  });

  it("names the champions that were not in the last game", () => {
    const absent = (champions: string[]): RowReading => ({
      row: "last-game",
      reading: "archives-not-loaded",
      champions,
    });

    expect(rowText(absent(["Aatrox"]))).toBe("Aatrox was not in the last game");
    expect(rowText(absent(["Aatrox", "Ahri"]))).toBe("Aatrox, Ahri were not in the last game");
    expect(rowText(absent([]))).toBe("League did not load this mod's archives");
  });

  it("counts the archives of a mod that the last game loaded in part", () => {
    expect(rowText({ row: "last-game", reading: "loaded", loaded: 2, total: 2 })).toBe(
      "The last game loaded this mod",
    );
    expect(rowText({ row: "last-game", reading: "loaded", loaded: 1, total: 2 })).toBe(
      "The last game loaded 1 of the 2 archives of this mod",
    );
  });
});

describe("rowDetail", () => {
  it("returns the sentence of the advisory of a mod that the build left out", () => {
    expect(rowDetail({ row: "overlay", reading: "left-out", advisory: "entry-unreadable" })).toBe(
      "The entry of the mod cannot be read.",
    );
  });

  it("returns the reason of an overlay that was not live, with the code of the patcher", () => {
    expect(
      rowDetail({
        row: "last-game",
        reading: "overlay-not-live",
        outcome: "refused",
        patcherCode: "VRF00000008",
      }),
    ).toBe("The patcher refused the overlay. VRF00000008");
    expect(
      rowDetail({
        row: "last-game",
        reading: "overlay-not-live",
        outcome: "too-late",
        patcherCode: null,
      }),
    ).toBe("League started before the patcher was ready.");
  });

  it("returns the archives that the patcher could not open", () => {
    expect(
      rowDetail({
        row: "last-game",
        reading: "archives-not-served",
        archives: ["Ahri.wad.client"],
      }),
    ).toBe("Ahri.wad.client");
  });

  it("returns null for a row with one line", () => {
    expect(rowDetail({ row: "last-game", reading: "no-game" })).toBeNull();
    expect(rowDetail({ row: "overlay", reading: "built", builtAt: TODAY })).toBeNull();
  });
});

describe("traceFix", () => {
  it("returns the rebuild for a reading that a rebuild fixes", () => {
    const stale = rows(
      { row: "overlay", reading: "stale", builtAt: TODAY },
      { row: "last-game", reading: "no-game" },
    );
    const skipped = rows({
      row: "last-game",
      reading: "archives-not-served",
      archives: ["Ahri.wad.client"],
    });

    expect(traceFix(stale)).toBe("rebuild");
    expect(traceFix(rows({ row: "overlay", reading: "without-mod", builtAt: TODAY }))).toBe(
      "rebuild",
    );
    expect(traceFix(skipped)).toBe("rebuild");
  });

  it("returns the startup settings for a game that the manager did not watch", () => {
    expect(traceFix(rows({ row: "last-game", reading: "unwatched" }))).toBe("autostart");
  });

  it("returns the help for every other trace", () => {
    expect(traceFix([])).toBe("help");
    expect(traceFix(rows({ row: "last-game", reading: "loaded", loaded: 1, total: 1 }))).toBe(
      "help",
    );
    expect(traceFix(rows({ row: "enabled", enabled: false, profile: "Default" }))).toBe("help");
  });
});

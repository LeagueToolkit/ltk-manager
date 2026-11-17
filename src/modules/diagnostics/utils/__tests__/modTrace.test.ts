import { describe, expect, it } from "vitest";

import type { TraceFact, TraceRow } from "@/lib/tauri";

import { factDetail, factText, formatWhen, traceFix } from "../modTrace";

const NOW = new Date(2026, 10, 17, 21, 0, 0);
/** A time on the day of `NOW`, as the backend sends it. */
const TODAY = new Date(2026, 10, 17, 19, 1, 0).toISOString();

function rows(...facts: TraceFact[]): TraceRow[] {
  return facts.map((fact) => ({ state: "pass", fact }));
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

describe("factText", () => {
  it("words the build with the time of the build", () => {
    expect(factText({ kind: "overlay-built", builtAt: TODAY }, NOW)).toBe(
      "In the overlay, built 19:01",
    );
  });

  it("words the health of the mod with the time of the check", () => {
    const fact: TraceFact = { kind: "health", health: "repairable", checkedAt: TODAY };

    expect(factText(fact, NOW)).toBe("Has problems that a repair fixes, checked 19:01");
  });

  it("lists the archives with their count", () => {
    expect(factText({ kind: "archives", archives: ["Aatrox.wad.client"] })).toBe(
      "Patches 1 archive: Aatrox.wad.client",
    );
    expect(
      factText({ kind: "archives", archives: ["Aatrox.wad.client", "Global.wad.client"] }),
    ).toBe("Patches 2 archives: Aatrox.wad.client, Global.wad.client");
  });

  it("words an advisory with the sentence of its code", () => {
    expect(factText({ kind: "advisory", code: "layers-unset" })).toBe(
      "No layer is chosen. The base layer alone is used.",
    );
  });

  it("names the champions that were not in the last game", () => {
    expect(factText({ kind: "game-archives-not-loaded", champions: ["Aatrox"] })).toBe(
      "Aatrox was not in the last game",
    );
    expect(factText({ kind: "game-archives-not-loaded", champions: ["Aatrox", "Ahri"] })).toBe(
      "Aatrox, Ahri were not in the last game",
    );
    expect(factText({ kind: "game-archives-not-loaded", champions: [] })).toBe(
      "League did not load this mod's archives",
    );
  });

  it("counts the archives of a mod that the last game loaded in part", () => {
    expect(factText({ kind: "game-loaded", loaded: 2, total: 2 })).toBe(
      "The last game loaded this mod",
    );
    expect(factText({ kind: "game-loaded", loaded: 1, total: 2 })).toBe(
      "The last game loaded 1 of the 2 archives of this mod",
    );
  });
});

describe("factDetail", () => {
  it("returns the sentence of the advisory of a mod that the build left out", () => {
    expect(factDetail({ kind: "overlay-left-out", advisory: "entry-unreadable" })).toBe(
      "The entry of the mod cannot be read.",
    );
  });

  it("returns the reason of an overlay that was not live, with the code of the patcher", () => {
    expect(
      factDetail({ kind: "game-overlay-not-live", outcome: "refused", patcherCode: "VRF00000008" }),
    ).toBe("The patcher refused the overlay. VRF00000008");
    expect(
      factDetail({ kind: "game-overlay-not-live", outcome: "too-late", patcherCode: null }),
    ).toBe("League started before the patcher was ready.");
  });

  it("returns the archives that the patcher could not open", () => {
    expect(factDetail({ kind: "game-archives-not-served", archives: ["Ahri.wad.client"] })).toBe(
      "Ahri.wad.client",
    );
  });

  it("returns null for a fact with one line", () => {
    expect(factDetail({ kind: "game-none" })).toBeNull();
  });
});

describe("traceFix", () => {
  it("returns the rebuild for a state that a rebuild fixes", () => {
    const stale = rows({ kind: "overlay-stale", builtAt: TODAY }, { kind: "game-none" });

    expect(traceFix(stale)).toBe("rebuild");
    expect(traceFix(rows({ kind: "overlay-without-mod", builtAt: TODAY }))).toBe("rebuild");
  });

  it("returns the startup settings for a game that the manager did not watch", () => {
    expect(traceFix(rows({ kind: "game-unwatched" }))).toBe("autostart");
  });

  it("returns the help for every other trace", () => {
    expect(traceFix([])).toBe("help");
    expect(traceFix(rows({ kind: "game-loaded", loaded: 1, total: 1 }))).toBe("help");
    expect(traceFix(rows({ kind: "not-enabled", profile: "Default" }))).toBe("help");
  });
});

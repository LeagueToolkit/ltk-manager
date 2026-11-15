import { describe, expect, it } from "vitest";

import type { Incident, KnownIssue, Suspect } from "@/lib/tauri";
import { createMockInstalledMod } from "@/test/fixtures";

import { findings, type FindingInputs, isKnownCause, knownIssueFor } from "../findings";

function suspect(modId: string | null, displayName: string): Suspect {
  return {
    modId,
    projectPath: modId === null ? "C:/workshop/project" : null,
    displayName,
    because: "writes Aatrox.wad.client, which holds the path",
    reason: "holds-the-path",
  };
}

function incident(over: { hints?: string[]; suspects?: Suspect[]; kind?: string } = {}): Incident {
  return {
    id: "2026-11-15T14-02-00",
    verdict: {
      kind: over.kind ?? "missing-data",
      title: "Missing Game Data",
      cause: "League failed to read a file.",
      subject: null,
      consequence: "game-stopped",
      titleOverride: null,
      hints: over.hints ?? [],
    },
    suspects: over.suspects ?? [],
  } as unknown as Incident;
}

const issue: KnownIssue = {
  id: "2026-11-patch-16-23",
  verdicts: ["missing-data"],
  message: "Patch 16.23 moved the skin data. Update the manager.",
  url: "https://github.com/LeagueToolkit/ltk-manager/issues/1100",
};

const NOTHING: FindingInputs = { update: null, issues: [], incident: null, mods: [] };

describe("findings", () => {
  it("returns nothing if no update, no incident and no issue is known", () => {
    expect(findings(NOTHING)).toEqual([]);
  });

  it("returns an update with the installed and the latest version", () => {
    const found = findings({
      ...NOTHING,
      update: { version: "1.35.0", currentVersion: "1.34.0" },
    });

    expect(found).toEqual([{ kind: "update", installed: "1.34.0", latest: "1.35.0" }]);
    expect(found.every(isKnownCause)).toBe(true);
  });

  it("returns a known issue that lists the verdict of the incident", () => {
    const other = { ...issue, id: "other", verdicts: ["graphics-fault"] };

    const found = findings({ ...NOTHING, issues: [other, issue], incident: incident() });

    expect(found.map((finding) => finding.kind)).toEqual(["issue", "verdict"]);
    expect(found[0]).toEqual({ kind: "issue", issue });
  });

  it("returns a verdict as a known cause only if it offers a rebuild", () => {
    const [plain] = findings({ ...NOTHING, incident: incident() });
    const [rebuild] = findings({ ...NOTHING, incident: incident({ hints: ["rebuild-overlay"] }) });

    expect(plain).toMatchObject({ kind: "verdict", rebuild: false });
    expect(isKnownCause(plain!)).toBe(false);
    expect(rebuild).toMatchObject({ kind: "verdict", rebuild: true });
    expect(isKnownCause(rebuild!)).toBe(true);
  });

  it("returns the one library mod that the incident names, with the page of its origin", () => {
    const withPage = createMockInstalledMod({
      id: "aatrox",
      origin: {
        source: "Runeforge",
        id: "a",
        version: "1.0.0",
        pageUrl: "https://runeforge.dev/mods/a",
      },
    });
    const one = incident({ suspects: [suspect("aatrox", "Aatrox Justicar")] });

    expect(findings({ ...NOTHING, incident: one, mods: [withPage] }).at(-1)).toEqual({
      kind: "mod",
      name: "Aatrox Justicar",
      pageUrl: "https://runeforge.dev/mods/a",
    });
    // A mod with no recorded origin keeps the row and has no page.
    expect(findings({ ...NOTHING, incident: one }).at(-1)).toEqual({
      kind: "mod",
      name: "Aatrox Justicar",
      pageUrl: null,
    });
  });

  it("returns no mod for two suspects, and none for a workshop project", () => {
    const two = incident({
      suspects: [suspect("aatrox", "Aatrox Justicar"), suspect("rift", "Classic Rift")],
    });
    const project = incident({ suspects: [suspect(null, "My project")] });

    expect(findings({ ...NOTHING, incident: two }).map((finding) => finding.kind)).toEqual([
      "verdict",
    ]);
    expect(findings({ ...NOTHING, incident: project }).map((finding) => finding.kind)).toEqual([
      "verdict",
    ]);
  });

  it("orders the update, the known issue, the verdict and the mod", () => {
    const found = findings({
      update: { version: "1.35.0", currentVersion: "1.34.0" },
      issues: [issue],
      incident: incident({
        hints: ["rebuild-overlay"],
        suspects: [suspect("aatrox", "Aatrox Justicar")],
      }),
      mods: [],
    });

    expect(found.map((finding) => finding.kind)).toEqual(["update", "issue", "verdict", "mod"]);
  });
});

describe("knownIssueFor", () => {
  it("returns null without an incident, and for a verdict that no issue lists", () => {
    expect(knownIssueFor([issue], null)).toBeNull();
    expect(knownIssueFor([issue], incident({ kind: "graphics-fault" }))).toBeNull();
  });

  it("returns the first issue that lists the verdict", () => {
    const later = { ...issue, id: "later" };

    expect(knownIssueFor([issue, later], incident())?.id).toBe("2026-11-patch-16-23");
  });
});

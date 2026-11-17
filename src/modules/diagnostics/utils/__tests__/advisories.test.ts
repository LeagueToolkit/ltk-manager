import { describe, expect, it } from "vitest";

import type { ShownAdvisory } from "@/lib/tauri";

import { advisoriesAbout, advisoriesLabel, subjectName } from "../advisories";

function advisory(over: Partial<ShownAdvisory> = {}): ShownAdvisory {
  return {
    code: "mod-missing",
    tier: null,
    subject: { kind: "mod", id: "aatrox" },
    patcherCode: null,
    source: "build",
    at: "2026-11-15T14:02:00Z",
    muted: false,
    ...over,
  };
}

describe("advisoriesLabel", () => {
  it("counts the mods that the build left out", () => {
    const label = advisoriesLabel([
      advisory(),
      advisory({ code: "entry-unreadable", subject: { kind: "mod", id: "ahri" } }),
      advisory({ code: "layers-unset", subject: { kind: "mod", id: "ashe" } }),
    ]);

    expect(label).toBe("2 mods were not applied");
  });

  it("counts the advisories if the build left out no mod", () => {
    const refused = advisory({ code: "overlay-refused", subject: null });

    expect(advisoriesLabel([refused])).toBe("1 advisory");
    expect(advisoriesLabel([refused, advisory({ code: "layers-unset" })])).toBe("2 advisories");
  });
});

describe("advisoriesAbout", () => {
  const project = advisory({ subject: { kind: "project", path: "X:\\projects\\aatrox" } });
  const all = [
    advisory(),
    advisory({ subject: { kind: "mod", id: "ahri" } }),
    advisory({ code: "overlay-refused", subject: null }),
    advisory({ code: "archive-not-served", subject: { kind: "archive", name: "aatrox" } }),
    project,
  ];

  it("returns the advisories about a mod by its id", () => {
    expect(advisoriesAbout(all, { modId: "aatrox" })).toEqual([advisory()]);
  });

  it("returns the advisories about a project by its path", () => {
    expect(advisoriesAbout(all, { projectPath: "X:\\projects\\aatrox" })).toEqual([project]);
  });

  it("returns nothing for a card with no id and no path", () => {
    expect(advisoriesAbout(all, {})).toEqual([]);
  });
});

describe("subjectName", () => {
  const mods = [{ id: "aatrox", displayName: "Aatrox Justicar" }];

  it("names a mod by its display name, and by its id if the library does not hold it", () => {
    expect(subjectName({ kind: "mod", id: "aatrox" }, mods)).toBe("Aatrox Justicar");
    expect(subjectName({ kind: "mod", id: "gone" }, mods)).toBe("gone");
  });

  it("names a project by the last segment of its path", () => {
    expect(subjectName({ kind: "project", path: "X:\\projects\\aatrox\\" }, mods)).toBe("aatrox");
    expect(subjectName({ kind: "project", path: "/home/me/ahri" }, mods)).toBe("ahri");
  });

  it("names an archive by its name", () => {
    expect(subjectName({ kind: "archive", name: "Ahri.wad.client" }, mods)).toBe("Ahri.wad.client");
  });
});

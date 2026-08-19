import { describe, expect, it } from "vitest";

import type { WorkshopProject } from "@/lib/tauri";

import { isProjectUnconfigured } from "../project";

function project(overrides: Partial<WorkshopProject> = {}): WorkshopProject {
  return {
    path: "C:/projects/my-mod",
    name: "my-mod",
    displayName: "My Mod",
    version: "1.0.0",
    description: "",
    authors: [],
    tags: [],
    champions: [],
    maps: [],
    layers: [],
    thumbnailPath: null,
    lastModified: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("isProjectUnconfigured", () => {
  it("holds for a project straight off the scaffold", () => {
    expect(isProjectUnconfigured(project())).toBe(true);
  });

  it("ignores the display name and version, which creation always fills in", () => {
    expect(isProjectUnconfigured(project({ displayName: "Renamed", version: "2.4.1" }))).toBe(true);
  });

  it("ignores an author row left blank", () => {
    expect(isProjectUnconfigured(project({ authors: [{ name: "  ", role: "Owner" }] }))).toBe(true);
  });

  it("does not hold once a description is written", () => {
    expect(isProjectUnconfigured(project({ description: "A skin" }))).toBe(false);
  });

  it.each([
    ["tags", { tags: ["champion-skin"] }],
    ["champions", { champions: ["Smolder"] }],
    ["maps", { maps: ["summoners-rift"] }],
    ["a named author", { authors: [{ name: "Nyht", role: "Owner" }] }],
  ])("does not hold once %s is set", (_label, overrides) => {
    expect(isProjectUnconfigured(project(overrides))).toBe(false);
  });
});

// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import type { WorkshopProject } from "@/lib/tauri";

import { projectRow } from "../projectRows";

function project(overrides: Partial<WorkshopProject> = {}): WorkshopProject {
  return {
    path: "X:/workshop/charizard-smolder",
    name: "charizard-smolder",
    displayName: "Charizard Smolder",
    version: "1.0.9",
    description: "",
    authors: [{ name: "Crauzer", role: null }],
    tags: [],
    champions: [],
    maps: [],
    layers: [],
    thumbnailPath: null,
    lastModified: "2026-08-21T21:14:02Z",
    location: "workshop",
    lastOpened: null,
    id: "id-charizard-smolder",
    ...overrides,
  };
}

describe("projectRow", () => {
  it("reads as the card does: the title, the authors and the version", () => {
    const row = projectRow(project());

    expect(row.name).toBe("Charizard Smolder");
    expect(row.path).toBe("Crauzer");
    expect(row.trailing).toBe("v1.0.9");
  });

  it("names the project a row that has no author at all", () => {
    expect(projectRow(project({ authors: [] })).path).toBe("Unknown author");
  });

  it("joins every author, so a search reaches the second one", () => {
    const authors = [
      { name: "Crauzer", role: null },
      { name: "Nao", role: null },
    ];

    expect(projectRow(project({ authors })).path).toBe("Crauzer, Nao");
  });

  it("carries the slug as a keyword, because the grid never shows it", () => {
    const row = projectRow(project());

    expect(row.keywords).toBe("charizard-smolder");
    expect(row.name).not.toContain("-");
  });

  it("targets the id the route takes rather than the title", () => {
    expect(projectRow(project()).target).toEqual({
      kind: "project",
      id: "id-charizard-smolder",
    });
  });

  it("keys the row by the id, which is unique across the workshop", () => {
    expect(projectRow(project()).id).toBe("project:id-charizard-smolder");
  });
});

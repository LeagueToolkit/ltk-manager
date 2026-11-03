import { describe, expect, it } from "vitest";

import { createMockInstalledMod } from "@/test/fixtures";

import { arrangedFolderOrder, keptSortOf, sortMods, sortModsByFolder } from "../sorting";

describe("sortMods", () => {
  const modA = createMockInstalledMod({
    id: "a",
    displayName: "Alpha",
    installedAt: "2025-01-01T00:00:00.000Z",
    enabled: true,
  });
  const modB = createMockInstalledMod({
    id: "b",
    displayName: "Bravo",
    installedAt: "2025-03-01T00:00:00.000Z",
    enabled: false,
  });
  const modC = createMockInstalledMod({
    id: "c",
    displayName: "Charlie",
    installedAt: "2025-02-01T00:00:00.000Z",
    enabled: true,
  });

  it("returns mods unchanged for priority sort", () => {
    const result = sortMods([modB, modA, modC], { field: "priority", direction: "desc" });
    expect(result.map((m) => m.id)).toEqual(["b", "a", "c"]);
  });

  it("does not mutate the original array", () => {
    const original = [modB, modA, modC];
    sortMods(original, { field: "name", direction: "asc" });
    expect(original.map((m) => m.id)).toEqual(["b", "a", "c"]);
  });

  it("sorts by name ascending", () => {
    const result = sortMods([modC, modA, modB], { field: "name", direction: "asc" });
    expect(result.map((m) => m.displayName)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("sorts by name descending", () => {
    const result = sortMods([modA, modB, modC], { field: "name", direction: "desc" });
    expect(result.map((m) => m.displayName)).toEqual(["Charlie", "Bravo", "Alpha"]);
  });

  it("sorts by installedAt ascending (oldest first)", () => {
    const result = sortMods([modB, modC, modA], { field: "installedAt", direction: "asc" });
    expect(result.map((m) => m.id)).toEqual(["a", "c", "b"]);
  });

  it("sorts by installedAt descending (newest first)", () => {
    const result = sortMods([modA, modC, modB], { field: "installedAt", direction: "desc" });
    expect(result.map((m) => m.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts by enabled (enabled first, then by name)", () => {
    const result = sortMods([modB, modC, modA], { field: "enabled", direction: "asc" });
    expect(result.map((m) => m.id)).toEqual(["a", "c", "b"]);
  });

  it("returns empty array for empty input", () => {
    const result = sortMods([], { field: "name", direction: "asc" });
    expect(result).toEqual([]);
  });

  it("handles single mod", () => {
    const result = sortMods([modA], { field: "name", direction: "desc" });
    expect(result.map((m) => m.id)).toEqual(["a"]);
  });

  it("sorts by the champions the context files a mod under", () => {
    const derived = createMockInstalledMod({ id: "d", displayName: "Derived", champions: [] });
    const declared = createMockInstalledMod({
      id: "e",
      displayName: "Declared",
      champions: ["Zed"],
    });
    const championsOf = (mod: typeof derived) => (mod.id === "d" ? ["Ahri"] : mod.champions);

    const withContext = sortMods(
      [declared, derived],
      { field: "champion", direction: "asc" },
      {
        championsOf,
      },
    );
    expect(withContext.map((m) => m.id)).toEqual(["d", "e"]);

    const declaredOnly = sortMods([declared, derived], { field: "champion", direction: "asc" });
    expect(declaredOnly.map((m) => m.id)).toEqual(["e", "d"]);
  });
});

describe("keptSortOf", () => {
  it("maps the sorts a folder keeps and refuses the rest", () => {
    expect(keptSortOf({ field: "name", direction: "desc" })).toEqual({
      field: "name",
      direction: "desc",
    });
    expect(keptSortOf({ field: "installedAt", direction: "asc" })).toEqual({
      field: "installedAt",
      direction: "asc",
    });
    expect(keptSortOf({ field: "priority", direction: "desc" })).toBeNull();
    expect(keptSortOf({ field: "health", direction: "desc" })).toBeNull();
  });
});

describe("arrangedFolderOrder", () => {
  const folders = [
    { id: "root", name: "", modIds: [] },
    { id: "f1", name: "Zulu", modIds: [] },
    { id: "f2", name: "Alpha", modIds: [] },
  ];

  it("arranges the user folders by name and keeps root in place", () => {
    const order = arrangedFolderOrder(["root", "f1", "f2"], folders, {
      field: "name",
      direction: "asc",
    });
    expect(order).toEqual(["root", "f2", "f1"]);
  });

  it("keeps the manual order under a sort that does not order folders", () => {
    const order = arrangedFolderOrder(["f1", "root", "f2"], folders, {
      field: "installedAt",
      direction: "desc",
    });
    expect(order).toEqual(["f1", "root", "f2"]);
  });

  it("drops a folder id that no folder carries", () => {
    const order = arrangedFolderOrder(["root", "gone", "f1"], folders, {
      field: "name",
      direction: "asc",
    });
    expect(order).toEqual(["root", "f1"]);
  });
});

describe("sortModsByFolder", () => {
  const modA = createMockInstalledMod({ id: "a", displayName: "Zulu" });
  const modB = createMockInstalledMod({ id: "b", displayName: "Alpha" });
  const modC = createMockInstalledMod({ id: "c", displayName: "Mike" });

  it("returns the same map for priority sort", () => {
    const map = new Map([
      ["root", [modA, modB]],
      ["folder-1", [modC]],
    ]);
    const result = sortModsByFolder(map, { field: "priority", direction: "desc" });
    expect(result).toBe(map);
  });

  it("sorts mods within each folder", () => {
    const map = new Map([
      ["root", [modA, modB]],
      ["folder-1", [modC, modB]],
    ]);
    const result = sortModsByFolder(map, { field: "name", direction: "asc" });
    expect(result.get("root")?.map((m) => m.displayName)).toEqual(["Alpha", "Zulu"]);
    expect(result.get("folder-1")?.map((m) => m.displayName)).toEqual(["Alpha", "Mike"]);
  });

  it("handles empty map", () => {
    const result = sortModsByFolder(new Map(), { field: "name", direction: "asc" });
    expect(result.size).toBe(0);
  });
});

// @vitest-environment happy-dom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkshopProject } from "@/lib/tauri";
import { useWorkshopDialogsStore, useWorkshopSelectionStore } from "@/stores";

import { useProjectSelectionActions } from "../useProjectSelectionActions";

function project(name: string): WorkshopProject {
  return {
    path: `X:/mods/${name}`,
    name,
    displayName: name,
    version: "1.0.0",
    description: "",
    authors: [],
    tags: [],
    champions: [],
    maps: [],
    layers: [],
    thumbnailPath: null,
    lastModified: "2026-08-21T21:14:02Z",
  };
}

const PROJECTS = [project("one"), project("two"), project("three")];
const testMutate = vi.fn();
const testState = { kind: "idle" as string };

vi.mock("../useFilteredProjects", () => ({ useFilteredProjects: () => PROJECTS }));
vi.mock("../useTestProject", () => ({
  useTestProjects: () => ({ mutate: testMutate, isPending: false }),
}));
vi.mock("../useWorkshopTestState", () => ({ useWorkshopTestState: () => testState }));

const actions = () => renderHook(() => useProjectSelectionActions()).result.current;
const pick = (names: string[]) =>
  useWorkshopSelectionStore.setState({
    selectedPaths: new Set(names.map((n) => `X:/mods/${n}`)),
  });

beforeEach(() => {
  vi.clearAllMocks();
  testState.kind = "idle";
  useWorkshopSelectionStore.setState({ selectedPaths: new Set() });
  useWorkshopDialogsStore.setState({ bulkPackProjects: [], bulkDeleteProjects: [] });
});

describe("useProjectSelectionActions", () => {
  it("names only the picked projects", () => {
    pick(["one", "three"]);

    expect(actions().projects).toEqual([PROJECTS[0], PROJECTS[2]]);
    expect(actions().count).toBe(2);
  });

  it("tests the picked projects", () => {
    pick(["two"]);

    actions().test();

    expect(testMutate.mock.calls[0][0]).toEqual({
      projects: [{ path: PROJECTS[1].path, displayName: PROJECTS[1].displayName }],
    });
  });

  /* The picks are spent by the press, because a menu that closes as it is
     pressed takes any completion callback down with it. */
  it("drops the picks as the run takes them", () => {
    pick(["one", "two"]);

    actions().test();

    expect(useWorkshopSelectionStore.getState().selectedPaths.size).toBe(0);
  });

  /* A session holds the files it was started over, and that set is not the
     user's to rewrite until it ends. */
  it("offers no test while a session is up", () => {
    pick(["one"]);
    testState.kind = "running-other";

    expect(actions().canTest).toBe(false);
  });

  it("offers no test with nothing picked", () => {
    expect(actions().canTest).toBe(false);
  });

  it("asks before it packs, over the picks", () => {
    pick(["one", "two"]);

    actions().pack();

    expect(useWorkshopDialogsStore.getState().bulkPackProjects).toEqual([PROJECTS[0], PROJECTS[1]]);
  });

  it("asks before it deletes, over the picks", () => {
    pick(["three"]);

    actions().delete();

    expect(useWorkshopDialogsStore.getState().bulkDeleteProjects).toEqual([PROJECTS[2]]);
  });
});

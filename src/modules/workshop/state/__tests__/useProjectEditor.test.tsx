// @vitest-environment happy-dom

import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { WorkshopProject } from "@/lib/tauri";
import { detailsDocument, filesDocument, gameDocument } from "@/modules/workshop";

import { ProjectProvider } from "../../components/ProjectContext";
import { useRecentDocumentIds } from "../useProjectEditor";
import { useWorkshopEditorStore } from "../workshopEditor";

const MINE: WorkshopProject = {
  path: "X:/mods/mine",
  name: "mine",
  displayName: "Mine",
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

const OTHER = "X:/mods/other";

function wrapper({ children }: { children: ReactNode }) {
  return <ProjectProvider project={MINE}>{children}</ProjectProvider>;
}

function store() {
  return useWorkshopEditorStore.getState();
}

function recent(): readonly string[] {
  return renderHook(() => useRecentDocumentIds(), { wrapper }).result.current;
}

describe("useRecentDocumentIds", () => {
  beforeEach(() => {
    useWorkshopEditorStore.setState({ byProject: {}, history: [], historyIndex: -1 });
  });

  /* The stack spans the shell, and the palette ranks one project's rows, so an
     unfiltered read would hand another project's ids the history bonus. */
  it("reads this project's stops out of a stack that spans the shell", () => {
    store().recordListVisit();
    store().openDocument(MINE.path, detailsDocument());
    store().openDocument(OTHER, gameDocument());
    store().openDocument(MINE.path, filesDocument("base"));

    expect(recent()).toEqual(["files:base", "details"]);
  });

  it("leads with where the user stands, then behind them, then ahead", () => {
    store().openDocument(MINE.path, detailsDocument());
    store().openDocument(MINE.path, filesDocument("base"));
    store().openDocument(MINE.path, gameDocument());
    store().navigateHistory(-1);

    expect(recent()).toEqual(["files:base", "details", "game"]);
  });

  it("has nothing to offer a project nobody has opened", () => {
    store().openDocument(OTHER, gameDocument());

    expect(recent()).toEqual([]);
  });
});

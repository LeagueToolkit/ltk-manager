// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { WorkshopProject } from "@/lib/tauri";
import { gameDocument, previewDocument } from "@/modules/workshop";

import { ProjectProvider } from "../../components/ProjectContext";
import { useExplorerStore } from "../../state/explorer";
import { type HistoryEntry, useWorkshopEditorStore } from "../../state/workshopEditor";
import { useExplorerNav } from "../useExplorer";

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

const EXPLORER = "game";
const DOCUMENT = "game";

function wrapper({ children }: { children: ReactNode }) {
  return <ProjectProvider project={MINE}>{children}</ProjectProvider>;
}

function store() {
  return useWorkshopEditorStore.getState();
}

/** Every stop as one string, so a directory reads apart from a bare tab. */
function stops(): string[] {
  return store().history.map((entry: HistoryEntry) => {
    if (entry.kind === "list") return "list";
    return entry.location === undefined ? "tab" : `@${entry.location.path || "/"}`;
  });
}

function mountNav() {
  return renderNav().result;
}

function renderNav() {
  return renderHook(() => useExplorerNav(EXPLORER, DOCUMENT), { wrapper });
}

/** A file preview opened out of the explorer, which is a tab of its own. */
function chunkTab() {
  return previewDocument(
    { kind: "gameChunk", wad: "Smolder.wad", pathHash: "0x1" },
    "assets/one.dds",
  );
}

beforeEach(() => {
  useWorkshopEditorStore.setState({ byProject: {}, history: [], historyIndex: -1 });
  useExplorerStore.setState({ locations: {}, selections: {}, filters: {}, scopes: {} });
});

describe("useExplorerNav", () => {
  it("moves the explorer, and records where it went", () => {
    const nav = mountNav();
    act(() => nav.current.goTo("assets"));

    expect(nav.current.location).toBe("assets");
    expect(stops()).toEqual(["@/", "@assets"]);
  });

  it("leaves the departure on the stack when the tab's stop names no directory", () => {
    /* A tab activated after its explorer mounted puts a bare stop on top. A
       move that recorded only its destination would complete that stop rather
       than push, and a back would then walk out of the tab. */
    store().recordListVisit();
    store().openDocument(MINE.path, gameDocument());
    expect(stops()).toEqual(["list", "tab"]);

    const nav = mountNav();
    act(() => nav.current.goTo("assets"));

    expect(stops()).toEqual(["list", "@/", "@assets"]);
    expect(store().historyIndex).toBe(2);
  });

  it("keeps the departure when the tab's own stop is the only one it has", () => {
    /* The reported shape: the stop on top is the tab's and names no directory,
       and it is the tab's first. A move naming only its destination completes
       that stop instead of pushing, leaving the tab one stop, and a back then
       walks past the tab to whatever came before it. */
    store().recordListVisit();
    useWorkshopEditorStore.setState((state) => ({
      history: [...state.history, { kind: "document", project: MINE.path, documentId: DOCUMENT }],
      historyIndex: state.history.length,
    }));
    expect(stops()).toEqual(["list", "tab"]);

    const nav = mountNav();
    act(() => nav.current.goTo("assets"));

    expect(stops()).toEqual(["list", "@/", "@assets"]);
    expect(store().historyIndex).toBe(2);
  });

  it("goes back to the directory it came from", () => {
    store().recordListVisit();
    store().openDocument(MINE.path, gameDocument());
    const nav = mountNav();

    act(() => nav.current.goTo("assets"));
    act(() => nav.current.goTo("assets/characters"));

    expect(store().navigateHistory(-1)).toMatchObject({
      location: { explorerId: EXPLORER, path: "assets" },
    });
    expect(store().navigateHistory(-1)).toMatchObject({
      location: { explorerId: EXPLORER, path: "" },
    });
  });

  it("records the parent a move up reaches", () => {
    const nav = mountNav();
    act(() => nav.current.goTo("assets/characters"));
    act(() => nav.current.goUp());

    expect(nav.current.location).toBe("assets");
    expect(stops()).toEqual(["@/", "@assets/characters", "@assets"]);
  });

  it("records nothing for a move to the directory it is already in", () => {
    const nav = mountNav();
    act(() => nav.current.goTo("assets"));
    act(() => nav.current.goTo("assets"));

    expect(stops()).toEqual(["@/", "@assets"]);
  });

  it("lays the route down when the tab opens already inside a directory", () => {
    /* The location belongs to the explorer and outlives the tab drawing it, so
       a tab can open several directories deep having walked no route there.
       Recording the deepest alone left the tab one stop, and one back walked
       past the tab to the workshop grid behind it. */
    useExplorerStore.setState({ locations: { [EXPLORER]: "assets/characters" } });
    store().recordListVisit();
    store().openDocument(MINE.path, gameDocument());

    mountNav();

    expect(stops()).toEqual(["list", "@/", "@assets", "@assets/characters"]);
    expect(store().historyIndex).toBe(3);
  });

  it("climbs out of a directory rather than out of the editor", () => {
    useExplorerStore.setState({ locations: { [EXPLORER]: "assets/characters" } });
    store().recordListVisit();
    store().openDocument(MINE.path, gameDocument());
    mountNav();

    expect(store().navigateHistory(-1)).toMatchObject({
      location: { explorerId: EXPLORER, path: "assets" },
    });
    expect(store().navigateHistory(-1)).toMatchObject({
      location: { explorerId: EXPLORER, path: "" },
    });
    expect(store().navigateHistory(-1)).toMatchObject({ kind: "list" });
  });

  it("records nothing for an activate of the tab a directory stop already names", () => {
    /* A stop naming no directory used to read as a different stop from one
       naming a directory of the same tab, so a click on the open tab pushed a
       second stop over the first and the next back only stepped off it. */
    store().recordListVisit();
    store().openDocument(MINE.path, gameDocument());
    const leaf = store().byProject[MINE.path]?.activeLeafId ?? "";
    const nav = mountNav();
    act(() => nav.current.goTo("assets"));

    act(() => store().activateDocument(MINE.path, leaf, DOCUMENT));

    expect(stops()).toEqual(["list", "@/", "@assets"]);
    expect(store().historyIndex).toBe(2);
  });

  it("writes nothing when the explorer remounts", () => {
    /* An explorer remounts whenever its route does, and the arrows route on
       every stop inside a project. A mount is not a navigation: laying the
       route down again would drop whatever the arrows had ahead of them and
       stand two junk stops in its place. */
    store().recordListVisit();
    store().openDocument(MINE.path, gameDocument());
    const first = renderNav();
    act(() => first.result.current.goTo("assets"));
    const before = stops();

    first.unmount();
    mountNav();

    expect(stops()).toEqual(before);
    expect(store().historyIndex).toBe(2);
  });

  it("keeps a preview ahead of the arrows across a remount", () => {
    store().recordListVisit();
    store().openDocument(MINE.path, gameDocument());
    const first = renderNav();
    act(() => first.result.current.goTo("assets"));
    act(() => store().openDocument(MINE.path, chunkTab()));

    expect(store().navigateHistory(-1)).toMatchObject({
      location: { explorerId: EXPLORER, path: "assets" },
    });
    first.unmount();
    mountNav();

    expect(stops()).toEqual(["list", "@/", "@assets", "tab"]);
    expect(store().historyIndex).toBe(2);
  });

  it("climbs out of the directory rather than out of the project after a preview", () => {
    useExplorerStore.setState({ locations: { [EXPLORER]: "assets/characters" } });
    store().recordListVisit();
    store().openDocument(MINE.path, gameDocument());
    mountNav();
    act(() => store().openDocument(MINE.path, chunkTab()));

    expect(store().navigateHistory(-1)).toMatchObject({
      location: { explorerId: EXPLORER, path: "assets/characters" },
    });
    expect(store().navigateHistory(-1)).toMatchObject({
      location: { explorerId: EXPLORER, path: "assets" },
    });
    expect(store().navigateHistory(-1)).toMatchObject({
      location: { explorerId: EXPLORER, path: "" },
    });
  });

  it("drops the selection on a move", () => {
    const nav = mountNav();
    useExplorerStore.getState().setSelection(EXPLORER, {
      items: new Map([
        ["h1", { id: "h1", kind: "file", path: "a", name: "a", sizeBytes: 0, fileCount: 1 }],
      ]),
      anchor: "h1",
    });

    act(() => nav.current.goTo("assets"));

    expect(useExplorerStore.getState().selections[EXPLORER]?.items.size).toBe(0);
  });
});

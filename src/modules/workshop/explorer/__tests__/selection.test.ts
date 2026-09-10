import { describe, expect, it } from "vitest";

import {
  isCovered,
  NO_SELECTION,
  type SelectedItem,
  selectEvery,
  type Selection,
  selectionSummary,
  selectItem,
} from "../selection";

function file(id: string, path: string, sizeBytes = 100): SelectedItem {
  return {
    id,
    kind: "file",
    path,
    name: path.slice(path.lastIndexOf("/") + 1),
    sizeBytes,
    fileCount: 1,
    entry: { pathHash: id, path, sizeBytes, wad: "Test.wad.client" },
  };
}

function dir(path: string, fileCount: number): SelectedItem {
  return { id: path, kind: "dir", path, name: path, sizeBytes: 0, fileCount };
}

const ORDER = [dir("a", 4), file("h1", "one.dds"), file("h2", "two.dds"), file("h3", "three.dds")];

const CLICK = { toggle: false, extend: false };
const CTRL = { toggle: true, extend: false };
const SHIFT = { toggle: false, extend: true };

function ids(selection: Selection): string[] {
  return [...selection.items.keys()];
}

describe("selectItem", () => {
  it("selects one and drops the rest", () => {
    const first = selectItem(NO_SELECTION, ORDER, "h1", CLICK);
    const second = selectItem(first, ORDER, "h3", CLICK);

    expect(ids(second)).toEqual(["h3"]);
    expect(second.anchor).toBe("h3");
  });

  it("adds one under the toggle", () => {
    const one = selectItem(NO_SELECTION, ORDER, "h1", CLICK);
    const two = selectItem(one, ORDER, "h3", CTRL);

    expect(ids(two)).toEqual(["h1", "h3"]);
  });

  it("removes one already held under the toggle", () => {
    const two = selectItem(selectItem(NO_SELECTION, ORDER, "h1", CLICK), ORDER, "h3", CTRL);

    expect(ids(selectItem(two, ORDER, "h1", CTRL))).toEqual(["h3"]);
  });

  it("moves the anchor to what the toggle touched", () => {
    const two = selectItem(selectItem(NO_SELECTION, ORDER, "h1", CLICK), ORDER, "h3", CTRL);

    expect(two.anchor).toBe("h3");
  });

  it("extends from the anchor over everything between", () => {
    const anchored = selectItem(NO_SELECTION, ORDER, "h1", CLICK);

    expect(ids(selectItem(anchored, ORDER, "h3", SHIFT))).toEqual(["h1", "h2", "h3"]);
  });

  it("extends backwards over the same run", () => {
    const anchored = selectItem(NO_SELECTION, ORDER, "h3", CLICK);

    expect(ids(selectItem(anchored, ORDER, "a", SHIFT)).sort()).toEqual(["a", "h1", "h2", "h3"]);
  });

  it("leaves the anchor where it was, so a second extend runs from it", () => {
    const anchored = selectItem(NO_SELECTION, ORDER, "h1", CLICK);
    const wide = selectItem(anchored, ORDER, "h3", SHIFT);
    const narrow = selectItem(wide, ORDER, "h2", SHIFT);

    expect(ids(narrow)).toEqual(["h1", "h2"]);
  });

  it("replaces the set, so an extend after a click of its own drops the rest", () => {
    const two = selectItem(selectItem(NO_SELECTION, ORDER, "a", CLICK), ORDER, "h3", CTRL);

    expect(ids(selectItem(two, ORDER, "h2", SHIFT))).toEqual(["h2", "h3"]);
  });

  it("unions the run into the set when the toggle rides along", () => {
    const two = selectItem(selectItem(NO_SELECTION, ORDER, "a", CLICK), ORDER, "h3", CTRL);
    const both = selectItem(two, ORDER, "h2", { toggle: true, extend: true });

    expect(ids(both).sort()).toEqual(["a", "h2", "h3"]);
  });

  it("selects the one alone when no anchor has been set", () => {
    expect(ids(selectItem(NO_SELECTION, ORDER, "h2", SHIFT))).toEqual(["h2"]);
  });

  it("selects the one alone when a filter took the anchor away", () => {
    const anchored = selectItem(NO_SELECTION, ORDER, "h1", CLICK);
    const narrowed = [ORDER[2]!, ORDER[3]!];

    expect(ids(selectItem(anchored, narrowed, "h3", SHIFT))).toEqual(["h3"]);
  });
});

describe("selectEvery", () => {
  it("takes the order it is given, and anchors on the first of it", () => {
    const every = selectEvery(ORDER);

    expect(ids(every)).toEqual(["a", "h1", "h2", "h3"]);
    expect(every.anchor).toBe("a");
  });
});

describe("selectionSummary", () => {
  it("counts a directory as the files below it", () => {
    const summary = selectionSummary(selectItem(NO_SELECTION, ORDER, "a", CLICK));

    expect(summary.files).toBe(4);
  });

  it("counts a file a selected directory covers only once", () => {
    const covered = file("h9", "a/inside.dds");
    const order = [...ORDER, covered];
    const both = selectItem(selectItem(NO_SELECTION, order, "a", CLICK), order, "h9", CTRL);

    expect(selectionSummary(both).files).toBe(4);
  });

  it("adds the sizes of the files it holds", () => {
    const two = selectItem(selectItem(NO_SELECTION, ORDER, "h1", CLICK), ORDER, "h2", CTRL);

    expect(selectionSummary(two)).toMatchObject({ files: 2, sizeBytes: 200, sizeIsWhole: true });
  });

  it("reports the size as a part once a directory is in, since none totals one", () => {
    const summary = selectionSummary(selectItem(NO_SELECTION, ORDER, "a", CLICK));

    expect(summary.sizeIsWhole).toBe(false);
  });

  it("reads empty for an empty selection", () => {
    expect(selectionSummary(NO_SELECTION)).toEqual({ files: 0, sizeBytes: 0, sizeIsWhole: true });
  });
});

describe("isCovered", () => {
  const selected = selectItem(NO_SELECTION, ORDER, "a", CLICK);

  it("holds a file below a selected directory", () => {
    expect(isCovered(selected, "a/inside.dds")).toBe(true);
  });

  it("holds a directory below a selected directory", () => {
    expect(isCovered(selected, "a/deeper")).toBe(true);
  });

  it("does not hold the selected directory itself", () => {
    expect(isCovered(selected, "a")).toBe(false);
  });

  it("breaks on a segment, so a name a selected path prefixes is untouched", () => {
    expect(isCovered(selected, "ab/inside.dds")).toBe(false);
  });

  it("does not hold a chunk with no resolved path", () => {
    expect(isCovered(selected, null)).toBe(false);
  });

  it("holds nothing while no directory is selected", () => {
    const files = selectItem(NO_SELECTION, ORDER, "h1", CLICK);

    expect(isCovered(files, "one.dds")).toBe(false);
  });
});

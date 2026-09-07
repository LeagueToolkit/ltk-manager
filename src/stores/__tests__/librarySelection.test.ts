import { beforeEach, describe, expect, it } from "vitest";

import { useLibrarySelectionStore } from "../librarySelection";

const store = () => useLibrarySelectionStore.getState();
const picked = () => [...store().selectedIds];

beforeEach(() => {
  useLibrarySelectionStore.setState({
    selectedIds: new Set(),
    orderedIds: ["a", "b", "c", "d"],
    anchorId: null,
  });
});

describe("librarySelection", () => {
  it("ranges from the anchor the last pick left", () => {
    store().toggle("b");
    store().selectRangeTo("d");

    expect(picked()).toEqual(["b", "c", "d"]);
  });

  it("ranges backwards from the anchor too", () => {
    store().toggle("c");
    store().selectRangeTo("a");

    expect(picked()).toEqual(["c", "a", "b"]);
  });

  /* Nothing has been picked yet, so a range has no start and the shift-click
     falls back to the one card under the pointer. */
  it("picks the one card where there is no anchor to range from", () => {
    store().selectRangeTo("c");

    expect(picked()).toEqual(["c"]);
  });

  /* A right click outside the selection acts on what it landed on, so the rest
     of the pick goes and the card becomes the anchor a shift-click ranges from. */
  it("replaces the selection and takes the anchor", () => {
    store().addMany(["a", "b"]);
    store().selectOnly("d");

    expect(picked()).toEqual(["d"]);
    expect(store().anchorId).toBe("d");
  });
});

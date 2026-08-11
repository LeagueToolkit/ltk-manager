import { useLibrarySelectionStore } from "@/stores";

describe("librarySelection store", () => {
  beforeEach(() => {
    useLibrarySelectionStore.setState({
      selectMode: false,
      selectedIds: new Set(),
      orderedIds: [],
      anchorId: null,
    });
  });

  it("adds and removes many ids in one update", () => {
    useLibrarySelectionStore.getState().addMany(["a", "b", "a"]);
    expect([...useLibrarySelectionStore.getState().selectedIds]).toEqual(["a", "b"]);

    useLibrarySelectionStore.getState().removeMany(["a", "missing"]);
    expect([...useLibrarySelectionStore.getState().selectedIds]).toEqual(["b"]);
  });

  it("does not notify subscribers for no-op bulk operations", () => {
    useLibrarySelectionStore.getState().addMany(["a", "b"]);
    const selected = useLibrarySelectionStore.getState().selectedIds;
    const listener = vi.fn();
    const unsubscribe = useLibrarySelectionStore.subscribe(listener);

    useLibrarySelectionStore.getState().addMany(["a", "b"]);
    useLibrarySelectionStore.getState().removeMany(["missing"]);

    expect(useLibrarySelectionStore.getState().selectedIds).toBe(selected);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});

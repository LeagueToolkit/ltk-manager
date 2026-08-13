import { useLibraryViewStore } from "@/stores/libraryView";

describe("libraryView store", () => {
  beforeEach(() => {
    localStorage.clear();
    useLibraryViewStore.setState({ expandedFolders: new Set() });
  });

  describe("toggleFolderExpanded", () => {
    it("adds a folder when not expanded", () => {
      useLibraryViewStore.getState().toggleFolderExpanded("folder-1");
      expect(useLibraryViewStore.getState().expandedFolders).toEqual(new Set(["folder-1"]));
    });

    it("removes a folder when already expanded", () => {
      useLibraryViewStore.setState({ expandedFolders: new Set(["folder-1"]) });
      useLibraryViewStore.getState().toggleFolderExpanded("folder-1");
      expect(useLibraryViewStore.getState().expandedFolders).toEqual(new Set());
    });

    it("handles multiple folders independently", () => {
      useLibraryViewStore.getState().toggleFolderExpanded("folder-1");
      useLibraryViewStore.getState().toggleFolderExpanded("folder-2");
      expect(useLibraryViewStore.getState().expandedFolders).toEqual(
        new Set(["folder-1", "folder-2"]),
      );

      useLibraryViewStore.getState().toggleFolderExpanded("folder-1");
      expect(useLibraryViewStore.getState().expandedFolders).toEqual(new Set(["folder-2"]));
    });
  });

  describe("cleanupStaleFolders", () => {
    it("removes IDs not in the valid set", () => {
      useLibraryViewStore.setState({
        expandedFolders: new Set(["folder-1", "folder-2", "folder-3"]),
      });
      useLibraryViewStore.getState().cleanupStaleFolders(new Set(["folder-1", "folder-3"]));
      expect(useLibraryViewStore.getState().expandedFolders).toEqual(
        new Set(["folder-1", "folder-3"]),
      );
    });

    it("clears all when no IDs are valid", () => {
      useLibraryViewStore.setState({ expandedFolders: new Set(["folder-1", "folder-2"]) });
      useLibraryViewStore.getState().cleanupStaleFolders(new Set());
      expect(useLibraryViewStore.getState().expandedFolders).toEqual(new Set());
    });

    it("keeps all when all IDs are valid", () => {
      useLibraryViewStore.setState({ expandedFolders: new Set(["folder-1"]) });
      useLibraryViewStore.getState().cleanupStaleFolders(new Set(["folder-1", "folder-2"]));
      expect(useLibraryViewStore.getState().expandedFolders).toEqual(new Set(["folder-1"]));
    });

    it("handles empty expanded set", () => {
      useLibraryViewStore.getState().cleanupStaleFolders(new Set(["folder-1"]));
      expect(useLibraryViewStore.getState().expandedFolders).toEqual(new Set());
    });
  });

  it("persists expanded folders using the shared Set encoding", () => {
    useLibraryViewStore.getState().toggleFolderExpanded("folder-1");

    expect(localStorage.getItem("ltk-library-view")).toContain('"__type":"Set"');
  });

  it("migrates the previous expanded-folder storage format", async () => {
    localStorage.setItem(
      "ltk-library-view",
      JSON.stringify({ state: { expandedFolders: ["folder-1"] }, version: 0 }),
    );

    await useLibraryViewStore.persist.rehydrate();

    expect(useLibraryViewStore.getState().expandedFolders).toEqual(new Set(["folder-1"]));
  });
});

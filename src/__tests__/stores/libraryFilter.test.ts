import { useLibraryFilterStore } from "@/stores/libraryFilter";

describe("libraryFilter store", () => {
  beforeEach(() => {
    localStorage.clear();
    useLibraryFilterStore.setState({
      selectedTags: new Set(),
      selectedChampions: new Set(),
      selectedMaps: new Set(),
      showOnlyEnabled: false,
      sort: { field: "enabled", direction: "asc" },
      searchQuery: "",
    });
  });

  it("defaults to enabled mods first", () => {
    expect(useLibraryFilterStore.getState().sort).toEqual({
      field: "enabled",
      direction: "asc",
    });
  });

  describe("toggleTag", () => {
    it("adds a tag when not present", () => {
      useLibraryFilterStore.getState().toggleTag("skin");
      expect(useLibraryFilterStore.getState().selectedTags).toEqual(new Set(["skin"]));
    });

    it("removes a tag when already present", () => {
      useLibraryFilterStore.setState({ selectedTags: new Set(["skin"]) });
      useLibraryFilterStore.getState().toggleTag("skin");
      expect(useLibraryFilterStore.getState().selectedTags).toEqual(new Set());
    });
  });

  describe("toggleChampion", () => {
    it("adds a champion when not present", () => {
      useLibraryFilterStore.getState().toggleChampion("Ahri");
      expect(useLibraryFilterStore.getState().selectedChampions).toEqual(new Set(["Ahri"]));
    });

    it("removes a champion when already present", () => {
      useLibraryFilterStore.setState({ selectedChampions: new Set(["Ahri"]) });
      useLibraryFilterStore.getState().toggleChampion("Ahri");
      expect(useLibraryFilterStore.getState().selectedChampions).toEqual(new Set());
    });
  });

  describe("toggleMap", () => {
    it("adds a map when not present", () => {
      useLibraryFilterStore.getState().toggleMap("SR");
      expect(useLibraryFilterStore.getState().selectedMaps).toEqual(new Set(["SR"]));
    });

    it("removes a map when already present", () => {
      useLibraryFilterStore.setState({ selectedMaps: new Set(["SR"]) });
      useLibraryFilterStore.getState().toggleMap("SR");
      expect(useLibraryFilterStore.getState().selectedMaps).toEqual(new Set());
    });
  });

  describe("setTags / setChampions / setMaps", () => {
    it("replaces selected tags", () => {
      useLibraryFilterStore.getState().setTags(new Set(["a", "b"]));
      expect(useLibraryFilterStore.getState().selectedTags).toEqual(new Set(["a", "b"]));
    });

    it("replaces selected champions", () => {
      useLibraryFilterStore.getState().setChampions(new Set(["Ahri", "Zed"]));
      expect(useLibraryFilterStore.getState().selectedChampions).toEqual(new Set(["Ahri", "Zed"]));
    });

    it("replaces selected maps", () => {
      useLibraryFilterStore.getState().setMaps(new Set(["SR"]));
      expect(useLibraryFilterStore.getState().selectedMaps).toEqual(new Set(["SR"]));
    });
  });

  describe("clearFilters", () => {
    it("clears all filter sets", () => {
      useLibraryFilterStore.setState({
        selectedTags: new Set(["skin"]),
        selectedChampions: new Set(["Ahri"]),
        selectedMaps: new Set(["SR"]),
      });
      useLibraryFilterStore.getState().clearFilters();
      const state = useLibraryFilterStore.getState();
      expect(state.selectedTags.size).toBe(0);
      expect(state.selectedChampions.size).toBe(0);
      expect(state.selectedMaps.size).toBe(0);
    });

    it("does not reset sort config", () => {
      useLibraryFilterStore.setState({ sort: { field: "name", direction: "asc" } });
      useLibraryFilterStore.getState().clearFilters();
      expect(useLibraryFilterStore.getState().sort).toEqual({ field: "name", direction: "asc" });
    });
  });

  describe("setSort", () => {
    it("updates sort config", () => {
      useLibraryFilterStore.getState().setSort({ field: "name", direction: "asc" });
      expect(useLibraryFilterStore.getState().sort).toEqual({ field: "name", direction: "asc" });
    });
  });

  it("restores filters, sort, and search after hydration", async () => {
    const state = useLibraryFilterStore.getState();
    state.setTags(new Set(["skin"]));
    state.setShowOnlyEnabled(true);
    state.setSort({ field: "installedAt", direction: "desc" });
    state.setSearchQuery("Veigar");

    const stored = localStorage.getItem("ltk-library-filters");
    expect(stored).not.toBeNull();
    expect(stored).toContain('"__type":"Set"');

    useLibraryFilterStore.setState({
      selectedTags: new Set(),
      showOnlyEnabled: false,
      sort: { field: "name", direction: "asc" },
      searchQuery: "",
    });
    localStorage.setItem("ltk-library-filters", stored!);
    await useLibraryFilterStore.persist.rehydrate();

    const restored = useLibraryFilterStore.getState();
    expect(restored.selectedTags).toEqual(new Set(["skin"]));
    expect(restored.showOnlyEnabled).toBe(true);
    expect(restored.sort).toEqual({ field: "installedAt", direction: "desc" });
    expect(restored.searchQuery).toBe("Veigar");
  });
});

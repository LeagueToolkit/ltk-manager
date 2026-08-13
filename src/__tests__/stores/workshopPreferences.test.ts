import { useWorkshopFilterStore, useWorkshopViewStore } from "@/stores";

describe("workshop preferences", () => {
  beforeEach(() => {
    localStorage.clear();
    useWorkshopFilterStore.setState({
      selectedTags: new Set(),
      selectedChampions: new Set(),
      selectedMaps: new Set(),
      sort: { field: "name", direction: "asc" },
    });
    useWorkshopViewStore.setState({ viewMode: "grid", searchQuery: "" });
  });

  it("restores filters and sorting after hydration", async () => {
    useWorkshopFilterStore.getState().setChampions(new Set(["Veigar"]));
    useWorkshopFilterStore.getState().setSort({ field: "lastModified", direction: "desc" });

    const stored = localStorage.getItem("ltk-workshop-filters");
    expect(stored).toContain('"__type":"Set"');
    useWorkshopFilterStore.setState({
      selectedChampions: new Set(),
      sort: { field: "name", direction: "asc" },
    });
    localStorage.setItem("ltk-workshop-filters", stored!);
    await useWorkshopFilterStore.persist.rehydrate();

    expect(useWorkshopFilterStore.getState().selectedChampions).toEqual(new Set(["Veigar"]));
    expect(useWorkshopFilterStore.getState().sort).toEqual({
      field: "lastModified",
      direction: "desc",
    });
  });

  it("restores search and view mode after hydration", async () => {
    useWorkshopViewStore.getState().setSearchQuery("Outworld Destroyer");
    useWorkshopViewStore.getState().setViewMode("list");

    const stored = localStorage.getItem("ltk-workshop-view");
    useWorkshopViewStore.setState({ viewMode: "grid", searchQuery: "" });
    localStorage.setItem("ltk-workshop-view", stored!);
    await useWorkshopViewStore.persist.rehydrate();

    expect(useWorkshopViewStore.getState().searchQuery).toBe("Outworld Destroyer");
    expect(useWorkshopViewStore.getState().viewMode).toBe("list");
  });
});

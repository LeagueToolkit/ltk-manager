import { useWorkshopSelectionStore } from "../workshopSelection";

describe("workshopSelection store", () => {
  beforeEach(() => {
    useWorkshopSelectionStore.setState({ selectedPaths: new Set() });
  });

  describe("toggle", () => {
    it("adds a path when not present", () => {
      useWorkshopSelectionStore.getState().toggle("/project-a");
      expect(useWorkshopSelectionStore.getState().selectedPaths).toEqual(new Set(["/project-a"]));
    });

    it("removes a path when already present", () => {
      useWorkshopSelectionStore.setState({ selectedPaths: new Set(["/project-a"]) });
      useWorkshopSelectionStore.getState().toggle("/project-a");
      expect(useWorkshopSelectionStore.getState().selectedPaths).toEqual(new Set());
    });

    it("handles multiple toggles", () => {
      const store = useWorkshopSelectionStore.getState();
      store.toggle("/a");
      store.toggle("/b");
      store.toggle("/c");
      expect(useWorkshopSelectionStore.getState().selectedPaths).toEqual(
        new Set(["/a", "/b", "/c"]),
      );
      useWorkshopSelectionStore.getState().toggle("/b");
      expect(useWorkshopSelectionStore.getState().selectedPaths).toEqual(new Set(["/a", "/c"]));
    });
  });

  describe("selectAll", () => {
    it("sets all paths from array", () => {
      useWorkshopSelectionStore.getState().selectAll(["/a", "/b", "/c"]);
      expect(useWorkshopSelectionStore.getState().selectedPaths).toEqual(
        new Set(["/a", "/b", "/c"]),
      );
    });

    it("replaces previous selection", () => {
      useWorkshopSelectionStore.setState({ selectedPaths: new Set(["/old"]) });
      useWorkshopSelectionStore.getState().selectAll(["/new-a", "/new-b"]);
      expect(useWorkshopSelectionStore.getState().selectedPaths).toEqual(
        new Set(["/new-a", "/new-b"]),
      );
    });
  });

  describe("clear", () => {
    it("empties the selection", () => {
      useWorkshopSelectionStore.setState({ selectedPaths: new Set(["/a", "/b"]) });
      useWorkshopSelectionStore.getState().clear();
      expect(useWorkshopSelectionStore.getState().selectedPaths.size).toBe(0);
    });
  });
});

import { useWorkshopLayoutStore } from "@/stores/workshopLayout";

describe("workshopLayout", () => {
  beforeEach(() => {
    useWorkshopLayoutStore.setState({ tabOpenMode: "append" });
    localStorage.clear();
  });

  describe("tabOpenMode", () => {
    /* Every open gets its own tab unless the user asks otherwise, so a walk
       through a directory leaves the files it opened behind. */
    it("appends by default", () => {
      expect(useWorkshopLayoutStore.getState().tabOpenMode).toBe("append");
    });

    it("switches to reusing one tab", () => {
      useWorkshopLayoutStore.getState().setTabOpenMode("replace");
      expect(useWorkshopLayoutStore.getState().tabOpenMode).toBe("replace");
    });
  });
});

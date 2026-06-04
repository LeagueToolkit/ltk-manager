import { useDisplayStore } from "@/stores/displayStore";

describe("displayStore", () => {
  beforeEach(() => {
    useDisplayStore.setState({
      zoomLevel: 100,
      reduceMotion: "system",
    });
    localStorage.clear();
  });

  describe("default values", () => {
    it("has zoomLevel 100 by default", () => {
      expect(useDisplayStore.getState().zoomLevel).toBe(100);
    });

    it("has reduceMotion 'system' by default", () => {
      expect(useDisplayStore.getState().reduceMotion).toBe("system");
    });
  });

  describe("setZoomLevel", () => {
    it("updates zoomLevel to 70", () => {
      useDisplayStore.getState().setZoomLevel(70);
      expect(useDisplayStore.getState().zoomLevel).toBe(70);
    });

    it("updates zoomLevel to 130", () => {
      useDisplayStore.getState().setZoomLevel(130);
      expect(useDisplayStore.getState().zoomLevel).toBe(130);
    });

    it("updates zoomLevel back to 100", () => {
      useDisplayStore.getState().setZoomLevel(70);
      useDisplayStore.getState().setZoomLevel(100);
      expect(useDisplayStore.getState().zoomLevel).toBe(100);
    });
  });

  describe("setReduceMotion", () => {
    it("updates reduceMotion to on", () => {
      useDisplayStore.getState().setReduceMotion("on");
      expect(useDisplayStore.getState().reduceMotion).toBe("on");
    });

    it("updates reduceMotion to off", () => {
      useDisplayStore.getState().setReduceMotion("off");
      expect(useDisplayStore.getState().reduceMotion).toBe("off");
    });

    it("updates reduceMotion back to system", () => {
      useDisplayStore.getState().setReduceMotion("on");
      useDisplayStore.getState().setReduceMotion("system");
      expect(useDisplayStore.getState().reduceMotion).toBe("system");
    });
  });

  describe("persistence", () => {
    it("persists to localStorage under ltk-display-prefs key", () => {
      useDisplayStore.getState().setZoomLevel(70);
      useDisplayStore.getState().setReduceMotion("on");

      const stored = localStorage.getItem("ltk-display-prefs");
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.state.zoomLevel).toBe(70);
      expect(parsed.state.reduceMotion).toBe("on");
    });
  });

  describe("migration", () => {
    it("migrates compact density to zoomLevel 70", async () => {
      localStorage.setItem(
        "ltk-display-prefs",
        JSON.stringify({
          version: 0,
          state: { density: "compact", reduceMotion: "system" },
        }),
      );

      useDisplayStore.persist.rehydrate();
      await vi.waitFor(() => expect(useDisplayStore.getState().zoomLevel).toBe(70));
    });

    it("migrates normal density to zoomLevel 80", async () => {
      localStorage.setItem(
        "ltk-display-prefs",
        JSON.stringify({
          version: 0,
          state: { density: "normal", reduceMotion: "on" },
        }),
      );

      useDisplayStore.persist.rehydrate();
      await vi.waitFor(() => {
        expect(useDisplayStore.getState().zoomLevel).toBe(80);
        expect(useDisplayStore.getState().reduceMotion).toBe("on");
      });
    });

    it("migrates spacious density to zoomLevel 100", async () => {
      localStorage.setItem(
        "ltk-display-prefs",
        JSON.stringify({
          version: 0,
          state: { density: "spacious", reduceMotion: "system" },
        }),
      );

      useDisplayStore.persist.rehydrate();
      await vi.waitFor(() => expect(useDisplayStore.getState().zoomLevel).toBe(100));
    });
  });
});

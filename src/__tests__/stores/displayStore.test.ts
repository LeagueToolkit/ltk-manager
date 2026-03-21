import { useDisplayStore } from "@/stores/displayStore";

describe("displayStore", () => {
  beforeEach(() => {
    useDisplayStore.setState({
      density: "normal",
      reduceMotion: "system",
    });
    localStorage.clear();
  });

  describe("default values", () => {
    it("has density 'normal' by default", () => {
      expect(useDisplayStore.getState().density).toBe("normal");
    });

    it("has reduceMotion 'system' by default", () => {
      expect(useDisplayStore.getState().reduceMotion).toBe("system");
    });
  });

  describe("setDensity", () => {
    it("updates density to compact", () => {
      useDisplayStore.getState().setDensity("compact");
      expect(useDisplayStore.getState().density).toBe("compact");
    });

    it("updates density to spacious", () => {
      useDisplayStore.getState().setDensity("spacious");
      expect(useDisplayStore.getState().density).toBe("spacious");
    });

    it("updates density back to normal", () => {
      useDisplayStore.getState().setDensity("compact");
      useDisplayStore.getState().setDensity("normal");
      expect(useDisplayStore.getState().density).toBe("normal");
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
      useDisplayStore.getState().setDensity("compact");
      useDisplayStore.getState().setReduceMotion("on");

      const stored = localStorage.getItem("ltk-display-prefs");
      expect(stored).toBeTruthy();
      const parsed = JSON.parse(stored!);
      expect(parsed.state.density).toBe("compact");
      expect(parsed.state.reduceMotion).toBe("on");
    });
  });
});

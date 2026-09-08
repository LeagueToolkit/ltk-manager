import { isLevelVisible, useDevConsoleStore } from "..";

describe("isLevelVisible", () => {
  it("shows same level as filter", () => {
    expect(isLevelVisible("INFO", "INFO")).toBe(true);
  });

  it("shows higher level than filter", () => {
    expect(isLevelVisible("ERROR", "DEBUG")).toBe(true);
  });

  it("hides lower level than filter", () => {
    expect(isLevelVisible("TRACE", "WARN")).toBe(false);
    expect(isLevelVisible("DEBUG", "ERROR")).toBe(false);
  });

  it("shows unknown entry levels", () => {
    expect(isLevelVisible("CUSTOM", "INFO")).toBe(true);
  });
});

describe("devConsole store", () => {
  beforeEach(() => {
    useDevConsoleStore.setState({
      entries: [],
      isOpen: false,
      levelFilter: "DEBUG",
      targetFilter: "",
    });
  });

  describe("addEntry", () => {
    it("adds an entry with auto-generated id", () => {
      useDevConsoleStore.getState().addEntry({
        timestamp: "2025-01-01T00:00:00Z",
        level: "INFO",
        target: "app",
        message: "hello",
      });
      const { entries } = useDevConsoleStore.getState();
      expect(entries).toHaveLength(1);
      expect(entries[0].level).toBe("INFO");
      expect(entries[0].message).toBe("hello");
      expect(typeof entries[0].id).toBe("number");
    });

    it("assigns incrementing ids", () => {
      const store = useDevConsoleStore.getState();
      store.addEntry({ timestamp: "", level: "INFO", target: "", message: "a" });
      store.addEntry({ timestamp: "", level: "INFO", target: "", message: "b" });
      const { entries } = useDevConsoleStore.getState();
      expect(entries[1].id).toBeGreaterThan(entries[0].id);
    });

    it("caps at 500 entries", () => {
      for (let i = 0; i < 510; i++) {
        useDevConsoleStore
          .getState()
          .addEntry({ timestamp: "", level: "INFO", target: "", message: `msg${i}` });
      }
      const { entries } = useDevConsoleStore.getState();
      expect(entries).toHaveLength(500);
      expect(entries[entries.length - 1].message).toBe("msg509");
    });
  });

  describe("toggle", () => {
    it("flips isOpen", () => {
      expect(useDevConsoleStore.getState().isOpen).toBe(false);
      useDevConsoleStore.getState().toggle();
      expect(useDevConsoleStore.getState().isOpen).toBe(true);
      useDevConsoleStore.getState().toggle();
      expect(useDevConsoleStore.getState().isOpen).toBe(false);
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      useDevConsoleStore
        .getState()
        .addEntry({ timestamp: "", level: "INFO", target: "", message: "x" });
      useDevConsoleStore.getState().clear();
      expect(useDevConsoleStore.getState().entries).toHaveLength(0);
    });
  });

  describe("setLevelFilter", () => {
    it("updates the level filter", () => {
      useDevConsoleStore.getState().setLevelFilter("ERROR");
      expect(useDevConsoleStore.getState().levelFilter).toBe("ERROR");
    });
  });

  describe("setTargetFilter", () => {
    it("updates the target filter", () => {
      useDevConsoleStore.getState().setTargetFilter("network");
      expect(useDevConsoleStore.getState().targetFilter).toBe("network");
    });
  });
});

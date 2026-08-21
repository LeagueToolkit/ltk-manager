import { keepScrollTop, keptScrollTop, useGameBrowserStore } from "@/stores/gameBrowser";

describe("gameBrowser store", () => {
  beforeEach(() => {
    useGameBrowserStore.setState({ expandedDirs: new Set(), shutWadDirs: {}, scrollTops: {} });
  });

  describe("toggleDir", () => {
    it("opens a directory that was shut", () => {
      useGameBrowserStore.getState().toggleDir("assets/characters");
      expect(useGameBrowserStore.getState().expandedDirs).toEqual(new Set(["assets/characters"]));
    });

    it("shuts a directory that was open", () => {
      useGameBrowserStore.setState({ expandedDirs: new Set(["assets/characters"]) });
      useGameBrowserStore.getState().toggleDir("assets/characters");
      expect(useGameBrowserStore.getState().expandedDirs).toEqual(new Set());
    });

    it("leaves the other directories alone", () => {
      const store = useGameBrowserStore.getState();
      store.toggleDir("assets");
      store.toggleDir("data");
      useGameBrowserStore.getState().toggleDir("assets");
      expect(useGameBrowserStore.getState().expandedDirs).toEqual(new Set(["data"]));
    });

    /* The tree reads the set on every render, so a mutated one would leave the
       rows it drew standing. */
    it("replaces the set rather than mutating it", () => {
      const before = useGameBrowserStore.getState().expandedDirs;
      useGameBrowserStore.getState().toggleDir("assets");
      expect(useGameBrowserStore.getState().expandedDirs).not.toBe(before);
      expect(before.size).toBe(0);
    });
  });

  describe("toggleWadDir", () => {
    it("shuts a directory of one archive alone", () => {
      const store = useGameBrowserStore.getState();
      store.toggleWadDir("Aatrox.wad.client", "d:assets");
      store.toggleWadDir("Ahri.wad.client", "d:data");

      expect(useGameBrowserStore.getState().shutWadDirs).toEqual({
        "Aatrox.wad.client": new Set(["d:assets"]),
        "Ahri.wad.client": new Set(["d:data"]),
      });
    });

    it("opens a directory it had shut", () => {
      useGameBrowserStore.getState().toggleWadDir("Aatrox.wad.client", "d:assets");
      useGameBrowserStore.getState().toggleWadDir("Aatrox.wad.client", "d:assets");

      expect(useGameBrowserStore.getState().shutWadDirs["Aatrox.wad.client"]).toEqual(new Set());
    });
  });

  describe("kept scroll", () => {
    it("reads back what a list was left at", () => {
      keepScrollTop("game-index", 1240);
      expect(keptScrollTop("game-index")).toBe(1240);
    });

    /* A list nobody has scrolled opens at its first row rather than nowhere. */
    it("answers zero for a list it has never seen", () => {
      expect(keptScrollTop("game-wad:Aatrox.wad.client")).toBe(0);
    });

    it("keeps one list's offset out of another's", () => {
      keepScrollTop("game-index", 300);
      keepScrollTop("game-wads", 80);
      expect(keptScrollTop("game-index")).toBe(300);
      expect(keptScrollTop("game-wads")).toBe(80);
    });
  });
});

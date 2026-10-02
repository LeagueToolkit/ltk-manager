import { api } from "@/lib/tauri";
import { commandNames } from "@/test/commandNames";
import { mockInvoke } from "@/test/mocks/tauri";

describe("api", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe("settings", () => {
    it("getSettings invokes get_settings", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: { theme: "dark" } });
      const result = await api.getSettings();
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.settings.getSettings);
      expect(result).toEqual({ ok: true, value: { theme: "dark" } });
    });

    it("saveSettings invokes save_settings with settings arg", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: undefined });
      const settings = { theme: "dark" } as Parameters<typeof api.saveSettings>[0];
      await api.saveSettings(settings);
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.settings.saveSettings, { settings });
    });

    it("validateLeaguePath invokes with path arg", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: true });
      await api.validateLeaguePath("/some/path");
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.settings.validateLeaguePath, {
        path: "/some/path",
      });
    });
  });

  describe("mods", () => {
    it("getInstalledMods invokes get_installed_mods", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: [] });
      const result = await api.getInstalledMods();
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.library.getInstalledMods);
      expect(result).toEqual({ ok: true, value: [] });
    });

    it("installMod invokes with filePath", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: { id: "mod1" } });
      await api.installMod("/path/to/mod.modpkg");
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.library.installMod, {
        filePath: "/path/to/mod.modpkg",
      });
    });

    it("toggleMod invokes with modId and enabled", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: undefined });
      await api.toggleMod("mod1", false);
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.library.toggleMod, {
        modId: "mod1",
        enabled: false,
      });
    });

    it("uninstallMod invokes with modId", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: undefined });
      await api.uninstallMod("mod1");
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.library.uninstallMod, { modId: "mod1" });
    });
  });

  describe("profiles", () => {
    it("createModProfile invokes with name", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: { id: "p1", name: "My Profile" } });
      await api.createModProfile("My Profile");
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.library.createModProfile, {
        name: "My Profile",
      });
    });

    it("switchModProfile invokes with profileId", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: { id: "p1" } });
      await api.switchModProfile("p1");
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.library.switchModProfile, {
        profileId: "p1",
      });
    });
  });

  describe("workshop", () => {
    it("getWorkshopProjects invokes get_workshop_projects", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: [] });
      await api.getWorkshopProjects();
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.workshop.getWorkshopProjects);
    });

    it("deleteWorkshopProject invokes with projectPath", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: undefined });
      await api.deleteWorkshopProject("/path/to/project");
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.workshop.deleteWorkshopProject, {
        projectPath: "/path/to/project",
      });
    });

    it("getProjectEditorState invokes with projectPath", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: null });
      const result = await api.getProjectEditorState("/path/to/project");
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.workshop.getProjectEditorState, {
        projectPath: "/path/to/project",
      });
      expect(result).toEqual({ ok: true, value: null });
    });

    it("saveProjectEditorState invokes with projectPath and content", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: undefined });
      await api.saveProjectEditorState("/path/to/project", '{"version":1}');
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.workshop.saveProjectEditorState, {
        projectPath: "/path/to/project",
        content: '{"version":1}',
      });
    });
  });

  describe("hashtables", () => {
    it("getHashtableCacheStatus invokes get_hashtable_cache_status", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: { dir: "C:/hashes", tables: [] } });
      const result = await api.getHashtableCacheStatus();
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.game.getHashtableCacheStatus);
      expect(result).toEqual({ ok: true, value: { dir: "C:/hashes", tables: [] } });
    });

    it("syncHashtables invokes with force", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: { upToDate: true, installed: [] } });
      await api.syncHashtables(true);
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.game.syncHashtables, { force: true });
    });
  });

  describe("game wads", () => {
    it("getGameWads invokes get_game_wads with the source", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: [] });
      const result = await api.getGameWads("lcu");
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.game.getGameWads, { source: "lcu" });
      expect(result).toEqual({ ok: true, value: [] });
    });

    it("readGameWad invokes with wadName and the source", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: [] });
      await api.readGameWad("game", "Champions/Aatrox.wad.client");
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.game.readGameWad, {
        wadName: "Champions/Aatrox.wad.client",
        source: "game",
      });
    });
  });

  describe("patcher", () => {
    it("stopPatcher invokes stop_patcher", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: undefined });
      await api.stopPatcher();
      expect(mockInvoke).toHaveBeenCalledWith(commandNames.patcher.stopPatcher);
    });
  });

  describe("error handling", () => {
    it("wraps IPC error responses into Result Err", async () => {
      mockInvoke.mockResolvedValue({
        ok: false,
        error: { code: "MOD_NOT_FOUND", modId: "x" },
      });
      const result = await api.getInstalledMods();
      expect(result).toEqual({
        ok: false,
        error: { code: "MOD_NOT_FOUND", modId: "x" },
      });
    });
  });
});

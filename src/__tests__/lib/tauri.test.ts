import { api } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";

describe("api", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe("settings", () => {
    it("getSettings invokes get_settings", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: { theme: "dark" } });
      const result = await api.getSettings();
      expect(mockInvoke).toHaveBeenCalledWith("get_settings", undefined);
      expect(result).toEqual({ ok: true, value: { theme: "dark" } });
    });

    it("saveSettings invokes save_settings with settings arg", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: undefined });
      const settings = { theme: "dark" } as Parameters<typeof api.saveSettings>[0];
      await api.saveSettings(settings);
      expect(mockInvoke).toHaveBeenCalledWith("save_settings", { settings });
    });

    it("validateLeaguePath invokes with path arg", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: true });
      await api.validateLeaguePath("/some/path");
      expect(mockInvoke).toHaveBeenCalledWith("validate_league_path", { path: "/some/path" });
    });
  });

  describe("mods", () => {
    it("getInstalledMods invokes get_installed_mods", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: [] });
      const result = await api.getInstalledMods();
      expect(mockInvoke).toHaveBeenCalledWith("get_installed_mods", undefined);
      expect(result).toEqual({ ok: true, value: [] });
    });

    it("installMod invokes with filePath", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: { id: "mod1" } });
      await api.installMod("/path/to/mod.modpkg");
      expect(mockInvoke).toHaveBeenCalledWith("install_mod", { filePath: "/path/to/mod.modpkg" });
    });

    it("toggleMod invokes with modId and enabled", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: undefined });
      await api.toggleMod("mod1", false);
      expect(mockInvoke).toHaveBeenCalledWith("toggle_mod", { modId: "mod1", enabled: false });
    });

    it("uninstallMod invokes with modId", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: undefined });
      await api.uninstallMod("mod1");
      expect(mockInvoke).toHaveBeenCalledWith("uninstall_mod", { modId: "mod1" });
    });
  });

  describe("profiles", () => {
    it("createModProfile invokes with name", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: { id: "p1", name: "My Profile" } });
      await api.createModProfile("My Profile");
      expect(mockInvoke).toHaveBeenCalledWith("create_mod_profile", { name: "My Profile" });
    });

    it("switchModProfile invokes with profileId", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: { id: "p1" } });
      await api.switchModProfile("p1");
      expect(mockInvoke).toHaveBeenCalledWith("switch_mod_profile", { profileId: "p1" });
    });
  });

  describe("workshop", () => {
    it("getWorkshopProjects invokes get_workshop_projects", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: [] });
      await api.getWorkshopProjects();
      expect(mockInvoke).toHaveBeenCalledWith("get_workshop_projects", undefined);
    });

    it("deleteWorkshopProject invokes with projectPath", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: undefined });
      await api.deleteWorkshopProject("/path/to/project");
      expect(mockInvoke).toHaveBeenCalledWith("delete_workshop_project", {
        projectPath: "/path/to/project",
      });
    });

    it("getProjectEditorState invokes with projectPath", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: null });
      const result = await api.getProjectEditorState("/path/to/project");
      expect(mockInvoke).toHaveBeenCalledWith("get_project_editor_state", {
        projectPath: "/path/to/project",
      });
      expect(result).toEqual({ ok: true, value: null });
    });

    it("saveProjectEditorState invokes with projectPath and content", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: undefined });
      await api.saveProjectEditorState("/path/to/project", '{"version":1}');
      expect(mockInvoke).toHaveBeenCalledWith("save_project_editor_state", {
        projectPath: "/path/to/project",
        content: '{"version":1}',
      });
    });
  });

  describe("patcher", () => {
    it("stopPatcher invokes stop_patcher", async () => {
      mockInvoke.mockResolvedValue({ ok: true, value: undefined });
      await api.stopPatcher();
      expect(mockInvoke).toHaveBeenCalledWith("stop_patcher", undefined);
    });
  });

  describe("error handling", () => {
    it("wraps IPC error responses into Result Err", async () => {
      mockInvoke.mockResolvedValue({
        ok: false,
        error: { code: "MOD_NOT_FOUND", message: "Not found" },
      });
      const result = await api.getInstalledMods();
      expect(result).toEqual({
        ok: false,
        error: { code: "MOD_NOT_FOUND", message: "Not found" },
      });
    });
  });
});

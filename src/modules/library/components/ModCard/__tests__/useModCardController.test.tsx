// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InstalledMod } from "@/lib/tauri";
import { createMockInstalledMod } from "@/test/fixtures";
import { mockInvoke } from "@/test/mocks/tauri";

import { useModCardController } from "../useModCardController";

const toast = { toast: vi.fn(), success: vi.fn(), error: vi.fn(), task: vi.fn() };
const setModStorage = { mutate: vi.fn(), isPending: false };
const noopMutation = { mutate: vi.fn(), isPending: false };

vi.mock("@/components", () => ({ useToast: () => toast }));

vi.mock("@/modules/library/api", () => ({
  useMoveModToFolder: () => noopMutation,
  useSetModStorage: () => setModStorage,
  useToggleMod: () => noopMutation,
  useUninstallMod: () => noopMutation,
  useSkinhackFlag: () => ({
    isFlagged: false,
    reason: "",
    infoOpen: false,
    setInfoOpen: vi.fn(),
  }),
}));

vi.mock("@/modules/library/api/useModThumbnail", () => ({
  useModThumbnail: () => ({ data: undefined }),
}));

vi.mock("@/modules/patcher", () => ({
  usePatcherStatus: () => ({ data: { running: false } }),
}));

/* The store is a zustand selector hook, so it has to answer whatever selector
   the controller hands it rather than a fixed object. */
const selectionState = {
  selectMode: false,
  selectedIds: new Set<string>(),
  toggle: vi.fn(),
  selectRangeTo: vi.fn(),
};
vi.mock("@/stores", () => ({
  useLibrarySelectionStore: (selector: (state: typeof selectionState) => unknown) =>
    selector(selectionState),
}));

function mount(mod: InstalledMod) {
  return renderHook(() => useModCardController({ mod, viewMode: "grid" })).result;
}

const faulted = {
  kind: "conversionFailed" as const,
  error: "The archive could not be read",
  quarantineDir: "/storage/quarantine/broken-mod",
};

beforeEach(() => {
  vi.clearAllMocks();
  setModStorage.isPending = false;
  // The store is a shared object rather than a fresh mock, so a test that turns
  // select mode on has to hand it back.
  selectionState.selectMode = false;
  mockInvoke.mockResolvedValue({ ok: true, value: null });
});

describe("useModCardController storage", () => {
  it("offers the switch on a fantome that still has its archive", () => {
    const view = mount(createMockInstalledMod({ format: "fantome", hasArchive: true }));

    expect(view.current.canChangeStorage).toBe(true);
  });

  /* A modpkg's archive is where its content lives — ADR-0004 says there is no
     unpacked form to switch to. */
  it("offers nothing on a modpkg", () => {
    const view = mount(createMockInstalledMod({ format: "modpkg", storage: "archive" }));

    expect(view.current.canChangeStorage).toBe(false);
  });

  /* The archive is the only thing either direction converts against. */
  it("offers nothing once the archive is gone", () => {
    const view = mount(createMockInstalledMod({ hasArchive: false }));

    expect(view.current.canChangeStorage).toBe(false);
  });

  it("offers nothing on a mod that has faulted", () => {
    const view = mount(createMockInstalledMod({ fault: faulted }));

    expect(view.current.canChangeStorage).toBe(false);
  });

  it("asks for the storage the reader picked", () => {
    const view = mount(createMockInstalledMod({ storage: "project" }));

    act(() => view.current.onSetStorage("archive"));

    expect(setModStorage.mutate).toHaveBeenCalledWith(
      { modId: "test-mod-id", storage: "archive" },
      expect.anything(),
    );
  });

  /* The menu marks the current mode rather than hiding it, so picking it again
     is a click that must cost nothing. */
  it("does not convert a mod to the storage it already has", () => {
    const view = mount(createMockInstalledMod({ storage: "project" }));

    act(() => view.current.onSetStorage("project"));

    expect(setModStorage.mutate).not.toHaveBeenCalled();
  });

  it("does not convert a mod that cannot be converted", () => {
    const view = mount(createMockInstalledMod({ format: "modpkg", storage: "archive" }));

    act(() => view.current.onSetStorage("project"));

    expect(setModStorage.mutate).not.toHaveBeenCalled();
  });

  /* The trigger disables off this, which is what stops a second conversion
     landing on a mod already being rewritten. */
  it("reports a conversion still in flight", () => {
    setModStorage.isPending = true;
    const view = mount(createMockInstalledMod());

    expect(view.current.storageChangePending).toBe(true);
  });

  /* Success is announced by the progress toast. A refusal is not, and it is the
     one that carries something the user has to read. */
  it("shows the reason a conversion was refused", () => {
    const view = mount(createMockInstalledMod({ storage: "project" }));
    act(() => view.current.onSetStorage("archive"));

    const { onError } = setModStorage.mutate.mock.calls[0][1];
    act(() => onError({ message: "This mod is in a failed state." }));

    expect(toast.error).toHaveBeenCalledWith(
      "Could not change how this mod is stored",
      "This mod is in a failed state.",
    );
  });
});

describe("useModCardController reveal", () => {
  it("opens the mod's own directory", async () => {
    const view = mount(createMockInstalledMod({ modDir: "/storage/mods/test-mod" }));

    await act(async () => view.current.onOpenLocation());

    expect(mockInvoke).toHaveBeenCalledWith("reveal_in_explorer", {
      path: "/storage/mods/test-mod",
    });
  });

  /* A faulted mod's own directory is gone. Quarantine holds what is left of it,
     which is the folder someone opening it now is looking for. */
  it("opens quarantine for a mod whose own directory is gone", async () => {
    const view = mount(
      createMockInstalledMod({ modDir: "/storage/mods/broken-mod", fault: faulted }),
    );

    await act(async () => view.current.onOpenLocation());

    expect(mockInvoke).toHaveBeenCalledWith("reveal_in_explorer", {
      path: "/storage/quarantine/broken-mod",
    });
  });
});

/* A mod that failed to convert is parked, not gone: its files sit in quarantine
   and its entry stays in the library. The menu is the only way to either of
   those, so being unusable cannot be what closes it. */
describe("useModCardController quarantine", () => {
  it("keeps the menu open to a mod that cannot be used", () => {
    const result = mount(createMockInstalledMod({ id: "a", fault: faulted }));

    expect(result.current.interactionsDisabled).toBe(true);
    expect(result.current.menuDisabled).toBe(false);
  });

  it("closes the menu in select mode, which is a mode over the whole grid", () => {
    selectionState.selectMode = true;
    const result = mount(createMockInstalledMod({ id: "a", fault: faulted }));

    expect(result.current.menuDisabled).toBe(true);
  });

  it("leaves a healthy mod's menu open", () => {
    const result = mount(createMockInstalledMod({ id: "a" }));

    expect(result.current.menuDisabled).toBe(false);
  });
});

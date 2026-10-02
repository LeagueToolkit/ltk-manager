// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { InstalledMod, ModStorageProgress } from "@/lib/tauri";
import { commandNames } from "@/test/commandNames";
import { createMockInstalledMod } from "@/test/fixtures";
import { mockInvoke, mockListen } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { libraryKeys } from "../keys";
import { useModStorageToast } from "../useModStorageToast";

const task = { report: vi.fn(), close: vi.fn() };
const toast = { toast: vi.fn(), success: vi.fn(), error: vi.fn(), task: vi.fn(() => task) };

vi.mock("@/components", () => ({ useToast: () => toast }));

function mount(mods: InstalledMod[] = [createMockInstalledMod()]) {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(libraryKeys.mods(), mods);

  return renderHook(() => useModStorageToast(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
}

/** Hand the mounted hook one `mod-storage-progress` event. */
function report(overrides?: Partial<ModStorageProgress>) {
  const listener = (mockListen as Mock).mock.calls.find(
    ([name]) => name === "mod-storage-progress",
  )?.[1];

  act(() =>
    listener({
      payload: {
        modId: "test-mod-id",
        storage: "project",
        stage: "extracting",
        currentItem: "Aatrox.wad.client",
        current: 0,
        total: 3,
        ...overrides,
      } satisfies ModStorageProgress,
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockListen.mockReturnValue(Promise.resolve(vi.fn()));
  mockInvoke.mockResolvedValue({ ok: true, value: null });
});

describe("useModStorageToast", () => {
  it("opens one task for a conversion and names the direction", () => {
    mount();
    report();

    expect(toast.task).toHaveBeenCalledExactlyOnceWith("Unpacking Test Mod");
  });

  it("calls a repack by its own name", () => {
    mount();
    report({ storage: "archive" });

    expect(toast.task).toHaveBeenCalledExactlyOnceWith("Repacking Test Mod");
  });

  /* Every unit the backend unpacks arrives as its own event, and one mod is one
     toast, so a second event has to find the task the first opened. */
  it("keeps reporting into the task it already opened", () => {
    mount();
    report({ current: 0, total: 4 });
    report({ current: 1, total: 4, currentItem: "Ashe.wad.client" });

    expect(toast.task).toHaveBeenCalledTimes(1);
    expect(task.report).toHaveBeenLastCalledWith(25, "2 of 4 - Ashe.wad.client");
  });

  /* Two conversions can be in flight at once, and neither may report into the
     other's toast. */
  it("gives a second mod a task of its own", () => {
    mount([
      createMockInstalledMod(),
      createMockInstalledMod({ id: "other-mod", displayName: "Other Mod" }),
    ]);

    report();
    report({ modId: "other-mod" });

    expect(toast.task).toHaveBeenCalledTimes(2);
    expect(toast.task).toHaveBeenLastCalledWith("Unpacking Other Mod");
  });

  /* The finalizing pass has no count to divide, so the strip fills rather than
     dividing by a total of zero. */
  it("fills the strip for a step that carries no count", () => {
    mount();
    report({ stage: "finalizing", current: 0, total: 0, currentItem: null });

    expect(task.report).toHaveBeenCalledWith(100, "Finishing up");
  });

  it("closes the task and says what the mod now reads from", () => {
    mount();
    report();
    report({ stage: "complete" });

    expect(task.close).toHaveBeenCalled();
    expect(toast.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "success",
        title: "Mod unpacked",
        description: "Test Mod now reads from its own folder.",
      }),
    );
  });

  /* The reason a conversion failed is held by whoever asked for it, so a second
     toast here would be one with nothing to say. */
  it("closes the task on an error and announces nothing", () => {
    mount();
    report();
    report({ stage: "error" });

    expect(task.close).toHaveBeenCalled();
    expect(toast.toast).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("offers the finished mod's own directory to open", async () => {
    mount([createMockInstalledMod({ modDir: "/storage/mods/test-mod" })]);
    report({ stage: "complete" });

    const { action } = toast.toast.mock.calls[0][0];
    expect(action.label).toBe("Open Location");
    await act(async () => action.onClick());

    expect(mockInvoke).toHaveBeenCalledWith(commandNames.desktop.revealInExplorer, {
      path: "/storage/mods/test-mod",
    });
  });

  /* A conversion started from a card the user has since scrolled past still
     finishes, and the toast still has to name something. */
  it("stands in for a mod the cache cannot name", () => {
    mount([]);
    report({ stage: "complete" });

    expect(toast.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: "This mod now reads from its own folder." }),
    );
  });
});

// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components";
import type { HealthCheckReadiness } from "@/lib/tauri";
import { useLibraryDialogsStore, useLibrarySelectionStore } from "@/stores";

import { SelectionActionBar } from "../SelectionActionBar";
import { installedMod } from "./modHealthFixtures";

const useHealthCheckReadiness = vi.fn<() => HealthCheckReadiness>(() => "ready");
const sweep = vi.fn();
const setEnabled = vi.fn();
const patcherRunning = { running: false };

const MODS = [
  { ...installedMod("a", "Charizard Smolder"), enabled: true },
  { ...installedMod("b", "Pengu Graves"), enabled: false },
];

/* `useSelectionActions` reaches for these by their own paths rather than
   through the barrel, so the barrel is not what a mock has to stand in for. */
vi.mock("@/modules/library/api/modHealth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/library/api/modHealth")>()),
  useHealthCheckReadiness: () => useHealthCheckReadiness(),
  useSweepModHealth: () => ({ mutate: sweep, isPending: false }),
}));

vi.mock("@/modules/library/api/useSetModsEnabled", () => ({
  useSetModsEnabled: () => ({ setEnabled, isPending: false }),
}));

vi.mock("@/modules/library/api/queries", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/library/api/queries")>()),
  useInstalledMods: () => ({ data: MODS }),
}));

vi.mock("@/modules/patcher", () => ({
  usePatcherStatus: () => ({ data: patcherRunning }),
}));

const press = (name: RegExp) => screen.getByRole("button", { name });

function show(selected: string[]) {
  useLibrarySelectionStore.setState({ selectedIds: new Set(selected) });
  render(
    <ToastProvider>
      <SelectionActionBar visibleMods={[]} />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useHealthCheckReadiness.mockReturnValue("ready");
  patcherRunning.running = false;
  useLibraryDialogsStore.setState({ bulkUninstallMods: [] });
  useLibrarySelectionStore.setState({ selectedIds: new Set(), anchorId: null });
});

describe("SelectionActionBar", () => {
  it("checks the mods the reader picked, and nothing else", async () => {
    show(["b"]);

    await userEvent.click(press(/Check health/));

    expect(sweep.mock.calls[0][0]).toEqual(["b"]);
  });

  /* The run reports through its own progress toast, so the press is where the
     picks are spent - a popup closing on that press would take a completion
     callback with it. */
  it("drops the picks as the check takes them", async () => {
    show(["a", "b"]);

    await userEvent.click(press(/Check health/));

    expect(useLibrarySelectionStore.getState().selectedIds.size).toBe(0);
  });

  it("has nothing to check with an empty selection", () => {
    show([]);

    expect(press(/Check health/)).toBeDisabled();
  });

  it("does not offer the press before the hashtables are there", () => {
    useHealthCheckReadiness.mockReturnValue("unsynced");
    show(["a"]);

    expect(press(/Check health/)).toBeDisabled();
  });

  it("switches on the mods the reader picked", async () => {
    show(["b"]);

    await userEvent.click(press(/Enable 1/));

    expect(setEnabled).toHaveBeenCalledWith([MODS[1]], true);
  });

  it("switches off the mods the reader picked", async () => {
    show(["a"]);

    await userEvent.click(press(/Disable 1/));

    expect(setEnabled).toHaveBeenCalledWith([MODS[0]], false);
  });

  /* Everything picked is already on, so there is nothing the press would do. */
  it("offers no enable over a selection that is already on", () => {
    show(["a"]);

    expect(press(/Enable 1/)).toBeDisabled();
  });

  /* The confirmation reads the picks back before anything is deleted. */
  it("asks before it uninstalls", async () => {
    show(["a", "b"]);

    await userEvent.click(press(/Uninstall 2/));

    expect(useLibraryDialogsStore.getState().bulkUninstallMods).toEqual(MODS);
  });

  it("clears the selection on Escape", async () => {
    show(["a", "b"]);

    await userEvent.keyboard("{Escape}");

    expect(useLibrarySelectionStore.getState().selectedIds.size).toBe(0);
  });

  /* Escape in a dialog means "close this". Dropping the picks under it would
     spend a set the reader is still assembling. */
  it("leaves the selection alone on Escape under an open dialog", async () => {
    show(["a", "b"]);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);

    await userEvent.keyboard("{Escape}");
    dialog.remove();

    expect(useLibrarySelectionStore.getState().selectedIds.size).toBe(2);
  });

  /* The backend refuses every write to a mod under a running patcher, so a
     press that would only collect errors is not offered. */
  it("offers no write while the patcher runs", () => {
    patcherRunning.running = true;
    show(["a", "b"]);

    expect(press(/Enable 2/)).toBeDisabled();
    expect(press(/Disable 2/)).toBeDisabled();
    expect(press(/Uninstall 2/)).toBeDisabled();
    expect(press(/Check health 2/)).toBeEnabled();
  });
});

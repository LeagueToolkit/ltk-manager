// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components";
import {
  type DetectedInstallMismatch,
  useDialogQueueStore,
  useInstallMismatchStore,
  usePendingRebuildStore,
} from "@/stores";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { InstallMismatchDialog } from "../InstallMismatchDialog";

/** The dialog answers with toasts, so the viewport renders beside it. */
function renderDialog() {
  const queryClient = createTestQueryClient();
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }
  return render(<InstallMismatchDialog />, { wrapper });
}

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

const reporter: DetectedInstallMismatch = {
  configuredPath: "C:\\Riot Games\\League of Legends (PBE)",
  configuredPatchline: "pbe",
  sessionPath: "C:\\Riot Games\\League of Legends",
  sessionPatchline: "live",
};

function calls(command: string) {
  return mockInvoke.mock.calls.filter(([name]) => name === command);
}

describe("InstallMismatchDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInvoke.mockImplementation(() => Promise.resolve({ ok: true, value: null }));
    useInstallMismatchStore.setState({ mismatch: null, kept: false });
    usePendingRebuildStore.setState({ queued: true });
    useDialogQueueStore.setState({ current: null, claims: [] });
  });

  it("names both installs", async () => {
    useInstallMismatchStore.getState().raise(reporter);
    renderDialog();

    expect(await screen.findByText("A different League install is running")).toBeVisible();
    expect(screen.getByText("C:\\Riot Games\\League of Legends")).toBeVisible();
    expect(screen.getByText("C:\\Riot Games\\League of Legends (PBE)")).toBeVisible();
  });

  /// Keep is an answer for this patcher session. The check runs again at the
  /// next start, and only then may the dialog return.
  it("keeps the configured install for the patcher session", async () => {
    useInstallMismatchStore.getState().raise(reporter);
    renderDialog();

    await userEvent.click(await screen.findByRole("button", { name: "Keep PBE" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(calls("switch_league_install")).toHaveLength(0);
    expect(useInstallMismatchStore.getState().kept).toBe(true);

    useInstallMismatchStore.getState().raise(reporter);
    expect(useInstallMismatchStore.getState().mismatch).toBeNull();

    useInstallMismatchStore.getState().reset();
    useInstallMismatchStore.getState().raise(reporter);
    expect(useInstallMismatchStore.getState().mismatch).toEqual(reporter);
  });

  it("switches to the running install and toasts the new path", async () => {
    useInstallMismatchStore.getState().raise(reporter);
    renderDialog();

    await userEvent.click(await screen.findByRole("button", { name: "Switch to this install" }));

    await waitFor(() => expect(calls("switch_league_install")).toHaveLength(1));
    expect(calls("switch_league_install")[0]?.[1]).toEqual({
      installRoot: "C:\\Riot Games\\League of Legends",
    });
    expect(await screen.findByText("League path changed")).toBeVisible();
    await waitFor(() => expect(useInstallMismatchStore.getState().mismatch).toBeNull());
    expect(usePendingRebuildStore.getState().queued).toBe(false);
  });

  it("reports a switch that failed and stays up", async () => {
    mockInvoke.mockImplementation((command: string) => {
      if (command === "switch_league_install") {
        return Promise.resolve({
          ok: false,
          error: { code: "PATCHER", error: { kind: "BUSY" } },
        });
      }
      return Promise.resolve({ ok: true, value: null });
    });
    useInstallMismatchStore.getState().raise(reporter);
    renderDialog();

    await userEvent.click(await screen.findByRole("button", { name: "Switch to this install" }));

    expect(await screen.findByText("Couldn't switch the League install")).toBeVisible();
    expect(screen.getByText("A different League install is running")).toBeVisible();
    expect(useInstallMismatchStore.getState().mismatch).toEqual(reporter);
  });
});

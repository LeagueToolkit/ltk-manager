// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, type Mock } from "vitest";

import type { InstallMismatch, PatcherPhase } from "@/lib/tauri";
import { usePatcherStatus } from "@/modules/patcher";
import { useInstallMismatchStore } from "@/stores";
import { commandNames } from "@/test/commandNames";
import { mockInvoke, mockListen } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { useInstallMismatchWatch } from "../useInstallMismatchWatch";

type Handler = (event: { payload: unknown }) => void;

const handlers = new Map<string, Handler[]>();

async function emit(name: string, payload: unknown) {
  await act(async () => {
    for (const handler of handlers.get(name) ?? []) handler({ payload });
  });
}

const reporter: InstallMismatch = {
  configuredPath: "C:\\Riot Games\\League of Legends (PBE)",
  configuredPatchline: "pbe",
  sessionPath: "C:\\Riot Games\\League of Legends",
  sessionPatchline: "live",
};

/** Mounts the watch, and reports when the patcher status query has settled. */
function Watch() {
  useInstallMismatchWatch();
  const { data, isSuccess } = usePatcherStatus();
  return <div data-testid={isSuccess ? `phase-${data.phase}` : "phase-pending"} />;
}

function mockBackend(phase: PatcherPhase, mismatch: InstallMismatch | null) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === commandNames.patcher.getPatcherStatus) {
      return Promise.resolve({
        ok: true,
        value: { running: phase !== "idle", phase, session: null },
      });
    }
    if (cmd === commandNames.launcher.checkInstallMismatch) {
      return Promise.resolve({ ok: true, value: mismatch });
    }
    return Promise.resolve({ ok: true, value: null });
  });
}

function checks() {
  return mockInvoke.mock.calls.filter(([cmd]) => cmd === commandNames.launcher.checkInstallMismatch)
    .length;
}

async function mount(phase: PatcherPhase, mismatch: InstallMismatch | null) {
  mockBackend(phase, mismatch);
  const queryClient = createTestQueryClient();
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  render(<Watch />, { wrapper });
  await screen.findByTestId(`phase-${phase}`);
}

describe("useInstallMismatchWatch", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    handlers.clear();
    useInstallMismatchStore.setState({ mismatch: null, kept: true });
    (mockListen as Mock).mockImplementation((name: string, handler: Handler) => {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return Promise.resolve(() => {});
    });
  });

  /// The start is where a kept dialog may return, whichever surface started
  /// the patcher, so the check runs off the phase rather than off a button.
  it("checks when the patcher reaches patching and lets a kept dialog return", async () => {
    await mount("patching", reporter);

    await waitFor(() => expect(checks()).toBe(1));
    await waitFor(() => expect(useInstallMismatchStore.getState().mismatch).toEqual(reporter));
    expect(useInstallMismatchStore.getState().kept).toBe(false);
  });

  it("checks again when a session opens while the patcher runs", async () => {
    await mount("patching", null);
    await waitFor(() => expect(checks()).toBe(1));

    await emit("session-started", { phase: "Pending", running: false, version: "" });

    await waitFor(() => expect(checks()).toBe(2));
    expect(useInstallMismatchStore.getState().mismatch).toBeNull();
  });

  /// A Classic-mode game has no session watcher, so the DLL attaching to it
  /// is the sign the check runs on.
  it("checks when the DLL attaches to a game while the patcher runs", async () => {
    await mount("patching", null);
    await waitFor(() => expect(checks()).toBe(1));

    await emit("patcher-game-attached", { pid: 1234 });

    await waitFor(() => expect(checks()).toBe(2));
  });

  it("stays quiet while the patcher is stopped", async () => {
    await mount("idle", reporter);

    await emit("session-started", { phase: "Pending", running: false, version: "" });

    expect(checks()).toBe(0);
    expect(useInstallMismatchStore.getState().mismatch).toBeNull();
  });
});

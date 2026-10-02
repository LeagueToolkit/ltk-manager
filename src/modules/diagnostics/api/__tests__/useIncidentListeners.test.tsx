// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { ToastProvider } from "@/components";
import type { Hint, Incident, PatcherPhase } from "@/lib/tauri";
import { createMockIncident } from "@/modules/diagnostics/components/__tests__/fixtures";
import { usePatcherStatus } from "@/modules/patcher";
import { useInstallMismatchStore, usePendingRebuildStore } from "@/stores";
import { commandNames } from "@/test/commandNames";
import { createMockSettings } from "@/test/fixtures";
import { mockInvoke, mockListen } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { useIncidentListeners } from "../useIncidentListeners";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => vi.fn(),
}));

type Handler = (event: { payload: unknown }) => void;

const handlers = new Map<string, Handler[]>();

async function emit(name: string, payload: unknown) {
  await act(async () => {
    for (const handler of handlers.get(name) ?? []) handler({ payload });
  });
}

function incident(hints: Hint[]): Incident {
  return createMockIncident({
    redirected: ["Shaders.wad.client"],
    game: null,
    suspects: [],
    verdict: {
      ...createMockIncident().verdict,
      kind: "corrupt-archive",
      title: "WAD Mount Failure",
      cause: "League could not mount Shaders.wad.client.",
      subject: "Shaders.wad.client",
      hints,
    },
  });
}

/** Mounts the listeners, and reports when the patcher status query has settled. */
function Listeners() {
  useIncidentListeners();
  const { data, isSuccess } = usePatcherStatus();
  return <div data-testid={isSuccess ? `phase-${data.phase}` : "phase-pending"} />;
}

function mockPatcher(phase: PatcherPhase) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === commandNames.patcher.getPatcherStatus) {
      return Promise.resolve({
        ok: true,
        value: { running: phase !== "idle", phase, session: null },
      });
    }
    if (cmd === commandNames.settings.getSettings) {
      return Promise.resolve({
        ok: true,
        value: createMockSettings({ leaguePath: "C:\\Riot Games\\League of Legends (PBE)" }),
      });
    }
    return Promise.resolve({ ok: true, value: null });
  });
}

function invokedCommands() {
  return mockInvoke.mock.calls.map(([cmd]) => cmd as string);
}

/** Mounts the listeners and waits for the patcher status to settle. */
async function mount(phase: PatcherPhase) {
  mockPatcher(phase);
  const queryClient = createTestQueryClient();
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    );
  }
  render(<Listeners />, { wrapper });
  await screen.findByTestId(`phase-${phase}`);
}

describe("useIncidentListeners", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    handlers.clear();
    usePendingRebuildStore.setState({ queued: false });
    useInstallMismatchStore.setState({ mismatch: null, kept: false });
    (mockListen as Mock).mockImplementation((name: string, handler: Handler) => {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return Promise.resolve(() => {});
    });
  });

  it("rebuilds at once from the toast while the patcher is stopped", async () => {
    await mount("idle");

    await emit("incident-recorded", incident(["rebuild-overlay"]));

    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Rebuild overlay" }));

    await waitFor(() => expect(invokedCommands()).toContain(commandNames.patcher.rebuildOverlay));
    expect(usePendingRebuildStore.getState().queued).toBe(false);
  });

  /// The patcher keeps scanning after the game that died, so the rebuild waits
  /// for the next start rather than tearing the running overlay out.
  it("queues the rebuild for the next start while the patcher runs", async () => {
    await mount("patching");

    await emit("incident-recorded", incident(["rebuild-overlay"]));

    await userEvent.click(screen.getByRole("button", { name: "Rebuild on next start" }));

    expect(usePendingRebuildStore.getState().queued).toBe(true);
    expect(invokedCommands()).not.toContain(commandNames.patcher.rebuildOverlay);
  });

  /// The log is the backstop for a client that did not answer, so the verdict
  /// raises the same dialog the client check does, with the log's install.
  it("raises the install mismatch dialog on a wrong-install verdict", async () => {
    await mount("patching");
    const wrongInstall = createMockIncident({
      verdict: {
        ...createMockIncident().verdict,
        kind: "wrong-install",
        title: "Wrong League Install",
        hints: ["check-game-path"],
      },
    });

    await emit("incident-recorded", wrongInstall);

    await waitFor(() =>
      expect(useInstallMismatchStore.getState().mismatch).toEqual({
        configuredPath: "C:/Riot Games/League of Legends (PBE)",
        configuredPatchline: null,
        sessionPath: "C:\\Riot Games\\League of Legends",
        sessionPatchline: null,
      }),
    );
    expect(screen.queryByRole("button", { name: /Rebuild/ })).not.toBeInTheDocument();
  });

  it("offers no rebuild without the hint", async () => {
    await mount("idle");

    await emit("incident-recorded", incident(["check-game-path"]));

    expect(screen.getByRole("button", { name: "Details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Rebuild/ })).not.toBeInTheDocument();
  });
});

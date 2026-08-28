// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToastProvider } from "@/components";
import type { LaunchMode } from "@/lib/tauri";
import { useInstalledMods } from "@/modules/library";
import { usePatcherSessionStore, usePlaySessionStore } from "@/stores";
import { createMockInstalledMod, createMockSettings } from "@/test/fixtures";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { PlayButton } from "../PlayButton";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

interface BackendOptions {
  leagueRunning?: boolean;
  enabledMods?: boolean;
  launchMode?: LaunchMode;
  /** Reported by every `get_patcher_status` call, so a session never ends. */
  patcherRunning?: boolean;
  stopFails?: boolean;
  /** Whether the one enabled mod comes back with a repairable verdict. */
  brokenMods?: boolean;
}

function mockBackend({
  leagueRunning = false,
  enabledMods = true,
  launchMode = "classic",
  patcherRunning = false,
  stopFails = false,
  brokenMods = false,
}: BackendOptions = {}) {
  mockInvoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "get_platform_support":
        return Promise.resolve({ ok: true, value: { patcherAvailable: true } });
      case "get_settings":
        return Promise.resolve({
          ok: true,
          value: createMockSettings({ hasSeenHddWarning: true, launchMode }),
        });
      case "get_installed_mods":
        return Promise.resolve({
          ok: true,
          value: enabledMods ? [createMockInstalledMod({ enabled: true })] : [],
        });
      case "get_mod_health_verdicts":
        return Promise.resolve({
          ok: true,
          value: brokenMods
            ? {
                [createMockInstalledMod({ enabled: true }).id]: {
                  modId: createMockInstalledMod({ enabled: true }).id,
                  health: "repairable",
                  fixable: 3,
                  counts: { fatals: 3, errors: 0, warnings: 0, infos: 0 },
                  checkedAt: "2026-08-28T10:00:00Z",
                  basis: { build: null, manager: "test" },
                },
              }
            : {},
        });
      case "get_patcher_status":
        return Promise.resolve({
          ok: true,
          value: {
            running: patcherRunning,
            session: null,
            phase: patcherRunning ? "patching" : "idle",
          },
        });
      case "stop_patcher":
        if (stopFails) {
          return Promise.resolve({
            ok: false,
            error: { code: "PATCHER", message: "not running" },
          });
        }
        return Promise.resolve({ ok: true, value: null });
      case "get_launch_availability":
        return Promise.resolve({
          ok: true,
          value: {
            canLaunch: true,
            riotClientPath: "C:\\Riot\\RiotClientServices.exe",
            riotClientRunning: leagueRunning,
            leagueRunning,
          },
        });
      default:
        return Promise.resolve({ ok: true, value: null });
    }
  });
}

function invokedCommands() {
  return mockInvoke.mock.calls.map(([cmd]) => cmd as string);
}

/**
 * Reports when the mod list has settled.
 *
 * The button is disabled while that query is in flight, so a disabled-state
 * assertion would otherwise pass on the loading state instead of the one it
 * means to test.
 */
function ModsProbe() {
  const { isSuccess } = useInstalledMods();
  return <div data-testid={isSuccess ? "mods-ready" : "mods-pending"} />;
}

describe("PlayButton", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    usePlaySessionStore.setState({ step: "idle" });
    usePatcherSessionStore.setState({ stopping: false });
  });

  /**
   * The regression this guards: `stop_patcher` returns the moment it sets its
   * stop flag, so a button keyed to the mutation's own pending state went back
   * to offering "Stop Patcher" while the session was still unwinding, then
   * snapped to idle seconds later when the status poll caught up.
   *
   * The status here never stops reporting `running`, so anything that clears on
   * the mutation settling fails this.
   */
  it("keeps showing a stopping state while the patcher is still unwinding", async () => {
    mockBackend({ patcherRunning: true });
    const user = userEvent.setup();
    render(<PlayButton />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "Stop Patcher" }));

    await screen.findByRole("button", { name: "Stopping..." });
    expect(invokedCommands()).toContain("stop_patcher");

    // Well past the mutation settling, with the backend still reporting a live
    // session.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByRole("button", { name: "Stopping..." })).toBeDisabled();
  });

  /// A stop that the backend refuses - the ordinary `NotRunning` race - must not
  /// strand the button spinning on work that is not happening.
  it("drops the stopping state when the stop itself fails", async () => {
    mockBackend({ patcherRunning: true, stopFails: true });
    const user = userEvent.setup();
    render(<PlayButton />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "Stop Patcher" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "Stop Patcher" })).toBeEnabled());
  });

  it("plays when nothing is running yet", async () => {
    mockBackend({ launchMode: "modern" });
    render(<PlayButton />, { wrapper });

    await waitFor(() => expect(screen.getByRole("button", { name: "Play" })).toBeEnabled());
  });

  /// Launching is a no-op with the client up, so the click that remains is the
  /// patcher's - and a button still labelled "Play" would promise a launch.
  it("becomes a patcher button once League is running", async () => {
    mockBackend({ launchMode: "modern", leagueRunning: true });
    render(<PlayButton />, { wrapper });

    // Re-queried rather than reused: settings arriving swaps the bare button for
    // the split one, and the node found before that is detached by the time it
    // would be clicked.
    await screen.findByRole("button", { name: "More launch options" });
    await userEvent.click(screen.getByRole("button", { name: "Start Patcher" }));

    await waitFor(() => expect(invokedCommands()).toContain("start_patcher"));
    expect(invokedCommands()).not.toContain("launch_league");
  });

  /// Neither half has anything to do: no mods to apply, and no launch to make.
  it("has nothing to offer with League running and no mods enabled", async () => {
    mockBackend({ launchMode: "modern", leagueRunning: true, enabledMods: false });
    render(
      <>
        <ModsProbe />
        <PlayButton />
      </>,
      { wrapper },
    );

    await screen.findByTestId("mods-ready");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start Patcher" })).toBeDisabled(),
    );
  });

  /// Classic mode is the setting for people who start League themselves, so the
  /// button must not reach for the Riot Client on their behalf.
  it("starts the patcher without launching in classic mode", async () => {
    mockBackend();
    render(<PlayButton />, { wrapper });

    const button = await screen.findByRole("button", { name: "Start Patcher" });
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);

    await waitFor(() => expect(invokedCommands()).toContain("start_patcher"));
    expect(invokedCommands()).not.toContain("launch_league");
  });

  /// Classic is the app as it was before it could launch, so there is no
  /// launcher hiding behind a dropdown either.
  it("has no launch menu at all in classic mode", async () => {
    mockBackend();
    render(<PlayButton />, { wrapper });

    await screen.findByRole("button", { name: "Start Patcher" });
    expect(screen.queryByRole("button", { name: "More launch options" })).not.toBeInTheDocument();
  });

  /* A launch without the patcher carries no mods, so warning about broken ones
     would teach the reader to press through the warning that matters. */
  it("does not ask about broken mods for a launch that carries none", async () => {
    const user = userEvent.setup();
    mockBackend({ launchMode: "modern", brokenMods: true });
    render(<PlayButton />, { wrapper });

    await user.click(await screen.findByRole("button", { name: "More launch options" }));
    await user.click(await screen.findByRole("menuitem", { name: /Launch League only/ }));

    await waitFor(() => expect(invokedCommands()).toContain("launch_league"));
    expect(screen.queryByText(/Launch with/)).not.toBeInTheDocument();
  });

  /* The same list, and the press that does carry them still asks. */
  it("still asks about broken mods for the play that carries them", async () => {
    const user = userEvent.setup();
    mockBackend({ launchMode: "modern", brokenMods: true });
    render(<PlayButton />, { wrapper });

    await user.click(await screen.findByRole("button", { name: /^Play/ }));

    expect(await screen.findByText(/Launch with 1 broken mod/)).toBeInTheDocument();
    expect(invokedCommands()).not.toContain("launch_league");
  });
});

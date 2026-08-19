import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToastProvider } from "@/components";
import type { LaunchRoute, PatcherPhase } from "@/lib/bindings";
import { useInstalledMods } from "@/modules/library";
import { usePlaySessionStore } from "@/stores";
import { createMockInstalledMod, createMockSettings } from "@/test/fixtures";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { usePlay } from "../usePlay";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

/**
 * `useGuardedStartPatcher` reads the installed mods to filter skinhacks, and
 * treats an empty list as "nothing to apply" - so a play issued before the
 * library query settles would no-op for a reason unrelated to what these tests
 * are about. Every case waits for the library first.
 */
async function renderPlay() {
  const view = renderHook(() => ({ play: usePlay(), mods: useInstalledMods() }), { wrapper });
  await waitFor(() => expect(view.result.current.mods.isSuccess).toBe(true));
  return view;
}

/**
 * Answers every command the flow touches. `phases` is consumed one entry per
 * `get_patcher_status` poll, so a test spells out the exact lifecycle it wants
 * the patcher to walk; the last entry repeats once exhausted.
 */
function mockBackend(phases: PatcherPhase[], route: LaunchRoute = "EXISTING_CLIENT") {
  const remaining = [...phases];

  mockInvoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "get_settings":
        // Already seen, so the HDD check short-circuits instead of probing disks.
        return Promise.resolve({
          ok: true,
          value: createMockSettings({ hasSeenHddWarning: true }),
        });
      case "get_installed_mods":
        return Promise.resolve({ ok: true, value: [createMockInstalledMod({ enabled: true })] });
      case "start_patcher":
        return Promise.resolve({ ok: true, value: null });
      case "get_patcher_status": {
        const phase = remaining.length > 1 ? remaining.shift()! : remaining[0];
        return Promise.resolve({
          ok: true,
          value: { running: phase !== "idle", phase, session: null },
        });
      }
      case "launch_league":
        return Promise.resolve({ ok: true, value: { route, riotClientPid: 1234 } });
      default:
        return Promise.resolve({ ok: true, value: null });
    }
  });
}

function invokedCommands() {
  return mockInvoke.mock.calls.map(([cmd]) => cmd as string);
}

describe("usePlay", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    // The step lives in a module-level store now, so a run that ended
    // mid-flight would silently gate every later test's play().
    usePlaySessionStore.setState({ step: "idle" });
  });

  it("arms the patcher before asking the Riot Client to launch", async () => {
    mockBackend(["patching"]);
    const { result } = await renderPlay();

    await act(async () => {
      await result.current.play.play();
    });

    const commands = invokedCommands();
    expect(commands).toContain("start_patcher");
    expect(commands).toContain("launch_league");
    expect(commands.indexOf("start_patcher")).toBeLessThan(commands.indexOf("launch_league"));
  });

  /// A build that fails drops the patcher back to idle. Launching anyway would
  /// start an unmodded game while the user believes their mods are on.
  it("does not launch when the overlay build fails", async () => {
    mockBackend(["building", "idle"]);
    const { result } = await renderPlay();

    await act(async () => {
      await result.current.play.play();
    });

    expect(invokedCommands()).toContain("start_patcher");
    expect(invokedCommands()).not.toContain("launch_league");
  });

  /// The two halves stay independently invokable - this is the "I launch League
  /// myself" and "I want the game without mods" path.
  it("launchOnly starts no patcher", async () => {
    mockBackend(["idle"]);
    const { result } = await renderPlay();

    await act(async () => {
      await result.current.play.launchOnly();
    });

    expect(invokedCommands()).toContain("launch_league");
    expect(invokedCommands()).not.toContain("start_patcher");
  });

  it("keeps the patcher when League is already running", async () => {
    mockBackend(["patching"], "ALREADY_RUNNING");
    const { result } = await renderPlay();

    await act(async () => {
      await result.current.play.play();
    });

    expect(invokedCommands()).toContain("start_patcher");
    expect(screen.queryByText("Couldn't launch League")).toBeNull();
  });

  it("launchOnly says when there was nothing to launch", async () => {
    mockBackend(["idle"], "ALREADY_RUNNING");
    const { result } = await renderPlay();

    await act(async () => {
      await result.current.play.launchOnly();
    });

    expect(await screen.findByText("League is already running")).toBeInTheDocument();
  });

  it("clears the busy step once the launch settles", async () => {
    mockBackend(["patching"]);
    const { result } = await renderPlay();

    await act(async () => {
      await result.current.play.play();
    });

    await waitFor(() => {
      expect(result.current.play.step).toBe("idle");
      expect(result.current.play.isBusy).toBe(false);
    });
  });

  /// The backend mutex is the real guarantee, but a second in-flight call must
  /// not reach it in the first place.
  it("ignores a second play while one is already running", async () => {
    mockBackend(["patching"]);
    const { result } = await renderPlay();

    await act(async () => {
      await Promise.all([result.current.play.play(), result.current.play.play()]);
    });

    const launches = invokedCommands().filter((cmd) => cmd === "launch_league");
    expect(launches).toHaveLength(1);
  });
});

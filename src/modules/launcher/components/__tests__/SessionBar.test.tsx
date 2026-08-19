import { act, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, type Mock } from "vitest";

import type { LaunchProgress, OverlayProgress, PatcherPhase } from "@/lib/bindings";
import { usePatcherStatus } from "@/modules/patcher";
import { usePlaySessionStore } from "@/stores";
import { mockInvoke, mockListen } from "@/test/mocks/tauri";
import { renderWithProviders } from "@/test/utils";

import { SessionBar } from "../SessionBar";

type Handler = (event: { payload: unknown }) => void;

/** Reports when the patcher status query has actually settled. */
function PhaseProbe() {
  const { data, isSuccess } = usePatcherStatus();
  return <div data-testid={isSuccess ? `phase-${data.phase}` : "phase-pending"}>phase-probe</div>;
}

const handlers = new Map<string, Handler[]>();

/** Deliver a backend event to whatever the bar subscribed with. */
async function emit(name: string, payload: unknown) {
  await act(async () => {
    for (const handler of handlers.get(name) ?? []) handler({ payload });
  });
}

function mockPatcher(phase: PatcherPhase, patcherAvailable = true, leagueRunning = false) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === "get_patcher_status") {
      return Promise.resolve({
        ok: true,
        value: { running: phase !== "idle", phase, session: null },
      });
    }
    if (cmd === "get_platform_support") {
      return Promise.resolve({ ok: true, value: { patcherAvailable } });
    }
    if (cmd === "get_launch_availability") {
      return Promise.resolve({
        ok: true,
        value: {
          canLaunch: true,
          riotClientPath: null,
          riotClientRunning: leagueRunning,
          leagueRunning,
        },
      });
    }
    return Promise.resolve({ ok: true, value: null });
  });
}

/** Renders and waits for the patcher status query to land. */
async function renderBar(phase: PatcherPhase) {
  mockPatcher(phase);
  const view = renderWithProviders(<SessionBar />);
  if (phase !== "idle") await screen.findByText(/Build overlay|Patcher running/);
  return view;
}

const waiting: LaunchProgress = {
  stage: "waitingForClient",
  waitedSecs: 12,
  timeoutSecs: 60,
};

const patching: OverlayProgress = {
  stage: "patching",
  currentFile: "Aatrox.wad.client",
  current: 3,
  total: 10,
};

describe("SessionBar", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    handlers.clear();
    usePlaySessionStore.setState({ step: "idle" });

    // `mockListen` is declared with no parameters, so reaching its arguments
    // needs the same cast the other event tests use.
    (mockListen as Mock).mockImplementation((name: string, handler: Handler) => {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      return Promise.resolve(() => {});
    });
  });

  /// The bar is permanent app chrome, so "no session" is a state it reports
  /// rather than a reason to unmount.
  it("rests on the idle patcher state when there is no session", async () => {
    mockPatcher("idle");
    // Rendered beside the bar so the assertion runs against a *settled* idle
    // status rather than a query that simply has not answered yet.
    renderWithProviders(
      <>
        <PhaseProbe />
        <SessionBar />
      </>,
    );

    await screen.findByTestId("phase-idle");
    expect(screen.getByText("Patcher idle")).toBeInTheDocument();
    // The stepper belongs to an active session, not to the resting state.
    expect(screen.queryByText("Build overlay")).not.toBeInTheDocument();
    expect(screen.queryByText("Launch League")).not.toBeInTheDocument();
  });

  /// "Start the patcher to apply your mods" reads as too late when the client
  /// is already open, so the idle line names the game the mods will land in.
  it("says which game the mods reach when League is already running", async () => {
    mockPatcher("idle", true, true);
    renderWithProviders(
      <>
        <PhaseProbe />
        <SessionBar />
      </>,
    );

    await screen.findByTestId("phase-idle");
    expect(await screen.findByText(/League is running - start the patcher/i)).toBeInTheDocument();
  });

  /// On a platform with no patcher, "idle" is permanent and unactionable, so
  /// the resting line would be a standing piece of noise.
  it("stays out of the way when the patcher is unavailable", async () => {
    mockPatcher("idle", false);
    const { container } = renderWithProviders(
      <>
        <PhaseProbe />
        <SessionBar />
      </>,
    );

    await screen.findByTestId("phase-idle");
    await waitFor(() => {
      expect(container.textContent).toBe("phase-probe");
    });
  });

  it("shows the build stage and its counts while the overlay is building", async () => {
    await renderBar("building");
    await emit("overlay-progress", patching);

    expect(screen.getByText("Patching WAD files...")).toBeInTheDocument();
    expect(screen.getByText("3 / 10")).toBeInTheDocument();
    expect(screen.getByText("Aatrox.wad.client")).toBeInTheDocument();
  });

  /// A patcher started on its own - Ctrl+P, or the always-start setting - is
  /// not going to launch anything, so offering the step would be a lie.
  it("omits the launch step when no launch was asked for", async () => {
    await renderBar("building");

    expect(screen.getByText("Build overlay")).toBeInTheDocument();
    expect(screen.queryByText("Launch League")).not.toBeInTheDocument();
  });

  /// The reason this whole bar exists: the client can take most of a minute to
  /// come up, and the wait has to say what it is waiting for.
  it("explains the wait for the Riot Client, with the seconds elapsed", async () => {
    usePlaySessionStore.setState({ step: "launching" });
    await renderBar("patching");
    await emit("launch-progress", waiting);

    expect(screen.getByText("Launch League")).toBeInTheDocument();
    expect(
      screen.getByText("Waiting for the Riot Client to finish starting up..."),
    ).toBeInTheDocument();
    expect(screen.getByText("12s")).toBeInTheDocument();
  });

  /// "Launch League only" runs no patcher, so the build and patcher steps are
  /// not part of that session at all.
  it("shows only the launch step for a launch with no patcher", async () => {
    usePlaySessionStore.setState({ step: "launching" });
    await renderBar("idle");
    await emit("launch-progress", { stage: "handingOff", waitedSecs: 0, timeoutSecs: 0 });

    expect(screen.getByText("Launch League")).toBeInTheDocument();
    expect(screen.queryByText("Build overlay")).not.toBeInTheDocument();
    expect(screen.queryByText("Start patcher")).not.toBeInTheDocument();
  });

  /// Once the session settles the stepper has nothing left to say, and leaving
  /// it up for a whole game is noise.
  it("collapses to a resting line once the patcher is up and nothing is launching", async () => {
    await renderBar("patching");

    expect(screen.getByText("Patcher running")).toBeInTheDocument();
    expect(screen.getByText(/mods will be applied when League starts/i)).toBeInTheDocument();
    expect(screen.queryByText("Build overlay")).not.toBeInTheDocument();
  });

  it("marks the launch step failed when the launch errors", async () => {
    usePlaySessionStore.setState({ step: "launching" });
    await renderBar("patching");
    await emit("launch-progress", { stage: "error", waitedSecs: 0, timeoutSecs: 0 });

    expect(screen.getByText("Could not start League.")).toBeInTheDocument();
  });
});

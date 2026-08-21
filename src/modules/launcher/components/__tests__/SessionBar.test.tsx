import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import type { Incident, LaunchProgress, OverlayProgress, PatcherPhase } from "@/lib/bindings";
import { usePatcherStatus } from "@/modules/patcher";
import { useIncidentLineStore, usePatcherFailureStore, usePlaySessionStore } from "@/stores";
import { mockInvoke, mockListen } from "@/test/mocks/tauri";
import { renderWithProviders } from "@/test/utils";

import { SessionBar } from "../SessionBar";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mockNavigate,
}));

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

/** Renders beside the probe and waits for a settled idle status. */
async function renderIdleBar() {
  mockPatcher("idle");
  const view = renderWithProviders(
    <>
      <PhaseProbe />
      <SessionBar />
    </>,
  );
  await screen.findByTestId("phase-idle");
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

const missingData: Incident = {
  id: "2026-08-21T21-14-02",
  startedAt: "2026-08-21T19:14:02Z",
  endedAt: "2026-08-21T19:14:14Z",
  origin: { kind: "library" },
  injected: true,
  overlay: "live",
  redirected: ["Aatrox.wad.client"],
  skipped: [],
  launch: "match",
  scan: "eager",
  scanStatus: null,
  game: null,
  ending: { exitReason: "Interrupt", exitCode: -1073741819, crashed: true },
  verdict: {
    kind: "missing-data",
    title: "Missing data",
    cause: "League stopped a read it could not finish.",
    subject: "Aatrox.wad.client",
    confidence: "likely",
    hints: [],
  },
  evidence: [],
  suspects: [
    {
      modId: "aatrox-justicar",
      projectPath: null,
      displayName: "Aatrox Justicar",
      because: "writes Aatrox.wad.client, which holds the path",
      confidence: "likely",
    },
    {
      modId: "classic-rift",
      projectPath: null,
      displayName: "Classic Rift",
      because: "writes Map11.wad.client, redirected this game",
      confidence: "lead",
    },
  ],
  dismissed: false,
};

describe("SessionBar", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockNavigate.mockReset();
    handlers.clear();
    usePlaySessionStore.setState({ step: "idle" });
    useIncidentLineStore.setState({ incident: null, answeredIncidentId: null });
    usePatcherFailureStore.setState({ failure: null });

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
    // Rendered beside the bar so the assertion runs against a *settled* idle
    // status rather than a query that simply has not answered yet.
    await renderIdleBar();

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

  describe("the verdict line", () => {
    /// A crash is a question the player comes back to, so the bar keeps the
    /// answer where the idle line would be: the verdict, what it is about, who
    /// it names, and how sure it is.
    it("keeps the last game's verdict in the idle line's place", async () => {
      useIncidentLineStore.setState({ incident: missingData });
      await renderIdleBar();

      expect(screen.getByText("League closed")).toBeInTheDocument();
      expect(screen.getByText("Missing data")).toBeInTheDocument();
      expect(screen.getByText("Aatrox.wad.client")).toBeInTheDocument();
      expect(screen.getByText("Aatrox Justicar")).toBeInTheDocument();
      expect(screen.getByText("+1")).toBeInTheDocument();
      expect(screen.getByText("likely")).toBeInTheDocument();
      expect(screen.queryByText("Patcher idle")).not.toBeInTheDocument();
    });

    /// A verdict that states facts carries no confidence, and the line must not
    /// invent one.
    it("skips the confidence chip and the suspect when the verdict has neither", async () => {
      useIncidentLineStore.setState({
        incident: {
          ...missingData,
          suspects: [],
          verdict: {
            kind: "unmodded",
            title: "Unmodded game",
            cause: "No mod was in the game.",
            subject: null,
            confidence: null,
            hints: [],
          },
        },
      });
      await renderIdleBar();

      expect(screen.getByText("Unmodded game")).toBeInTheDocument();
      expect(screen.queryByText(/likely|confirmed|lead/)).not.toBeInTheDocument();
      expect(screen.queryByText("Aatrox Justicar")).not.toBeInTheDocument();
    });

    it("opens the Games tab on the incident from Details", async () => {
      useIncidentLineStore.setState({ incident: missingData });
      await renderIdleBar();

      await userEvent.click(screen.getByRole("button", { name: "Details" }));

      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/diagnostics",
        search: { tab: "games", incident: missingData.id },
      });
    });

    /// The close is the user's statement that they have read it, so it is
    /// recorded on the incident and not only cleared from the bar.
    it("dismisses the incident and gives the idle line back", async () => {
      useIncidentLineStore.setState({ incident: missingData });
      await renderIdleBar();

      await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      expect(await screen.findByText("Patcher idle")).toBeInTheDocument();
      expect(mockInvoke).toHaveBeenCalledWith("dismiss_incident", { id: missingData.id });
    });

    /// The bar's job is the present. The incident waits on the Games tab.
    it("yields to a build that starts", async () => {
      useIncidentLineStore.setState({ incident: missingData });
      await renderBar("building");

      expect(screen.getByText("Build overlay")).toBeInTheDocument();
      expect(screen.queryByText("League closed")).not.toBeInTheDocument();
    });
  });

  describe("the failed start line", () => {
    /// Antivirus, a declined UAC prompt and a missing binary are what the
    /// System checks look for, so a host that did not start points there.
    it("names a host that did not start and points at the System tab", async () => {
      usePatcherFailureStore.setState({
        failure: { stage: "HOST", message: "cslol-host.exe exited before it was ready" },
      });
      await renderIdleBar();

      expect(screen.getByText("The injection host did not start")).toBeInTheDocument();
      expect(screen.getByText("cslol-host.exe exited before it was ready")).toBeInTheDocument();
      expect(screen.queryByText("Patcher idle")).not.toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/diagnostics",
        search: { tab: "system" },
      });
    });

    /// A DLL that did not attach is the incident's business.
    it("names a DLL that did not attach and points at the Games tab", async () => {
      usePatcherFailureStore.setState({
        failure: { stage: "INJECTION", message: "DLL never attached after 60s" },
      });
      await renderIdleBar();

      expect(screen.getByText("The DLL did not attach to League")).toBeInTheDocument();

      await userEvent.click(screen.getByRole("button", { name: "Diagnostics" }));
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/diagnostics",
        search: { tab: "games" },
      });
    });

    it("names a build that failed", async () => {
      usePatcherFailureStore.setState({
        failure: { stage: "BUILD", message: "WAD error: Aatrox.wad.client is truncated" },
      });
      await renderIdleBar();

      expect(screen.getByText("The overlay build failed")).toBeInTheDocument();
      expect(screen.getByText("WAD error: Aatrox.wad.client is truncated")).toBeInTheDocument();
    });

    it("closes on the cross", async () => {
      usePatcherFailureStore.setState({
        failure: { stage: "HOST", message: "cslol-host.exe exited before it was ready" },
      });
      await renderIdleBar();

      await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

      expect(await screen.findByText("Patcher idle")).toBeInTheDocument();
      expect(usePatcherFailureStore.getState().failure).toBeNull();
    });

    /// A build that starts is the user trying again, and the start that failed
    /// before it is history.
    it("clears when the next build starts", async () => {
      usePatcherFailureStore.setState({
        failure: { stage: "BUILD", message: "WAD error: Aatrox.wad.client is truncated" },
      });
      await renderBar("building");

      await waitFor(() => {
        expect(usePatcherFailureStore.getState().failure).toBeNull();
      });
    });

    /// The incident is the classified record of the same failure, with the
    /// suspects and the evidence the raw error lacks.
    it("is outranked by the incident that classifies it", async () => {
      usePatcherFailureStore.setState({
        failure: { stage: "HOST", message: "cslol-host.exe exited before it was ready" },
      });
      useIncidentLineStore.setState({ incident: missingData });
      await renderIdleBar();

      expect(screen.getByText("League closed")).toBeInTheDocument();
      expect(screen.queryByText("The injection host did not start")).not.toBeInTheDocument();
    });
  });
});

// @vitest-environment happy-dom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { commandNames } from "@/test/commandNames";
import { mockInvoke } from "@/test/mocks/tauri";

import { GamesTab } from "../GamesTab";
import { createMockIncident, onDay, renderWithApp } from "./fixtures";

const { mockNavigate, search } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  search: { incident: undefined as string | undefined },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => search,
}));

function mockBackend(incidents: ReturnType<typeof createMockIncident>[]) {
  mockInvoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case commandNames.diagnostics.listIncidents:
        return Promise.resolve({ ok: true, value: incidents });
      case commandNames.diagnostics.dismissAllIncidents:
        for (const incident of incidents) incident.dismissed = true;
        return Promise.resolve({ ok: true, value: incidents.map((incident) => incident.id) });
      case commandNames.library.getInstalledMods:
        return Promise.resolve({ ok: true, value: [] });
      case commandNames.patcher.getPatcherStatus:
        return Promise.resolve({
          ok: true,
          value: { running: false, phase: "idle", session: null },
        });
      case commandNames.diagnostics.incidentReport:
        return Promise.resolve({ ok: true, value: "# report" });
      case commandNames.diagnostics.incidentToken:
        return Promise.resolve({ ok: true, value: "DIAG1-abc" });
      default:
        return Promise.resolve({ ok: true, value: null });
    }
  });
}

describe("GamesTab", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockNavigate.mockReset();
    search.incident = undefined;
  });

  /// The empty tab is a new player's first explanation of the feature, so it
  /// says what lands here and not only that nothing has yet.
  it("explains itself when no game has gone wrong", async () => {
    mockBackend([]);
    renderWithApp(<GamesTab />);

    expect(
      await screen.findByText(
        "No game has gone wrong while the patcher ran. When one does, what the manager learned about it lands here.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decode a token" })).toBeInTheDocument();
  });

  it("opens on the newest incident when the URL names none", async () => {
    const newest = createMockIncident({ id: "newest", endedAt: onDay(0, 21, 14) });
    const older = createMockIncident({
      id: "older",
      endedAt: onDay(1, 22, 40),
      verdict: { ...newest.verdict, title: "Loading Screen Stall", kind: "stuck-loading" },
    });
    mockBackend([newest, older]);
    renderWithApp(<GamesTab />);

    const rows = await screen.findAllByRole("option");
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("heading", { level: 2, name: "Missing Game Data" }),
    ).toBeInTheDocument();
  });

  /// A toast, a badge or the session bar hands over an id in the URL, and the
  /// tab lands on that row rather than the newest.
  it("opens on the incident the URL names", async () => {
    const newest = createMockIncident({ id: "newest", endedAt: onDay(0, 21, 14) });
    const older = createMockIncident({
      id: "older",
      endedAt: onDay(1, 22, 40),
      verdict: { ...newest.verdict, title: "Loading Screen Stall", kind: "stuck-loading" },
    });
    search.incident = "older";
    mockBackend([newest, older]);
    renderWithApp(<GamesTab />);

    expect(
      await screen.findByRole("heading", { level: 2, name: "Loading Screen Stall" }),
    ).toBeInTheDocument();
  });

  /// One press is one round trip, and the rows stay in the list dimmed rather
  /// than gone.
  it("dismisses every incident in one press and keeps the rows", async () => {
    const newest = createMockIncident({ id: "newest", endedAt: onDay(0, 21, 14) });
    const older = createMockIncident({ id: "older", endedAt: onDay(1, 22, 40) });
    mockBackend([newest, older]);
    const user = userEvent.setup();
    renderWithApp(<GamesTab />);

    const button = await screen.findByRole("button", { name: "Dismiss all" });
    expect(button).toBeEnabled();
    await user.click(button);

    expect(mockInvoke.mock.calls.map((call) => call[0])).toContain(
      commandNames.diagnostics.dismissAllIncidents,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Dismiss all" })).toBeDisabled());
    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  it("disables Dismiss all while nothing is undismissed", async () => {
    mockBackend([createMockIncident({ id: "read", endedAt: onDay(0, 21, 14), dismissed: true })]);
    renderWithApp(<GamesTab />);

    expect(await screen.findByRole("button", { name: "Dismiss all" })).toBeDisabled();
  });

  it("writes a click on a row back into the URL", async () => {
    const newest = createMockIncident({ id: "newest", endedAt: onDay(0, 21, 14) });
    const older = createMockIncident({ id: "older", endedAt: onDay(1, 22, 40) });
    mockBackend([newest, older]);
    const user = userEvent.setup();
    renderWithApp(<GamesTab />);

    const rows = await screen.findAllByRole("option");
    await user.click(rows[1]);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0][0] as {
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
      replace: boolean;
    };
    expect(call.replace).toBe(true);
    expect(call.search({ tab: "games" })).toEqual({ tab: "games", incident: "older" });
  });
});

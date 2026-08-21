import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { mockInvoke } from "@/test/mocks/tauri";

import { GamesTab } from "../GamesTab";
import { createMockIncident, onDay, renderWithApp } from "./fixtures";

beforeAll(() => {
  // jsdom lays nothing out, so it ships no scrollIntoView to keep the row in view.
  Element.prototype.scrollIntoView = vi.fn();
});

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
      case "list_incidents":
        return Promise.resolve({ ok: true, value: incidents });
      case "get_installed_mods":
        return Promise.resolve({ ok: true, value: [] });
      case "get_patcher_status":
        return Promise.resolve({
          ok: true,
          value: { running: false, phase: "idle", session: null },
        });
      case "incident_report":
        return Promise.resolve({ ok: true, value: "# report" });
      case "incident_token":
        return Promise.resolve({ ok: true, value: "LTK1-abc" });
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

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockInstalledMod } from "@/test/fixtures";
import { mockInvoke } from "@/test/mocks/tauri";

import { IncidentDetail } from "../IncidentDetail";
import { createMockIncident, renderWithApp } from "./fixtures";

const { mockNavigate } = vi.hoisted(() => ({ mockNavigate: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

function mockBackend({ patcherRunning = false, modEnabled = true } = {}) {
  mockInvoke.mockImplementation((cmd: string) => {
    switch (cmd) {
      case "get_installed_mods":
        return Promise.resolve({
          ok: true,
          value: [
            createMockInstalledMod({
              id: "mod-aatrox",
              displayName: "Aatrox Justicar",
              enabled: modEnabled,
            }),
          ],
        });
      case "get_patcher_status":
        return Promise.resolve({
          ok: true,
          value: {
            running: patcherRunning,
            phase: patcherRunning ? "patching" : "idle",
            session: null,
          },
        });
      case "incident_report":
        return Promise.resolve({ ok: true, value: "# LTK Manager - League diagnostics" });
      case "incident_token":
        return Promise.resolve({ ok: true, value: "LTK1-abc" });
      default:
        return Promise.resolve({ ok: true, value: null });
    }
  });
}

describe("IncidentDetail", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockNavigate.mockReset();
  });

  /// The suspect row is where a player acts, so it carries the name, the
  /// reason it is named, and the one action that answers it.
  it("renders a library suspect with its reason and a Disable action", async () => {
    mockBackend();
    renderWithApp(<IncidentDetail incident={createMockIncident()} />);

    expect(screen.getByText("Aatrox Justicar")).toBeInTheDocument();
    expect(screen.getByText("writes Aatrox.wad.client, which holds the path")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Disable" })).toBeEnabled();
  });

  it("disables the mod through the library when Disable is clicked", async () => {
    mockBackend();
    const user = userEvent.setup();
    renderWithApp(<IncidentDetail incident={createMockIncident()} />);

    await user.click(await screen.findByRole("button", { name: "Disable" }));

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("toggle_mod", {
        modId: "mod-aatrox",
        enabled: false,
      });
    });
  });

  /// A mod cannot come out of a running overlay, so the action waits.
  it("holds Disable while the patcher runs", async () => {
    mockBackend({ patcherRunning: true });
    renderWithApp(<IncidentDetail incident={createMockIncident()} />);

    expect(await screen.findByRole("button", { name: "Disable" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Rebuild overlay" })).toBeDisabled();
  });

  it("says Disabled for a suspect that is already off", async () => {
    mockBackend({ modEnabled: false });
    renderWithApp(<IncidentDetail incident={createMockIncident()} />);

    expect(await screen.findByRole("button", { name: "Disabled" })).toBeDisabled();
  });

  it("opens a workshop project by its directory name", async () => {
    mockBackend();
    const user = userEvent.setup();
    const incident = createMockIncident({
      origin: { kind: "workshop", projects: ["C:\\mods\\aatrox-justicar"] },
      suspects: [
        {
          modId: null,
          projectPath: "C:\\mods\\aatrox-justicar",
          displayName: "Aatrox Justicar",
          because: "writes Aatrox.wad.client, which holds the path",
        },
      ],
    });
    renderWithApp(<IncidentDetail incident={incident} />);

    await user.click(screen.getByRole("button", { name: "Open" }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/workshop/$projectName",
      params: { projectName: "aatrox-justicar" },
    });
  });

  it("draws a coded evidence line with its meaning", () => {
    mockBackend();
    renderWithApp(<IncidentDetail incident={createMockIncident()} />);

    expect(
      screen.getByText("ALE-9B39AA45 FATAL ERROR. Missing data: 0x1a2b3c4d5e6f7081"),
    ).toBeInTheDocument();
    expect(screen.getByText("A file the game needed is in no mounted archive")).toBeInTheDocument();
  });

  /// The mark says how firmly the manager reads the code, which is a claim
  /// about its own table, so a reading reads the same whichever mark it has.
  it("reads a row the same whatever its evidence mark, and shows an unknown code alone", () => {
    mockBackend();
    const meaning = "An archive could not be mounted, because it is corrupt";
    const incident = createMockIncident({
      evidence: [
        {
          at: "00:09.1",
          source: "game",
          line: "ALE-18967993",
          code: { id: "ALE-18967993", kind: "wad_mount", meaning, mark: "inferred" },
        },
        {
          at: "00:09.2",
          source: "game",
          line: "SEJ-0000ZZZZ",
          code: { id: "SEJ-0000ZZZZ", kind: null, meaning: null, mark: null },
        },
      ],
    });
    renderWithApp(<IncidentDetail incident={incident} />);

    expect(screen.getByText(meaning)).toBeInTheDocument();
    expect(screen.queryByText(/probably|confirmed/)).not.toBeInTheDocument();
    expect(screen.getAllByText("SEJ-0000ZZZZ")).toHaveLength(2);
  });

  /// A hint is one of several, so it reads as a list rather than as a run of
  /// sentences. The marker is decoration and stays out of a copied selection.
  it("marks each hint as a list row", () => {
    mockBackend();
    renderWithApp(
      <IncidentDetail
        incident={createMockIncident({
          verdict: {
            ...createMockIncident().verdict,
            hints: ["First hint.", "Second hint."],
          },
        })}
      />,
    );

    const rows = screen
      .getAllByRole("listitem")
      .filter((row) => /hint\.$/.test(row.textContent ?? ""));
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const marker = row.querySelector("[aria-hidden]");
      expect(marker?.textContent).toBe("•");
      expect(marker?.className).toContain("select-none");
    }
  });

  it("lines up the facts: version, length, origin, and whether a log was found", () => {
    mockBackend();
    renderWithApp(<IncidentDetail incident={createMockIncident()} />);

    expect(screen.getByText("16.16.804.9184 · 12 s · Library · log found")).toBeInTheDocument();
  });

  /// Without a log there is nothing to reveal, and the button says so by
  /// refusing rather than by opening an empty folder.
  it("disables Open game log when no log was found", () => {
    mockBackend();
    renderWithApp(<IncidentDetail incident={createMockIncident({ game: null })} />);

    expect(screen.getByRole("button", { name: "Open game log" })).toBeDisabled();
    expect(screen.getByText("12 s · Library · no log")).toBeInTheDocument();
  });

  it("marks a dismissed incident and retires the Dismiss action", () => {
    mockBackend();
    renderWithApp(<IncidentDetail incident={createMockIncident({ dismissed: true })} />);

    expect(screen.getByText("Dismissed", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismissed" })).toBeDisabled();
  });
});

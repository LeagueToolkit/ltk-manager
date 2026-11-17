// @vitest-environment happy-dom

import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModTrace, TraceRow } from "@/lib/tauri";
import { useGetHelpDialog, useModTraceDialog } from "@/stores";
import { commandNames } from "@/test/commandNames";
import { mockInvoke } from "@/test/mocks/tauri";
import { renderWithProviders } from "@/test/utils";

import { ModTraceDialog } from "../ModTraceDialog";

const { mockNavigate, mockRebuild } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockRebuild: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => mockNavigate,
}));
vi.mock("@/modules/patcher", () => ({
  useRebuildOverlayAction: () => ({ label: "Rebuild overlay", run: mockRebuild, pending: false }),
}));

const BUILT_AT = "2026-11-17T19:01:00Z";

const REFUSED: TraceRow[] = [
  { state: "pass", row: "enabled", enabled: true, profile: "Default" },
  { state: "unknown", row: "health", check: null },
  { state: "pass", row: "overlay", reading: "built", builtAt: BUILT_AT },
  { state: "warn", row: "advisory", code: "layers-unset" },
  {
    state: "fail",
    row: "last-game",
    reading: "overlay-not-live",
    outcome: "refused",
    patcherCode: "VRF00000008",
  },
];

function openFor(trace: ModTrace) {
  mockInvoke.mockImplementation((cmd: string) => {
    if (cmd === commandNames.diagnostics.modTrace) {
      return Promise.resolve({ ok: true, value: trace });
    }
    return Promise.resolve({ ok: true, value: null });
  });
  useModTraceDialog
    .getState()
    .open({ subject: { kind: "mod", id: "aatrox" }, name: "Aatrox Justicar" });
  renderWithProviders(<ModTraceDialog />);
}

describe("ModTraceDialog", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockNavigate.mockReset();
    mockRebuild.mockReset();
    useModTraceDialog.getState().close();
    useGetHelpDialog.getState().close();
  });

  it("renders nothing while it is closed", () => {
    renderWithProviders(<ModTraceDialog />);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("reads the trace of its subject and lists each row with its state", async () => {
    openFor({ rows: REFUSED, lastGame: null });

    const items = await screen.findAllByRole("listitem");

    expect(screen.getByRole("dialog", { name: "Aatrox Justicar" })).toBeInTheDocument();
    expect(mockInvoke).toHaveBeenCalledWith(commandNames.diagnostics.modTrace, {
      subject: { kind: "mod", id: "aatrox" },
    });
    expect(items.map((item) => item.dataset.state)).toEqual([
      "pass",
      "unknown",
      "pass",
      "warn",
      "fail",
    ]);
    const last = within(items[4]!);
    expect(last.getByText("The last game did not load this mod")).toBeInTheDocument();
    expect(last.getByText("The patcher refused the overlay. VRF00000008")).toBeInTheDocument();
  });

  it("states when the last game started and how long it ran", async () => {
    openFor({
      rows: [],
      lastGame: {
        startedAt: "2026-11-17T19:02:00Z",
        endedAt: "2026-11-17T19:26:00Z",
        stillRunning: false,
      },
    });

    expect(await screen.findByText(/^Last game: .+, 24 min$/)).toBeInTheDocument();
  });

  it("opens Get help with the mod and closes", async () => {
    openFor({ rows: REFUSED, lastGame: null });

    await userEvent.click(await screen.findByRole("button", { name: "Get help" }));

    expect(useGetHelpDialog.getState().payload).toEqual({ modId: "aatrox" });
    expect(useModTraceDialog.getState().isOpen).toBe(false);
  });

  it("rebuilds the overlay from the panel", async () => {
    openFor({
      rows: [{ state: "fail", row: "overlay", reading: "without-mod", builtAt: BUILT_AT }],
      lastGame: null,
    });

    await userEvent.click(await screen.findByRole("button", { name: "Rebuild overlay" }));

    expect(mockRebuild).toHaveBeenCalledOnce();
  });

  it("offers the startup settings for a game that the manager did not watch", async () => {
    openFor({
      rows: [{ state: "fail", row: "last-game", reading: "unwatched" }],
      lastGame: null,
    });

    await userEvent.click(await screen.findByRole("button", { name: "Open startup settings" }));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/settings",
      search: { focus: "general.autoRun" },
    });
  });

  it("does not offer the startup settings for another trace", async () => {
    openFor({ rows: REFUSED, lastGame: null });

    await screen.findAllByRole("listitem");
    expect(screen.queryByRole("button", { name: "Open startup settings" })).not.toBeInTheDocument();
  });
});

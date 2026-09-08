// @vitest-environment happy-dom

import type { Update } from "@tauri-apps/plugin-updater";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useDialogQueueStore, useUpdaterStore } from "@/stores";
import { renderWithProviders } from "@/test/utils";

import type { ReleaseFeed, UseReleaseHistoryOptions } from "../../api";
import { UpdateNotification } from "../UpdateNotification";

const useReleaseHistory = vi.fn<(options: UseReleaseHistoryOptions) => ReleaseFeed>();

vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  useReleaseHistory: (options: UseReleaseHistoryOptions) => useReleaseHistory(options),
}));

const location = { pathname: "/" };
vi.mock("@tanstack/react-router", () => ({ useLocation: () => location }));

const UPDATE = { version: "1.15.0", currentVersion: "1.14.1", body: "" } as unknown as Update;

function history(): ReleaseFeed {
  return {
    releases: [],
    isPending: false,
    isFetchingNextPage: false,
    hasNextPage: false,
    error: null,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  };
}

describe("UpdateNotification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useReleaseHistory.mockReturnValue(history());
    useDialogQueueStore.setState({ current: null, claims: [] });
    useUpdaterStore.setState({ update: UPDATE, dialogOpen: true, dialogOpener: "check" });
  });

  /* Home draws the notes under where the dialog would sit, and the title bar
     cell keeps the way back, so the check's opening is dropped rather than kept
     for the next page. */
  it("claims nothing on Home when the check opened the dialog, and drops the opening", () => {
    location.pathname = "/";

    renderWithProviders(<UpdateNotification />);

    expect(useDialogQueueStore.getState().claims).toEqual([]);
    expect(useUpdaterStore.getState().dialogOpen).toBe(false);
    expect(useUpdaterStore.getState().dialogOpener).toBeNull();
  });

  it("claims the screen on Mods when the check opened the dialog", () => {
    location.pathname = "/mods";

    renderWithProviders(<UpdateNotification />);

    expect(useDialogQueueStore.getState().claims).toEqual(["update"]);
  });

  it("claims the screen on Home when a press opened the dialog", () => {
    location.pathname = "/";
    useUpdaterStore.setState({ dialogOpener: "press" });

    renderWithProviders(<UpdateNotification />);

    expect(useDialogQueueStore.getState().claims).toEqual(["update"]);
  });
});

// @vitest-environment happy-dom

import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUpdaterStore } from "@/stores";

import { downloadUpdate } from "../../api";
import { useUpdateCheck } from "../useUpdateCheck";

vi.mock("../../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api")>()),
  downloadUpdate: vi.fn(() => Promise.resolve({ ok: true, value: null })),
}));

describe("useUpdateCheck", () => {
  beforeEach(() => {
    useUpdaterStore.setState({ update: null, dialogOpen: false, skippedVersion: null });
    vi.mocked(downloadUpdate).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /* Vitest loads .env.local like any dev run, so the flag is stubbed either
     way rather than inherited from whoever is running the suite. */
  it("offers a dev run nothing to update to", () => {
    vi.stubEnv("VITE_MOCK_UPDATE", "");

    renderHook(() => useUpdateCheck());

    expect(useUpdaterStore.getState().update).toBeNull();
  });

  it("seeds the stand-in update behind the flag, and leaves the dialog closed", () => {
    vi.stubEnv("VITE_MOCK_UPDATE", "1");

    renderHook(() => useUpdateCheck());

    const { update, dialogOpen } = useUpdaterStore.getState();
    expect(update?.version).toBe("99.0.0");
    expect(dialogOpen).toBe(false);
  });

  it("downloads the release on offer when automatic downloads are on", () => {
    vi.stubEnv("VITE_MOCK_UPDATE", "1");

    renderHook(() => useUpdateCheck({ autoDownload: true }));

    expect(downloadUpdate).toHaveBeenCalledOnce();
  });

  it("leaves the release on offer undownloaded when automatic downloads are off", () => {
    vi.stubEnv("VITE_MOCK_UPDATE", "1");

    renderHook(() => useUpdateCheck({ autoDownload: false }));

    expect(downloadUpdate).not.toHaveBeenCalled();
  });
});

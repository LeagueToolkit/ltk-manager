import { QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ToastProvider } from "@/components";
import { useAnalyzeUncategorizedMods } from "@/modules/library";
import { createMockInstalledMod } from "@/test/fixtures";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = createTestQueryClient();
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}

describe("useAnalyzeUncategorizedMods", () => {
  beforeEach(() => mockInvoke.mockReset());

  it("checks artwork for categorized mods while analyzing only uncategorized mods", async () => {
    const uncategorized = createMockInstalledMod({ id: "new", displayName: "New Mod" });
    const categorized = createMockInstalledMod({ id: "old", displayName: "Old Mod" });

    mockInvoke.mockImplementation((command: string, args?: { modId?: string }) => {
      if (command === "analyze_mod_wads") {
        return Promise.resolve({
          ok: true,
          value: {
            modId: args?.modId,
            affectedWads: [],
            wadCount: 0,
            overrideCount: 0,
            contentFingerprint: null,
            gameIndexFingerprint: 1n,
            computedAt: "2026-01-01T00:00:00Z",
            isStale: false,
            derived: { champions: [], maps: [], tags: [] },
          },
        });
      }
      if (command === "fetch_mod_thumbnail") {
        return Promise.resolve({
          ok: true,
          value: args?.modId === "old" ? "C:/mods/old/thumbnail.webp" : null,
        });
      }
      // Base UI's portal probes the mocked Tauri environment during cleanup.
      return Promise.resolve({ ok: true, value: null });
    });

    const { result } = renderHook(() => useAnalyzeUncategorizedMods(), { wrapper });
    let detectionResult: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;

    await act(async () => {
      detectionResult = await result.current.mutateAsync({
        uncategorized: [uncategorized],
        artworkCandidates: [uncategorized, categorized],
      });
    });

    expect(mockInvoke.mock.calls.filter(([command]) => command === "analyze_mod_wads")).toEqual([
      ["analyze_mod_wads", { modId: "new" }],
    ]);
    expect(
      mockInvoke.mock.calls
        .filter(([command]) => command === "fetch_mod_thumbnail")
        .map(([, args]) => args),
    ).toEqual(expect.arrayContaining([{ modId: "new" }, { modId: "old" }]));
    expect(detectionResult).toMatchObject({
      analyzed: 1,
      artworkAvailable: 1,
      artworkMissing: 1,
      failures: [],
    });
  });

  it("keeps category results when artwork lookup fails", async () => {
    const mod = createMockInstalledMod({ id: "partial", displayName: "Partial Mod" });

    mockInvoke.mockImplementation((command: string, args?: { modId?: string }) => {
      if (command === "analyze_mod_wads") {
        return Promise.resolve({
          ok: true,
          value: {
            modId: args?.modId,
            affectedWads: [],
            wadCount: 0,
            overrideCount: 0,
            contentFingerprint: null,
            gameIndexFingerprint: 1n,
            computedAt: "2026-01-01T00:00:00Z",
            isStale: false,
            derived: { champions: [], maps: [], tags: [] },
          },
        });
      }
      if (command === "fetch_mod_thumbnail") {
        return Promise.resolve({
          ok: false,
          error: { code: "UNKNOWN", message: "RuneForge unavailable" },
        });
      }
      return Promise.resolve({ ok: true, value: null });
    });

    const { result } = renderHook(() => useAnalyzeUncategorizedMods(), { wrapper });
    let detectionResult: Awaited<ReturnType<typeof result.current.mutateAsync>> | undefined;

    await act(async () => {
      detectionResult = await result.current.mutateAsync({
        uncategorized: [mod],
        artworkCandidates: [mod],
      });
    });

    expect(detectionResult).toMatchObject({
      analyzed: 1,
      artworkAvailable: 0,
      artworkMissing: 0,
      failures: [{ name: "Partial Mod", message: "Artwork: RuneForge unavailable" }],
    });
  });
});

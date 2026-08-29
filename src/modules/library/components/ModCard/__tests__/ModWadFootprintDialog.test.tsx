// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModWadReport } from "@/lib/tauri";
import { installedMod } from "@/modules/library/components/__tests__/modHealthFixtures";

import { ModWadFootprintDialog } from "../ModWadFootprintDialog";
import type { ModCardView } from "../useModCardController";

const analyze = vi.fn();
const useModWadReport = vi.fn<() => { data: ModWadReport | null; isLoading: boolean }>();
const analyzeState = { isPending: false, isError: false };

vi.mock("@/modules/library/api", () => ({
  useModWadReport: () => useModWadReport(),
  useAnalyzeModWads: () => ({ mutate: analyze, ...analyzeState }),
}));

function report(over: Partial<ModWadReport> = {}): ModWadReport {
  return {
    modId: "a",
    affectedWads: [
      "DATA/FINAL/Champions/Kayn.wad.client",
      "DATA/FINAL/Maps/Shipping/Map11.wad.client",
      "DATA/FINAL/UX/Loot.wad.client",
    ],
    wadCount: 3,
    overrideCount: 12,
    contentFingerprint: null,
    gameIndexFingerprint: 1n,
    computedAt: "2026-08-01T10:00:00Z",
    isStale: false,
    derived: { champions: [], maps: [], tags: [], primaryChampion: null },
    ...over,
  };
}

/* Only `mod` is read off the view, so the rest stays out of the way. */
const view = { mod: installedMod("a", "Charizard Smolder") } as ModCardView;

function show(open: boolean, strict = false) {
  const dialog = <ModWadFootprintDialog view={view} open={open} onOpenChange={vi.fn()} />;
  render(strict ? <StrictMode>{dialog}</StrictMode> : dialog);
}

beforeEach(() => {
  vi.clearAllMocks();
  analyzeState.isPending = false;
  analyzeState.isError = false;
  useModWadReport.mockReturnValue({ data: null, isLoading: false });
});

describe("ModWadFootprintDialog", () => {
  /* Every card in the library renders this root. If a closed one analyzed, a
     library of 500 would run 500 passes to draw a grid nobody has asked yet. */
  it("analyzes nothing while it is closed", () => {
    show(false);

    expect(analyze).not.toHaveBeenCalled();
    expect(screen.queryByText("WAD footprint")).not.toBeInTheDocument();
  });

  it("analyzes on the open when nothing is cached", () => {
    show(true);

    expect(analyze).toHaveBeenCalledExactlyOnceWith("a");
    expect(screen.getByText(/Reading this mod/)).toBeInTheDocument();
  });

  /* StrictMode mounts the effect twice, and one opening is one analysis. */
  it("analyzes once under a double mount", () => {
    show(true, true);

    expect(analyze).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("waits for the cache read before deciding there is nothing", () => {
    useModWadReport.mockReturnValue({ data: null, isLoading: true });
    show(true);

    expect(analyze).not.toHaveBeenCalled();
  });

  it("spends nothing on a mod already analyzed", () => {
    useModWadReport.mockReturnValue({ data: report(), isLoading: false });
    show(true);

    expect(analyze).not.toHaveBeenCalled();
    expect(screen.getByText(/3 WADs · 12 overrides/)).toBeInTheDocument();
  });

  it("groups the affected WADs by their game directory", () => {
    useModWadReport.mockReturnValue({ data: report(), isLoading: false });
    show(true);

    expect(screen.getByText("Champions · 1")).toBeInTheDocument();
    expect(screen.getByText("Maps · 1")).toBeInTheDocument();
    expect(screen.getByText("UI · 1")).toBeInTheDocument();
    expect(screen.getByText("Kayn.wad.client")).toBeInTheDocument();
  });

  it("says when a cached report may no longer hold", () => {
    useModWadReport.mockReturnValue({ data: report({ isStale: true }), isLoading: false });
    show(true);

    expect(screen.getByText(/May be outdated/)).toBeInTheDocument();
  });

  it("offers a retry when the analysis failed", () => {
    analyzeState.isError = true;
    show(true);

    expect(screen.getByText("This mod could not be analyzed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });

  it("names a mod that patches nothing rather than drawing an empty list", () => {
    useModWadReport.mockReturnValue({
      data: report({ affectedWads: [], wadCount: 0, overrideCount: 0 }),
      isLoading: false,
    });
    show(true);

    expect(screen.getByText("This mod patches no game WADs.")).toBeInTheDocument();
  });
});

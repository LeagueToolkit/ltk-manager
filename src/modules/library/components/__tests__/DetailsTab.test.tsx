// @vitest-environment happy-dom

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmHost } from "@/components";
import type { ChecksumMismatchInfo, InstalledMod, ModWadReport } from "@/lib/tauri";
import { useLibrarySidebarStore } from "@/modules/library/state";
import { renderWithProviders } from "@/test/utils";

import { DetailsTab } from "../DetailsTab";
import { installedMod } from "./modHealthFixtures";

const analyze = vi.fn();
const setLayers = vi.fn();
const editMod = vi.fn();
const pickFile = vi.fn<() => Promise<string | null>>();
const useModWadReport = vi.fn<() => { data: ModWadReport | null; isLoading: boolean }>();
const analyzeState = { isPending: false, isError: false };
const mismatches = vi.fn<() => ChecksumMismatchInfo[]>();
const thumbnail = vi.fn<() => string | undefined>();

vi.mock("@/modules/library/api", () => ({
  useModWadReport: () => useModWadReport(),
  useAnalyzeModWads: () => ({ mutate: analyze, ...analyzeState }),
  useModChecksumMismatches: () => ({ data: mismatches() }),
  useSetModLayers: () => ({ mutate: setLayers }),
  useEditMod: () => ({ mutate: editMod, isPending: false }),
  useModEffectiveCategories: () => ({
    derivedTags: [],
    derivedMaps: [],
    derivedChampions: [],
    primaryDerivedChampion: null,
  }),
  libraryKeys: { thumbnail: (modId: string) => ["library", "thumbnail", modId] },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: () => pickFile() }));
vi.mock("@tauri-apps/api/core", () => ({ convertFileSrc: (path: string) => `asset://${path}` }));

vi.mock("@/modules/library/api/useModThumbnail", () => ({
  useModThumbnail: () => ({ data: thumbnail() }),
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

function mismatch(pathHash: string): ChecksumMismatchInfo {
  return {
    modId: "a",
    wadName: "Kayn.wad.client",
    pathHash,
    claimed: "0000000000000001",
    computed: "0000000000000002",
  };
}

function mod(over: Partial<InstalledMod> = {}): InstalledMod {
  return { ...installedMod("a", "Charizard Smolder"), ...over };
}

function show(over: Partial<InstalledMod> = {}, strict = false) {
  const tab = <DetailsTab mod={mod(over)} missing={false} />;
  renderWithProviders(strict ? <StrictMode>{tab}</StrictMode> : tab);
}

async function startEditing() {
  await userEvent.click(screen.getByRole("button", { name: "Edit" }));
}

/** The tab with somewhere for `useConfirm` to draw, which lives above the router. */
function showWithConfirm() {
  renderWithProviders(
    <>
      <DetailsTab mod={mod()} missing={false} />
      <ConfirmHost />
    </>,
  );
}

/** Type into the form, then press another card the way the card menu does. */
async function editThenOpen(otherModId: string) {
  await startEditing();
  await userEvent.type(screen.getByLabelText("Mod Name"), "!");
  act(() => useLibrarySidebarStore.getState().showDetails(otherModId));
}

function confirmDialog() {
  return screen.getByRole("dialog");
}

async function openFold(name: RegExp) {
  await userEvent.click(screen.getByRole("button", { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  analyzeState.isPending = false;
  analyzeState.isError = false;
  useModWadReport.mockReturnValue({ data: null, isLoading: false });
  mismatches.mockReturnValue([]);
  thumbnail.mockReturnValue(undefined);
  pickFile.mockResolvedValue(null);
  useLibrarySidebarStore.setState({ open: true, tab: "details", modId: "a", dirty: false });
});

describe("the cover", () => {
  it("names the mod and its version over the art", () => {
    thumbnail.mockReturnValue("asset://thumb.webp");
    show({ version: "2.1.0" });

    expect(screen.getByText("Charizard Smolder")).toBeInTheDocument();
    expect(screen.getByText("v2.1.0")).toBeInTheDocument();
  });

  /* A panel whose first element appears and disappears per mod reads as broken
     rather than as adaptive. */
  it("keeps the cover for a mod with no art", () => {
    show();

    expect(screen.getByText("C")).toBeInTheDocument();
  });
});

describe("the facts", () => {
  it("names the author and the install date", () => {
    show({ authors: ["Riot Forge"] });

    expect(screen.getByText(/Riot Forge/)).toBeInTheDocument();
    expect(screen.getByText(/Installed/)).toBeInTheDocument();
  });

  it("says so rather than leaving the line blank for a mod that names nobody", () => {
    show({ authors: [] });

    expect(screen.getByText(/Unknown author/)).toBeInTheDocument();
  });

  it("draws a pill for every category the mod declares", () => {
    show({ tags: ["champion-skin"], champions: ["Kayn"], maps: ["summoners-rift"] });

    expect(screen.getByText("Kayn")).toBeInTheDocument();
    expect(screen.getByText("Summoner's Rift")).toBeInTheDocument();
  });

  it("draws no description for a mod that carries none", () => {
    show({ description: null });

    expect(screen.queryByText(/Swaps/)).not.toBeInTheDocument();
  });
});

describe("the layers fold", () => {
  const layers = [
    { name: "base", displayName: "Base", enabled: true, priority: 0 },
    { name: "extra", displayName: "Extra", enabled: false, priority: 1 },
  ];

  it("offers nothing to fold for a mod with only its base layer", () => {
    show({ layers: [layers[0]!] });

    expect(screen.queryByRole("button", { name: /Layers/ })).not.toBeInTheDocument();
  });

  it("answers the tally while it is closed", () => {
    show({ layers });

    expect(screen.getByText("1/2")).toBeInTheDocument();
    expect(screen.queryByText("Extra")).not.toBeInTheDocument();
  });

  it("switches a layer from inside the open fold", async () => {
    show({ layers });
    await openFold(/Layers/);

    await userEvent.click(screen.getByText("Extra"));

    expect(setLayers).toHaveBeenCalledWith({
      modId: "a",
      layerStates: { base: true, extra: true },
    });
  });
});

describe("the WAD footprint fold", () => {
  /* The dialog got this from `Dialog.Portal`, which unmounts its children while
     closed. A section in a scrolling tab has no such gate, so the fold is it. */
  it("analyzes nothing until the fold is opened", () => {
    show();

    expect(analyze).not.toHaveBeenCalled();
  });

  it("analyzes on the open when nothing is cached", async () => {
    show();
    await openFold(/WAD footprint/);

    expect(analyze).toHaveBeenCalledExactlyOnceWith("a");
    expect(screen.getByText(/Reading this mod/)).toBeInTheDocument();
  });

  /* StrictMode mounts the effect twice, and one opening is one analysis. */
  it("analyzes once under a double mount", async () => {
    show({}, true);
    await openFold(/WAD footprint/);

    expect(analyze).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("waits for the cache read before deciding there is nothing", async () => {
    useModWadReport.mockReturnValue({ data: null, isLoading: true });
    show();
    await openFold(/WAD footprint/);

    expect(analyze).not.toHaveBeenCalled();
  });

  it("spends nothing on a mod already analyzed", async () => {
    useModWadReport.mockReturnValue({ data: report(), isLoading: false });
    show();
    await openFold(/WAD footprint/);

    expect(analyze).not.toHaveBeenCalled();
    expect(screen.getByText(/3 WADs · 12 overrides/)).toBeInTheDocument();
  });

  it("groups the affected WADs by their game directory", async () => {
    useModWadReport.mockReturnValue({ data: report(), isLoading: false });
    show();
    await openFold(/WAD footprint/);

    expect(screen.getByText("Champions · 1")).toBeInTheDocument();
    expect(screen.getByText("Maps · 1")).toBeInTheDocument();
    expect(screen.getByText("UI · 1")).toBeInTheDocument();
    expect(screen.getByText("Kayn.wad.client")).toBeInTheDocument();
  });

  it("says when a cached report may no longer hold", async () => {
    useModWadReport.mockReturnValue({ data: report({ isStale: true }), isLoading: false });
    show();
    await openFold(/WAD footprint/);

    expect(screen.getByText(/May be outdated/)).toBeInTheDocument();
  });

  it("offers a retry when the analysis failed", async () => {
    analyzeState.isError = true;
    show();
    await openFold(/WAD footprint/);

    expect(screen.getByText("This mod could not be analyzed.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });

  it("names a mod that patches nothing rather than drawing an empty list", async () => {
    useModWadReport.mockReturnValue({
      data: report({ affectedWads: [], wadCount: 0, overrideCount: 0 }),
      isLoading: false,
    });
    show();
    await openFold(/WAD footprint/);

    expect(screen.getByText("This mod patches no game WADs.")).toBeInTheDocument();
  });
});

describe("the packaging advisory", () => {
  it("draws nothing for a mod whose containers told the truth", () => {
    show();

    expect(screen.queryByText("Packaging")).not.toBeInTheDocument();
  });

  it("counts the mismatched chunks per archive", () => {
    mismatches.mockReturnValue([mismatch("00a"), mismatch("00b")]);
    show();

    expect(screen.getByText("Packaging")).toBeInTheDocument();
    expect(screen.getByText("2 chunks")).toBeInTheDocument();
  });
});

describe("editing in place", () => {
  it("swaps the read sections for the form rather than opening over them", async () => {
    show();
    await startEditing();

    expect(screen.getByLabelText("Mod Name")).toBeInTheDocument();
    expect(screen.queryByText(/Installed/)).not.toBeInTheDocument();
  });

  it("keeps the cover, because the thumbnail picker is part of the form", async () => {
    show();
    await startEditing();

    expect(screen.getByRole("button", { name: "Set thumbnail" })).toBeInTheDocument();
  });

  it("saves every field the dialog used to edit", async () => {
    show({ tags: ["ui"] });
    await startEditing();

    const name = screen.getByLabelText("Mod Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Renamed");
    await userEvent.type(screen.getByLabelText(/Champions/), "Kayn");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(editMod).toHaveBeenCalledWith(
      {
        modId: "a",
        metadata: {
          displayName: "Renamed",
          tags: ["ui"],
          maps: [],
          champions: ["Kayn"],
          setThumbnailPath: null,
          removeThumbnail: false,
        },
      },
      expect.anything(),
    );
  });

  /* Nothing autosaves: a half-typed name is not a name. */
  it("writes nothing on cancel and returns to the read sections", async () => {
    show();
    await startEditing();
    await userEvent.type(screen.getByLabelText("Mod Name"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(editMod).not.toHaveBeenCalled();
    expect(screen.getByText(/Installed/)).toBeInTheDocument();
  });

  /* The panel is not modal, so the store is what catches a stray card press. */
  it("tells the panel it holds unsaved edits", async () => {
    show();
    await startEditing();
    expect(useLibrarySidebarStore.getState().dirty).toBe(false);

    await userEvent.type(screen.getByLabelText("Mod Name"), "!");

    expect(useLibrarySidebarStore.getState().dirty).toBe(true);
  });

  it("stops holding them once the form is left", async () => {
    show();
    await startEditing();
    await userEvent.type(screen.getByLabelText("Mod Name"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(useLibrarySidebarStore.getState().dirty).toBe(false);
  });
});

/* The store decides; this is the half that asks. */
describe("the unsaved guard, as the reader meets it", () => {
  it("asks before another card takes a half-typed name", async () => {
    showWithConfirm();
    await editThenOpen("b");

    expect(await screen.findByText("Discard your changes?")).toBeInTheDocument();
    expect(useLibrarySidebarStore.getState().modId).toBe("a");

    /* `useConfirm` draws on one host store, so an unanswered question would
       still be up for the next case. */
    await userEvent.click(within(confirmDialog()).getByRole("button", { name: "Cancel" }));
  });

  it("switches once the reader discards", async () => {
    showWithConfirm();
    await editThenOpen("b");
    await screen.findByText("Discard your changes?");

    await userEvent.click(within(confirmDialog()).getByRole("button", { name: "Discard" }));

    await waitFor(() => expect(useLibrarySidebarStore.getState().modId).toBe("b"));
  });

  it("leaves the panel where it was when the reader keeps editing", async () => {
    showWithConfirm();
    await editThenOpen("b");
    await screen.findByText("Discard your changes?");

    await userEvent.click(within(confirmDialog()).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(useLibrarySidebarStore.getState().pending).toBeNull());
    expect(useLibrarySidebarStore.getState().modId).toBe("a");
    expect(screen.getByLabelText("Mod Name")).toHaveValue("Charizard Smolder!");
  });
});

describe("the panel with no mod", () => {
  it("says how to open one", () => {
    renderWithProviders(<DetailsTab mod={null} missing={false} />);

    expect(screen.getByText("No mod open")).toBeInTheDocument();
  });

  it("says the mod is gone rather than showing stale facts", () => {
    renderWithProviders(<DetailsTab mod={null} missing />);

    expect(screen.getByText("Mod uninstalled")).toBeInTheDocument();
  });
});

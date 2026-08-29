// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { InstalledMod } from "@/lib/tauri";
import { installedMod } from "@/modules/library/components/__tests__/modHealthFixtures";

import { ModPills } from "../ModCardParts";

const effective = vi.fn<
  () => {
    derivedTags: string[];
    derivedChampions: string[];
    derivedMaps: string[];
    primaryDerivedChampion: string | null;
  }
>();

vi.mock("@/modules/library/api", () => ({
  useModEffectiveCategories: () => effective(),
  useCheckModHealth: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/modules/settings", () => ({
  useSettings: () => ({ data: { showModTags: true } }),
}));

function mod(over: Partial<InstalledMod> = {}): InstalledMod {
  return { ...installedMod("a", "A Mod"), ...over };
}

function show(over: Partial<InstalledMod> = {}) {
  render(<ModPills mod={mod(over)} max={6} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  effective.mockReturnValue({
    derivedTags: [],
    derivedChampions: [],
    derivedMaps: [],
    primaryDerivedChampion: null,
  });
});

describe("ModPills", () => {
  /* Two pills saying one thing cost two of the three a card has room for. The
     helmet carries "skin", so the label is free to be only the champion. */
  it("folds a champion skin and its champion into one pill", () => {
    show({ tags: ["champion-skin"], champions: ["Kayn"] });

    expect(screen.getByLabelText("Kayn skin")).toHaveTextContent("Kayn");
    expect(screen.queryByText("Champion Skin")).not.toBeInTheDocument();
  });

  it("folds one pill per champion when a skin covers several", () => {
    show({ tags: ["champion-skin"], champions: ["Kayn", "Shyvana"] });

    expect(screen.getByLabelText("Kayn skin")).toBeInTheDocument();
    expect(screen.getByLabelText("Shyvana skin")).toBeInTheDocument();
  });

  it("leaves the other tags alone", () => {
    show({ tags: ["champion-skin", "misc"], champions: ["Ashe"] });

    expect(screen.getByLabelText("Ashe skin")).toBeInTheDocument();
    expect(screen.getByText("Misc")).toBeInTheDocument();
  });

  /* Nothing to fold it into, so the tag still has to say what the mod is. */
  it("keeps the tag when no champion is known", () => {
    show({ tags: ["champion-skin"] });

    expect(screen.getByText("Champion Skin")).toBeInTheDocument();
  });

  /* No skin tag to fold, so the pill is a plain champion and takes no helmet. */
  it("keeps a champion that came without the tag", () => {
    show({ champions: ["Thresh"] });

    expect(screen.getByText("Thresh")).toBeInTheDocument();
    expect(screen.queryByLabelText("Thresh skin")).not.toBeInTheDocument();
  });

  it("folds an auto-detected pair the same way", () => {
    effective.mockReturnValue({
      derivedTags: ["champion-skin"],
      derivedChampions: ["Viego"],
      derivedMaps: [],
      primaryDerivedChampion: "Viego",
    });
    show();

    expect(screen.getByLabelText("Viego skin")).toHaveTextContent("Viego");
    expect(screen.queryByText("Champion Skin")).not.toBeInTheDocument();
  });

  /* Story: a Kayn skin spilling a few chunks into two others is one skin, and
     three pills for it crowd out everything else the card has to say. */
  it("shows only the champion a derived skin contributes most to", () => {
    effective.mockReturnValue({
      derivedTags: ["champion-skin"],
      derivedChampions: ["Kayn", "Rhaast", "Shyvana"],
      derivedMaps: [],
      primaryDerivedChampion: "Kayn",
    });
    show();

    expect(screen.getByLabelText("Kayn skin")).toBeInTheDocument();
    expect(screen.queryByText("Rhaast")).not.toBeInTheDocument();
    expect(screen.queryByText("Shyvana")).not.toBeInTheDocument();
  });

  /* A report analysed before the weighting names no primary, so the card falls
     back to what it always showed rather than picking one at random. */
  it("keeps every derived champion when none is named the primary", () => {
    effective.mockReturnValue({
      derivedTags: ["champion-skin"],
      derivedChampions: ["Kayn", "Shyvana"],
      derivedMaps: [],
      primaryDerivedChampion: null,
    });
    show();

    expect(screen.getByLabelText("Kayn skin")).toBeInTheDocument();
    expect(screen.getByLabelText("Shyvana skin")).toBeInTheDocument();
  });

  /* The dashed outline marks a guess, and a fold across the two tiers would
     state a pairing nobody did - so the halves stay as they were found. */
  it("does not fold a stated tag into a guessed champion", () => {
    effective.mockReturnValue({
      derivedTags: [],
      derivedChampions: ["Garen"],
      derivedMaps: [],
      primaryDerivedChampion: "Garen",
    });
    show({ tags: ["champion-skin"] });

    expect(screen.getByText("Champion Skin")).toBeInTheDocument();
    expect(screen.getByText("Garen")).toBeInTheDocument();
    expect(screen.queryByLabelText("Garen skin")).not.toBeInTheDocument();
  });
});

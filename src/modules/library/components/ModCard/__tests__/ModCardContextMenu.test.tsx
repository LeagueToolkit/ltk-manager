// @vitest-environment happy-dom

import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createMockInstalledMod } from "@/test/fixtures";
import { renderWithProviders } from "@/test/utils";

import { ModCardContextMenu } from "../ModCardParts";
import type { ModCardView } from "../useModCardController";

vi.mock("@/modules/library/api", () => ({
  useCheckModHealth: () => ({ mutate: vi.fn(), isPending: false }),
  useHealthCheckReadiness: () => "ready",
  useModEffectiveCategories: () => ({
    derivedTags: [],
    derivedMaps: [],
    derivedChampions: [],
    primaryDerivedChampion: null,
  }),
}));
vi.mock("@/modules/settings", () => ({ useSettings: () => ({ data: { showModTags: true } }) }));
vi.mock("@/stores", () => ({ useModHealthDrawerStore: () => vi.fn() }));

/* Only the flags the menu reads are set, so the rest stays out of the way. */
function view(over: Partial<ModCardView> = {}): ModCardView {
  return {
    mod: createMockInstalledMod({ id: "a" }),
    isFlagged: false,
    menuDisabled: false,
    isInUserFolder: false,
    canChangeStorage: false,
    storageChangePending: false,
    isSelected: false,
    hasSelection: false,
    onOpenLocation: vi.fn(),
    onCopyId: vi.fn(),
    onRemoveFromFolder: vi.fn(),
    onUninstall: vi.fn(),
    onSetStorage: vi.fn(),
    setSkinhackInfoOpen: vi.fn(),
    ...over,
  } as ModCardView;
}

function rightClick(over: Partial<ModCardView> = {}) {
  renderWithProviders(
    <ModCardContextMenu view={view(over)} card={<div data-testid="card" />}>
      <span>body</span>
    </ModCardContextMenu>,
  );
  fireEvent.contextMenu(screen.getByTestId("card"));
}

beforeEach(() => vi.clearAllMocks());

describe("a mod card's right click", () => {
  it("opens the card's own commands", async () => {
    rightClick();

    expect(await screen.findByRole("menuitem", { name: "Details" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Uninstall" })).toBeInTheDocument();
  });

  /* The pick is the checkbox's and the modifiers', never the right click's. A
     press used to collapse the selection onto the card it landed on, and a
     press inside one used to open the selection's commands instead. */
  it("opens the same commands over a card that is picked", async () => {
    rightClick({ isSelected: true, hasSelection: true });

    expect(await screen.findByRole("menuitem", { name: "Uninstall" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Clear selection/ })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /Enable 1/ })).toBeNull();
  });

  it("opens nothing while the patcher owns the library", () => {
    rightClick({ menuDisabled: true });

    expect(screen.queryByRole("menuitem")).toBeNull();
  });
});

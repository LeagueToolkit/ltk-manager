// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { cloneElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { createMockInstalledMod } from "@/test/fixtures";

import { ModCardGrid } from "../ModCardGrid";
import { ModCardList } from "../ModCardList";
import type { ModCardView } from "../useModCardController";

vi.mock("@/modules/diagnostics", () => ({
  SuspectBadge: () => <button type="button">suspect</button>,
}));
vi.mock("../../ModHealthBadge", () => ({
  ModHealthBadge: () => <button type="button">health</button>,
}));
vi.mock("../../MissingDepsBadge", () => ({ MissingDepsBadge: () => null }));
vi.mock("../../LayerPopover", () => ({ LayerPopover: () => null }));
vi.mock("../ModCardParts", () => ({
  ModCardContextMenu: ({ card, children }: { card: ReactElement; children: ReactNode }) =>
    cloneElement(card, undefined, children),
  ModCardMenu: () => null,
  ModCardThumbnail: () => null,
  ModCardToggle: () => null,
  ModPills: () => null,
  SkinhackInfoDialog: () => null,
}));
vi.mock("../ModWadFootprintDialog", () => ({ ModWadFootprintDialog: () => null }));

function view(): ModCardView {
  return {
    mod: createMockInstalledMod(),
    thumbnailUrl: undefined,
    isFlagged: false,
    skinhackReason: "",
    canChangeStorage: false,
    storageChangePending: false,
    disabled: false,
    menuDisabled: false,
    isInUserFolder: false,
    isMultiLayer: false,
    hasSelection: false,
    isSelected: false,
    inEnabledState: true,
    menuScope: "card",
    blocked: false,
    isInteractive: true,
    cursorClass: "",
    skinhackInfoOpen: false,
    setSkinhackInfoOpen: vi.fn(),
    wadFootprintOpen: false,
    setWadFootprintOpen: vi.fn(),
    onCardClick: vi.fn(),
    onCardKeyDown: vi.fn(),
    onCardContextMenu: vi.fn(),
    onSelectionToggle: vi.fn(),
    onToggle: vi.fn(),
    onUninstall: vi.fn(),
    onSetStorage: vi.fn(),
    onCopyId: vi.fn(),
    onOpenLocation: vi.fn(),
    onRemoveFromFolder: vi.fn(),
  };
}

/* Per "The suspect badge" in docs/ux/LEAGUE_DIAGNOSTICS.md: the two marks
   stack in one row, the health badge first. */
describe.each([
  ["grid", ModCardGrid],
  ["list", ModCardList],
])("ModCard %s marks", (_layout, Layout) => {
  it("stacks the suspect mark beside the health badge", () => {
    render(<Layout view={view()} />);

    const health = screen.getByRole("button", { name: "health" });
    const suspect = screen.getByRole("button", { name: "suspect" });
    expect(health.nextElementSibling).toBe(suspect);
  });
});

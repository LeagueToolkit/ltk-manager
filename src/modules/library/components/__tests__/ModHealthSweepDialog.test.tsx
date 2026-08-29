// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrokenMods } from "@/modules/library";

import { ModHealthSweepDialog } from "../ModHealthSweepDialog";
import { installedMod, verdict } from "./modHealthFixtures";

const useBrokenMods = vi.fn<() => BrokenMods>();
const onClose = vi.fn();

/* The panel inside the dialog is `ModHealthSweepPanel`'s to test, so these mocks
   only have to keep it drawing something. */
vi.mock("../../api", () => ({
  useBrokenMods: () => useBrokenMods(),
  useInstalledMods: () => ({ data: [installedMod("a", "Charizard Smolder")] }),
  useRepairMod: () => ({ mutate: vi.fn(), isPending: false }),
  useRepairMods: () => ({ repair: vi.fn(), isRepairing: false, progress: null }),
  useCancelModHealthRun: () => ({ mutate: vi.fn(), isPending: false }),
  useRepairTargets: () => {
    const all = useBrokenMods().repairable;
    return { enabled: all, all };
  },
}));

function show() {
  useBrokenMods.mockReturnValue({ repairable: [verdict("a", "repairable")], unrepairable: [] });
  render(<ModHealthSweepDialog open onClose={onClose} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ModHealthSweepDialog", () => {
  it("draws what the sweep found", () => {
    show();

    expect(screen.getByRole("heading", { name: "Detected issues with mods" })).toBeInTheDocument();
    expect(screen.getByText("Charizard Smolder")).toBeInTheDocument();
  });

  /* It is placed rather than anchored, so the edge the sheet was dragged from is
     not there to drag. */
  it("has no edge to resize", () => {
    show();

    expect(screen.queryByRole("separator")).not.toBeInTheDocument();
  });

  /* A list this long opens saying what to read, not how to leave. */
  it("does not open focused on a way out", () => {
    show();

    for (const way of screen.getAllByRole("button", { name: "Close" })) {
      expect(way).not.toHaveFocus();
    }
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    show();

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
  });
});

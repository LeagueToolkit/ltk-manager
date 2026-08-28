// @vitest-environment happy-dom

import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModRepairProgress } from "@/lib/tauri";
import type { BrokenMods } from "@/modules/library";
import { useModHealthDrawerStore } from "@/stores";

import { ModHealthSweepDrawer } from "../ModHealthSweepDrawer";
import { installedMod, verdict } from "./modHealthFixtures";

const useBrokenMods = vi.fn<() => BrokenMods>();
const useInstalledMods = vi.fn<() => { data: ReturnType<typeof installedMod>[] }>();
const repairOne = vi.fn();
const onClose = vi.fn();

vi.mock("../../api", () => ({
  useBrokenMods: () => useBrokenMods(),
  useInstalledMods: () => useInstalledMods(),
  useRepairMod: () => ({ mutate: repairOne, isPending: false }),
  useRepairMods: () => run,
}));

let run: { repair: () => void; isRepairing: boolean; progress: ModRepairProgress | null };

function show(broken: BrokenMods) {
  useBrokenMods.mockReturnValue(broken);
  render(<ModHealthSweepDrawer open onClose={onClose} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  run = { repair: vi.fn(), isRepairing: false, progress: null };
  // The width outlives a close, so it outlives a test too.
  useModHealthDrawerStore.setState({ width: 380 });
  useInstalledMods.mockReturnValue({
    data: [installedMod("a", "Charizard Smolder"), installedMod("b", "Old Ashe Rework")],
  });
});

describe("ModHealthSweepDrawer", () => {
  /* The title says what was found. Which of the two errands the reader is on is
     the line underneath, and it is one of three. */
  it("promises the repair when every finding can be reached", () => {
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByRole("heading", { name: "Detected issues with mods" })).toBeInTheDocument();
    expect(screen.getByText(/All of them can be repaired automatically/)).toBeInTheDocument();
  });

  it("sends the reader after new versions when no repair can reach them", () => {
    show({ repairable: [], unrepairable: [verdict("b", "unrepairable")] });

    expect(screen.getByRole("heading", { name: "Detected issues with mods" })).toBeInTheDocument();
    expect(screen.getByText(/None of them are auto-fixable/)).toBeInTheDocument();
  });

  it("names both errands when the list is mixed", () => {
    show({
      repairable: [verdict("a", "repairable")],
      unrepairable: [verdict("b", "unrepairable")],
    });

    expect(screen.getByText("Repairing is recommended")).toBeInTheDocument();
    expect(screen.getByText(/some will need updated versions instead/)).toBeInTheDocument();
  });

  /* Both halves of the list count the same thing, so a repairable row shows
     every finding rather than only the subset a repair can reach. */
  it("names each mod and how many problems it has", () => {
    show({
      repairable: [verdict("a", "repairable", { fixable: 2, findings: 3 })],
      unrepairable: [],
    });

    expect(screen.getByText("Charizard Smolder")).toBeInTheDocument();
    expect(screen.getByText("3 problems")).toBeInTheDocument();
  });

  it("says problem rather than problems for a single one", () => {
    show({ repairable: [verdict("a", "repairable", { findings: 1 })], unrepairable: [] });

    expect(screen.getByText("1 problem")).toBeInTheDocument();
  });

  /* The row's own repair is a second door to the one press, for a reader who
     wants one mod back rather than the library. */
  it("repairs a single mod from its own row", async () => {
    const user = userEvent.setup();
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    await user.click(screen.getByRole("button", { name: "Repair Charizard Smolder" }));

    expect(repairOne).toHaveBeenCalledWith("a");
  });

  /* Nothing can repair it, so the row offers no button that would fail. */
  it("gives an unrepairable row no repair of its own", () => {
    show({ repairable: [], unrepairable: [verdict("b", "unrepairable")] });

    expect(screen.queryByRole("button", { name: /^Repair / })).not.toBeInTheDocument();
  });

  /* A missing Repair button is not a message. The row has to say the word, or a
     reader is left to work out why this one alone has nothing to press. */
  it("says outright that an unrepairable mod's problems cannot be fixed", () => {
    show({ repairable: [], unrepairable: [verdict("b", "unrepairable", { findings: 4 })] });

    expect(screen.getByText("Old Ashe Rework")).toBeInTheDocument();
    expect(screen.getByText("4 unfixable problems :(")).toBeInTheDocument();
  });

  it("falls back to the mod id when the library no longer names it", () => {
    useInstalledMods.mockReturnValue({ data: [] });
    show({ repairable: [verdict("ghost-id", "repairable")], unrepairable: [] });

    expect(screen.getByText("ghost-id")).toBeInTheDocument();
  });

  it("widens from its own edge, and gives the width back", () => {
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });
    const panel = screen.getByRole("dialog", { name: "What the check found" });
    const handle = screen.getByRole("separator");
    const start = panel.style.width;

    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    const wider = panel.style.width;
    fireEvent.keyDown(handle, { key: "ArrowRight" });

    expect(wider).not.toBe(start);
    expect(panel.style.width).toBe(start);
  });

  /* The handle is the one control that changes nothing but the panel's shape, so
     opening on it lights a bar down the edge and says nothing about why. */
  it("does not open focused on the resize handle", () => {
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByRole("separator")).not.toHaveFocus();
  });

  /* The drawer names the mods the run is working through, so a toast over the
     top of it would cover the list to report on it. */
  it("hosts the running repair where its own button was", () => {
    run.isRepairing = true;
    run.progress = { current: 7, total: 18, modId: "a" };
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByText("Repairing Charizard Smolder")).toBeInTheDocument();
    expect(screen.getByText("7 / 18")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Repair \d/ })).not.toBeInTheDocument();
  });

  it("names a mod the library has since dropped by its id", () => {
    run.isRepairing = true;
    run.progress = { current: 1, total: 2, modId: "ghost-id" };
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByText("Repairing ghost-id")).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledOnce();
  });
});

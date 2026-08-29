// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ModRepairProgress } from "@/lib/tauri";
import type { BrokenMods } from "@/modules/library";

import { ModHealthSweepPanel } from "../ModHealthSweepPanel";
import { installedMod, verdict } from "./modHealthFixtures";

const useBrokenMods = vi.fn<() => BrokenMods>();
const useInstalledMods = vi.fn<() => { data: ReturnType<typeof installedMod>[] }>();
const repairOne = vi.fn();
const cancelRun = vi.fn();
const onClose = vi.fn();

vi.mock("../../api", () => ({
  useBrokenMods: () => useBrokenMods(),
  useInstalledMods: () => useInstalledMods(),
  useRepairMod: () => ({ mutate: repairOne, isPending: false }),
  useRepairMods: () => run,
  useCancelModHealthRun: () => ({ mutate: cancelRun, isPending: false }),
  /* The real hook over the two mocked ones, so a test that switches a mod off
     exercises the split the panel actually draws. */
  useRepairTargets: () => {
    const all = useBrokenMods().repairable;
    const on = new Set(
      useInstalledMods()
        .data.filter((mod) => mod.enabled)
        .map((mod) => mod.id),
    );
    return { enabled: all.filter((verdict) => on.has(verdict.modId)), all };
  },
}));

let run: { repair: () => void; isRepairing: boolean; progress: ModRepairProgress | null };

function show(broken: BrokenMods) {
  useBrokenMods.mockReturnValue(broken);
  render(<ModHealthSweepPanel onClose={onClose} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  run = { repair: vi.fn(), isRepairing: false, progress: null };
  useInstalledMods.mockReturnValue({
    data: [installedMod("a", "Charizard Smolder"), installedMod("b", "Old Ashe Rework")],
  });
});

describe("ModHealthSweepPanel", () => {
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

  /* Two ways out, as every other dialog in the app offers: the corner mark and
     the footer press beside the repair. */
  it("closes from the header and from the footer", async () => {
    const user = userEvent.setup();
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    const [header, footer] = screen.getAllByRole("button", { name: "Close" });
    await user.click(header);
    await user.click(footer);

    expect(onClose).toHaveBeenCalledTimes(2);
  });

  /* Nothing here can be repaired, and without a press of its own the footer
     went with it - leaving a dialog whose only answer was the corner mark. */
  it("gives a library no repair can reach a footer of its own", async () => {
    const user = userEvent.setup();
    show({ repairable: [], unrepairable: [verdict("b", "unrepairable")] });

    const [, footer] = screen.getAllByRole("button", { name: "Close" });
    await user.click(footer);

    expect(onClose).toHaveBeenCalledOnce();
  });

  /* The panel names the mods the run is working through, so a toast over the
     top of it would cover the list to report on it. */
  it("hosts the running repair where its own button was", () => {
    run.isRepairing = true;
    run.progress = { completed: 7, total: 18, inFlight: ["a"] };
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByText("Repairing Charizard Smolder")).toBeInTheDocument();
    expect(screen.getByText("7 / 18")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Repair \d/ })).not.toBeInTheDocument();
  });

  /* A run reads several mods at once, and the row is one line wide. */
  it("names one of the mods in flight and counts the rest", () => {
    run.isRepairing = true;
    run.progress = { completed: 2, total: 18, inFlight: ["a", "b", "c"] };
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByText("Repairing Charizard Smolder and 2 more")).toBeInTheDocument();
  });

  it("names the run itself while it is between mods", () => {
    run.isRepairing = true;
    run.progress = { completed: 18, total: 18, inFlight: [] };
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByText("Repairing your mods")).toBeInTheDocument();
  });

  it("names a mod the library has since dropped by its id", () => {
    run.isRepairing = true;
    run.progress = { completed: 1, total: 2, inFlight: ["ghost-id"] };
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByText("Repairing ghost-id")).toBeInTheDocument();
  });

  /* Every broken mod is switched on, so the two presses would do the same thing
     and a caret would only ask the reader to find that out. */
  it("draws one plain press when nothing broken is switched off", () => {
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.getByRole("button", { name: /Repair 1 mod/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More repair options" })).not.toBeInTheDocument();
  });

  /* A disabled mod reaches no overlay, so the press offers the work the next
     game needs and the library stays behind the caret. */
  it("splits the press when a broken mod is switched off", async () => {
    const user = userEvent.setup();
    useInstalledMods.mockReturnValue({
      data: [
        installedMod("a", "Charizard Smolder"),
        { ...installedMod("b", "Old Ashe Rework"), enabled: false },
      ],
    });
    show({
      repairable: [verdict("a", "repairable"), verdict("b", "repairable")],
      unrepairable: [],
    });

    expect(screen.getByRole("button", { name: /Repair 1 enabled mod/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More repair options" }));
    await user.click(screen.getByRole("menuitem", { name: "Repair all 2" }));

    expect(run.repair).toHaveBeenCalledWith(["a", "b"]);
  });

  it("repairs only what is switched on from the press itself", async () => {
    const user = userEvent.setup();
    useInstalledMods.mockReturnValue({
      data: [
        installedMod("a", "Charizard Smolder"),
        { ...installedMod("b", "Old Ashe Rework"), enabled: false },
      ],
    });
    show({
      repairable: [verdict("a", "repairable"), verdict("b", "repairable")],
      unrepairable: [],
    });

    await user.click(screen.getByRole("button", { name: /Repair 1 enabled mod/ }));

    expect(run.repair).toHaveBeenCalledWith(["a"]);
  });

  /* Splitting here would lead with "Repair 0 enabled mods" - a dead press
     offered as the recommendation - and hide the only run that does anything
     behind a caret. */
  it("offers the whole library when nothing broken is switched on", async () => {
    const user = userEvent.setup();
    useInstalledMods.mockReturnValue({
      data: [
        { ...installedMod("a", "Charizard Smolder"), enabled: false },
        { ...installedMod("b", "Old Ashe Rework"), enabled: false },
      ],
    });
    show({
      repairable: [verdict("a", "repairable"), verdict("b", "repairable")],
      unrepairable: [],
    });

    expect(screen.queryByRole("button", { name: /enabled mod/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More repair options" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Repair all 2/ }));

    expect(run.repair).toHaveBeenCalledWith(["a", "b"]);
  });

  /* A repair over a whole library takes long enough that a reader may want it
     to stop, and the run is reported here, so this is where the stop belongs. */
  it("offers a stop while the repair runs", async () => {
    const user = userEvent.setup();
    run.progress = { completed: 3, total: 18, inFlight: ["a"] };
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    await user.click(screen.getByRole("button", { name: "Stop the repair" }));

    expect(cancelRun).toHaveBeenCalledOnce();
  });

  it("offers no stop while nothing is running", () => {
    show({ repairable: [verdict("a", "repairable")], unrepairable: [] });

    expect(screen.queryByRole("button", { name: "Stop the repair" })).not.toBeInTheDocument();
  });
});

// @vitest-environment happy-dom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components";
import type { ModHealthVerdict } from "@/lib/tauri";
import type { HealthFilter } from "@/modules/library";
import { useLibrarySelectionStore, useModHealthDrawerStore } from "@/stores";

import { ModHealthStatusItem } from "../ModHealthStatusItem";
import { ModHealthSweep } from "../ModHealthSweep";
import { type HealthLists, healthVerdicts, installedMod, verdict } from "./modHealthFixtures";

const health = vi.fn<(filter: HealthFilter) => ModHealthVerdict[]>();
const repairMutate = vi.fn();

vi.mock("../../api", () => ({
  useModHealthVerdicts: () => ({ data: {} }),
  useHealthVerdicts: (filter: HealthFilter) => health(filter),
  useRepairMod: () => ({ mutate: vi.fn(), isPending: false }),
  useRepairMods: () => ({ repair: repairMutate, isRepairing: false, progress: null }),
  useInstalledMods: () => ({ data: [installedMod("a", "Charizard Smolder")] }),
}));

/** The bar's cell and the library's drawer, which is how they meet in the app. */
function show(broken: HealthLists) {
  health.mockImplementation(healthVerdicts(broken));
  render(
    <ToastProvider>
      <ModHealthStatusItem />
      <ModHealthSweep />
    </ToastProvider>,
  );
}

/** A second launch of the app, keeping only what outlives one. */
function relaunch() {
  cleanup();
  useModHealthDrawerStore.setState({ open: false, announced: false });
}

const item = () => screen.queryByRole("button", { name: /repair|broken|flagged/ });
const drawer = () => screen.queryByRole("dialog", { name: "What the check found" });
const FLAGGED_LINE = "Some of your mods contain non-fatal issues which are not repairable";

beforeEach(() => {
  vi.clearAllMocks();
  useLibrarySelectionStore.setState({ selectedIds: new Set() });
  // Past the unprompted open, which is the state the drawer spends its life in.
  useModHealthDrawerStore.setState({ open: false, announced: true, announcedFor: null });
});

describe("ModHealthSweep", () => {
  /* The item answers to the stored verdicts rather than to a sweep having just
     run, so a launch that checked nothing still carries what is broken. */
  it("says nothing while the library is healthy", () => {
    show({});

    expect(item()).toBeNull();
    expect(drawer()).not.toBeInTheDocument();
  });

  it("counts the repairs the library is owed", () => {
    show({ repairable: [verdict("a", "repairable"), verdict("b", "repairable")] });

    expect(screen.getByRole("button", { name: "2 repairs" })).toBeInTheDocument();
  });

  it("says repair rather than repairs for a single one", () => {
    show({ repairable: [verdict("a", "repairable")] });

    expect(screen.getByRole("button", { name: "1 repair" })).toBeInTheDocument();
  });

  /* A library nothing can reach is a different count, not a quieter one. */
  it("counts what is broken when no repair can reach it", () => {
    show({ unrepairable: [verdict("a", "unrepairable")] });

    expect(screen.getByRole("button", { name: "1 broken" })).toBeInTheDocument();
  });

  /* Story: the cell spends `broken` only where the game is what pays. A library
     whose mods all load was painted the same red as one the game refuses, which
     sent readers hunting for replacements they did not need. */
  it("does not call a library broken when nothing stops a mod loading", () => {
    show({ unrepairable: [verdict("a", "unrepairable", { severity: "warning" })] });

    expect(screen.getByRole("button", { name: "1 flagged" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "1 broken" })).not.toBeInTheDocument();
  });

  /* One mod the game refuses is what the whole cell has to answer for, so the
     quieter rung is only for a library with none in it. */
  it("counts what is broken alongside what merely loads with a fault", () => {
    show({
      unrepairable: [
        verdict("a", "unrepairable"),
        verdict("b", "unrepairable", { severity: "warning" }),
      ],
    });

    expect(screen.getByRole("button", { name: "2 broken" })).toBeInTheDocument();
  });

  /* A repair on offer leads whatever else is in the list: the press is what the
     reader is being sent to. */
  it("leads with the repair even where a mod has to be replaced", () => {
    show({
      repairable: [verdict("a", "repairable")],
      unrepairable: [verdict("b", "unrepairable")],
    });

    expect(screen.getByRole("button", { name: "1 repair" })).toBeInTheDocument();
  });

  it("opens the drawer from the bar, and closes it again", async () => {
    const user = userEvent.setup();
    show({ repairable: [verdict("a", "repairable")] });
    expect(drawer()).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1 repair" }));
    expect(drawer()).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(drawer()).not.toBeInTheDocument();
  });

  /* The cell is the one place a reader learns to look, so it has to be the way
     back out as well as the way in. */
  it("toggles the drawer from the cell", async () => {
    const user = userEvent.setup();
    show({ repairable: [verdict("a", "repairable")] });
    const cell = screen.getByRole("button", { name: "1 repair" });
    expect(cell).toHaveAttribute("aria-expanded", "false");

    await user.click(cell);
    expect(drawer()).toBeInTheDocument();
    expect(cell).toHaveAttribute("aria-expanded", "true");

    await user.click(cell);
    expect(drawer()).not.toBeInTheDocument();
    expect(cell).toHaveAttribute("aria-expanded", "false");
  });

  it("repairs every repairable mod in one press, and leaves the rest alone", async () => {
    const user = userEvent.setup();
    show({
      repairable: [verdict("a", "repairable"), verdict("c", "repairable")],
      unrepairable: [verdict("b", "unrepairable")],
    });

    await user.click(screen.getByRole("button", { name: "2 repairs" }));
    await user.click(screen.getByRole("button", { name: "Repair 2 mods" }));

    expect(repairMutate).toHaveBeenCalledWith(["a", "c"]);
  });

  /* Select mode is one the user is holding open, and a panel over the grid they
     are picking from would fight it. The bar's own cell is nowhere near it. */
  /* A drawer nobody opened is the only thing that tells a first-run reader why
     their mods are about to misbehave. */
  it("opens itself the first time the library is found broken", () => {
    useModHealthDrawerStore.setState({ announced: false });
    show({ repairable: [verdict("a", "repairable")] });

    expect(drawer()).toBeInTheDocument();
  });

  it("leaves a healthy library alone", () => {
    useModHealthDrawerStore.setState({ announced: false });
    show({});

    expect(useModHealthDrawerStore.getState().announced).toBe(false);
  });

  /* Announcing again would reopen a drawer the reader has already dealt with,
     and the verdicts move under it every time a repair lands. */
  it("stays shut once the reader has closed it", async () => {
    const user = userEvent.setup();
    useModHealthDrawerStore.setState({ announced: false });
    show({ repairable: [verdict("a", "repairable")] });

    await user.click(screen.getAllByRole("button", { name: "Close" })[0]);

    expect(useModHealthDrawerStore.getState().takeAnnouncement("anything else")).toBe(false);
    expect(drawer()).not.toBeInTheDocument();
  });

  /* Story: a library the game still loads is not worth taking the screen away
     for. The announcement is owed either way, so it arrives as a line the reader
     can ignore, with the drawer one press behind it. */
  it("announces a library that only loads with faults as a toast", async () => {
    useModHealthDrawerStore.setState({ announced: false });
    show({ unrepairable: [verdict("a", "unrepairable", { severity: "warning" })] });

    expect(await screen.findByText(FLAGGED_LINE)).toBeInTheDocument();
    expect(drawer()).not.toBeInTheDocument();
  });

  it("opens the drawer from the toast that announced it", async () => {
    const user = userEvent.setup();
    useModHealthDrawerStore.setState({ announced: false });
    show({ unrepairable: [verdict("a", "unrepairable", { severity: "warning" })] });

    await user.click(await screen.findByRole("button", { name: "Show me" }));

    expect(drawer()).toBeInTheDocument();
  });

  /* Story: the same toast greeted a reader every launch, over mods they had
     already decided to keep. */
  it("does not announce a library the reader has already been told about", () => {
    useModHealthDrawerStore.setState({ announced: false });
    show({ repairable: [verdict("a", "repairable")] });
    expect(drawer()).toBeInTheDocument();

    relaunch();
    show({ repairable: [verdict("a", "repairable")] });

    expect(drawer()).not.toBeInTheDocument();
  });

  it("does not repeat the toast for a library it already flagged", async () => {
    useModHealthDrawerStore.setState({ announced: false });
    show({ unrepairable: [verdict("a", "unrepairable", { severity: "warning" })] });
    expect(await screen.findByText(FLAGGED_LINE)).toBeInTheDocument();

    relaunch();
    show({ unrepairable: [verdict("a", "unrepairable", { severity: "warning" })] });

    expect(screen.queryByText(FLAGGED_LINE)).not.toBeInTheDocument();
  });

  it("announces again once something else is wrong", () => {
    useModHealthDrawerStore.setState({ announced: false });
    show({ repairable: [verdict("a", "repairable")] });

    relaunch();
    show({ repairable: [verdict("a", "repairable"), verdict("b", "repairable")] });

    expect(drawer()).toBeInTheDocument();
  });

  it("does not count the library's order as something changing", () => {
    useModHealthDrawerStore.setState({ announced: false });
    show({ repairable: [verdict("a", "repairable"), verdict("b", "repairable")] });

    relaunch();
    show({ repairable: [verdict("b", "repairable"), verdict("a", "repairable")] });

    expect(drawer()).not.toBeInTheDocument();
  });

  /* Story: the reader pressed Check health, so the question is open again even
     where the run brought back the library it already answered for. */
  it("announces again once a press has reopened the question", () => {
    useModHealthDrawerStore.setState({ announced: false });
    show({ repairable: [verdict("a", "repairable")] });
    act(() => useModHealthDrawerStore.getState().close());
    expect(drawer()).not.toBeInTheDocument();

    act(() => useModHealthDrawerStore.getState().forgetAnnouncement());

    expect(drawer()).toBeInTheDocument();
  });

  /* One mod the game refuses is worth the screen, which is what the drawer
     takes. */
  it("still opens itself for a library the game will not load", () => {
    useModHealthDrawerStore.setState({ announced: false });
    show({ unrepairable: [verdict("a", "unrepairable")] });

    expect(drawer()).toBeInTheDocument();
  });

  /* Mod health is a library surface and the bar spans the app, so away from a
     library page the cell would be a press that opens nothing. */
  it("says nothing where no library page is there to host the drawer", () => {
    health.mockImplementation(healthVerdicts({ repairable: [verdict("a", "repairable")] }));
    render(<ModHealthStatusItem />);

    expect(item()).not.toBeInTheDocument();
  });

  /* Story: the reader pressed Show me from a toast while picking mods, and the
     panel was withheld because a selection was up. A press has to be answered
     wherever it was made. */
  it("still opens under a selection, where a press asked for it", () => {
    useLibrarySelectionStore.setState({ selectedIds: new Set(["a"]) });
    useModHealthDrawerStore.setState({ open: true });
    show({ repairable: [verdict("a", "repairable")] });

    expect(drawer()).toBeInTheDocument();
  });

  /* The bar's own cell is nowhere near the grid, so a selection never takes it. */
  it("keeps the cell while the reader is picking mods", () => {
    useLibrarySelectionStore.setState({ selectedIds: new Set(["a"]) });
    show({ repairable: [verdict("a", "repairable")] });

    expect(item()).toBeInTheDocument();
  });
});

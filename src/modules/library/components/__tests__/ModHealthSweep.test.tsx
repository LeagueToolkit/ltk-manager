// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { BrokenMods } from "@/modules/library";
import { useLibrarySelectionStore, useModHealthDrawerStore } from "@/stores";

import { ModHealthStatusItem } from "../ModHealthStatusItem";
import { ModHealthSweep } from "../ModHealthSweep";
import { installedMod, verdict } from "./modHealthFixtures";

const useBrokenMods = vi.fn<() => BrokenMods>();
const repairMutate = vi.fn();

/* `useModHealthStatus` reaches its own module for `useBrokenMods` rather than
   the barrel, so it is restated here over the same mock. */
vi.mock("../../api", () => ({
  useBrokenMods: () => useBrokenMods(),
  useModHealthStatus: () => {
    const broken = useBrokenMods();
    if (broken.repairable.length + broken.unrepairable.length === 0) return null;
    return broken;
  },
  useRepairMod: () => ({ mutate: vi.fn(), isPending: false }),
  useRepairMods: () => ({ repair: repairMutate, isRepairing: false, progress: null }),
  useInstalledMods: () => ({ data: [installedMod("a", "Charizard Smolder")] }),
}));

/** The bar's cell and the library's drawer, which is how they meet in the app. */
function show(broken: Partial<BrokenMods>) {
  useBrokenMods.mockReturnValue({ repairable: [], unrepairable: [], ...broken });
  render(
    <>
      <ModHealthStatusItem />
      <ModHealthSweep />
    </>,
  );
}

const item = () => screen.queryByRole("button", { name: /repair|broken/ });
const drawer = () => screen.queryByRole("dialog", { name: "What the check found" });

beforeEach(() => {
  vi.clearAllMocks();
  useLibrarySelectionStore.setState({ selectMode: false });
  // Past the unprompted open, which is the state the drawer spends its life in.
  useModHealthDrawerStore.setState({ open: false, announced: true });
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

  it("opens the drawer from the bar, and closes it again", async () => {
    const user = userEvent.setup();
    show({ repairable: [verdict("a", "repairable")] });
    expect(drawer()).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "1 repair" }));
    expect(drawer()).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Close" }));
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

    await user.click(screen.getByRole("button", { name: "Close" }));
    useModHealthDrawerStore.getState().announce();

    expect(drawer()).not.toBeInTheDocument();
  });

  it("takes the drawer off the grid in select mode, and leaves the cell", () => {
    useLibrarySelectionStore.setState({ selectMode: true });
    useModHealthDrawerStore.setState({ open: true });
    show({ repairable: [verdict("a", "repairable")] });

    expect(drawer()).not.toBeInTheDocument();
    expect(item()).toBeInTheDocument();
  });
});

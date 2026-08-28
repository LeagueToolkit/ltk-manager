// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "@/components";
import type { ModHealthVerdict } from "@/lib/tauri";
import { useModHealthDrawerStore } from "@/stores";

import { ModHealthLaunchGuard } from "../ModHealthLaunchGuard";
import { verdict } from "./modHealthFixtures";

const useBrokenEnabledMods = vi.fn<() => ModHealthVerdict[]>();
const onConfirm = vi.fn();

vi.mock("../../api", () => ({
  useBrokenEnabledMods: () => useBrokenEnabledMods(),
}));

const fromTheMenu = vi.fn();

/** The button and one menu entry, which is the shape the toolbar puts them in. */
function show(broken: ModHealthVerdict[]) {
  useBrokenEnabledMods.mockReturnValue(broken);
  render(
    <ModHealthLaunchGuard>
      {(ask) => (
        <>
          <Button onClick={() => ask(onConfirm)}>Play</Button>
          <Button onClick={() => ask(fromTheMenu)}>Launch League only</Button>
        </>
      )}
    </ModHealthLaunchGuard>,
  );
}

const press = () => screen.getByRole("button", { name: "Play" });

beforeEach(() => {
  vi.clearAllMocks();
  useModHealthDrawerStore.setState({ open: false, announced: false, repairRequested: false });
});

describe("ModHealthLaunchGuard", () => {
  /* A launch carrying nothing broken has nothing to confirm, so the press must
     not cost a second one. */
  it("launches straight away when every enabled mod is healthy", async () => {
    const user = userEvent.setup();
    show([]);

    await user.click(press());

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("asks before a launch that would carry a broken mod", async () => {
    const user = userEvent.setup();
    show([verdict("a", "repairable")]);

    await user.click(press());

    expect(screen.getByText("Launch with 1 broken mod?")).toBeInTheDocument();
    expect(screen.getByText(/repairing first is recommended/)).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  /* The split menu reaches the same launches the button does, so a menu that
     skipped the ask would be the route around it. */
  it("asks for a launch started from the menu, and holds that one", async () => {
    const user = userEvent.setup();
    show([verdict("a", "repairable")]);

    await user.click(screen.getByRole("button", { name: "Launch League only" }));
    expect(fromTheMenu).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Launch anyway" }));

    expect(fromTheMenu).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("counts every broken mod the patch would carry", async () => {
    const user = userEvent.setup();
    show([verdict("a", "repairable"), verdict("b", "unrepairable")]);

    await user.click(press());

    expect(screen.getByText("Launch with 2 broken mods?")).toBeInTheDocument();
  });

  it("launches anyway once the reader says so", async () => {
    const user = userEvent.setup();
    show([verdict("a", "repairable")]);

    await user.click(press());
    await user.click(screen.getByRole("button", { name: "Launch anyway" }));

    expect(onConfirm).toHaveBeenCalledOnce();
  });

  /* "Repair first" repairs. Opening the list and leaving the reader to find the
     button again is the same press asked for twice. */
  it("starts the repair and opens the drawer to report it", async () => {
    const user = userEvent.setup();
    show([verdict("a", "repairable")]);

    await user.click(press());
    await user.click(screen.getByRole("button", { name: "Repair first" }));

    const drawer = useModHealthDrawerStore.getState();
    expect(drawer.open).toBe(true);
    expect(drawer.repairRequested).toBe(true);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  /* Nothing here can be repaired, so the press only shows the list - asking for
     a run with nothing to do would report a repair that never happened. */
  it("asks for no repair when none can reach them", async () => {
    const user = userEvent.setup();
    show([verdict("b", "unrepairable")]);

    await user.click(press());
    await user.click(screen.getByRole("button", { name: "Show me" }));

    const drawer = useModHealthDrawerStore.getState();
    expect(drawer.open).toBe(true);
    expect(drawer.repairRequested).toBe(false);
  });

  /* Nothing can be repaired, so the button that offers a repair would lie. */
  it("offers only a look when no repair can reach them", async () => {
    const user = userEvent.setup();
    show([verdict("b", "unrepairable")]);

    await user.click(press());

    expect(screen.getByRole("button", { name: "Show me" })).toBeInTheDocument();
    expect(screen.getByText(/none of them can be repaired automatically/)).toBeInTheDocument();
  });
});

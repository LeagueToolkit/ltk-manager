// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { useLibrarySidebarStore } from "@/modules/library";

import { DocumentsToggle } from "../DocumentsToggle";

beforeEach(() => {
  useLibrarySidebarStore.setState({ open: false, tab: "readme", modId: null });
});

describe("the toolbar toggle", () => {
  /* Every tab answers for one mod, so the toolbar has no tab of its own to land
     on and reopens wherever the reader left the panel. */
  it("reopens on the mod and the tab the panel was left on", async () => {
    useLibrarySidebarStore.setState({ open: false, tab: "licenses", modId: "a" });
    render(<DocumentsToggle />);

    await userEvent.click(screen.getByRole("button", { name: "Documents" }));

    expect(useLibrarySidebarStore.getState()).toMatchObject({
      open: true,
      tab: "licenses",
      modId: "a",
    });
  });

  it("closes the panel again and says which state it is in", async () => {
    render(<DocumentsToggle />);
    const toggle = screen.getByRole("button", { name: "Documents" });

    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(toggle);
    expect(useLibrarySidebarStore.getState().open).toBe(false);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });
});

describe("what the panel remembers", () => {
  it("opens on a mod's readme when a card asks for one", () => {
    useLibrarySidebarStore.getState().showReadme("a");

    const state = useLibrarySidebarStore.getState();
    expect(state).toMatchObject({ open: true, tab: "readme", modId: "a" });
  });

  /* The width outlives a restart and nothing else does: a library that booted
     into a narrower grid would charge a reader for a panel they had forgotten. */
  it("writes the width to disk and neither the open state nor the mod", () => {
    useLibrarySidebarStore.setState({ open: true, modId: "a", split: { grid: 70, documents: 30 } });

    const written = window.localStorage.getItem("ltk-library-sidebar");

    expect(written).toContain("split");
    expect(written).not.toContain('"open"');
    expect(written).not.toContain("modId");
  });
});

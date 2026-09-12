import { beforeEach, describe, expect, it } from "vitest";

import { clampDrawerWidth, DEFAULT_DRAWER_WIDTH, useLibrarySidebarStore } from "../librarySidebar";

function state() {
  return useLibrarySidebarStore.getState();
}

beforeEach(() => {
  useLibrarySidebarStore.setState({
    open: false,
    tab: "licenses",
    modId: null,
    pending: null,
    dirty: false,
  });
});

describe("opening the panel", () => {
  it("lands a card on what the mod is", () => {
    state().showDetails("a");

    expect(state()).toMatchObject({ open: true, tab: "details", modId: "a" });
  });

  it("reopens the toolbar's press on the tab the panel was left on", () => {
    useLibrarySidebarStore.setState({ open: false, tab: "readme", modId: "a" });

    state().toggle();

    expect(state()).toMatchObject({ open: true, tab: "readme", modId: "a" });
  });
});

/* The panel is not modal, so every one of these is a press a reader can make
   with a half-typed name still in the form. */
describe("the unsaved guard", () => {
  beforeEach(() => {
    useLibrarySidebarStore.setState({ open: true, tab: "details", modId: "a", dirty: true });
  });

  it("holds back another mod's details rather than switching under the form", () => {
    state().showDetails("b");

    expect(state().modId).toBe("a");
    expect(state().pending).toEqual({ open: true, tab: "details", modId: "b" });
  });

  it("holds back another mod's readme", () => {
    state().showReadme("b");

    expect(state().pending).toEqual({ open: true, tab: "readme", modId: "b" });
  });

  /* An inactive tab panel unmounts, so a tab press loses the form as surely as
     a card press does. */
  it("holds back another tab", () => {
    state().showTab("licenses");

    expect(state().tab).toBe("details");
    expect(state().pending).toEqual({ open: true, tab: "licenses", modId: "a" });
  });

  it("holds back the close button", () => {
    state().close();

    expect(state().open).toBe(true);
    expect(state().pending).toEqual({ open: false, tab: "details", modId: "a" });
  });

  it("lets the same mod's details through, which is the form itself", () => {
    state().showDetails("a");

    expect(state().pending).toBeNull();
    expect(state().modId).toBe("a");
  });

  it("takes the held-back view once the reader discards", () => {
    state().showDetails("b");
    state().resolvePending(true);

    expect(state()).toMatchObject({ open: true, tab: "details", modId: "b", dirty: false });
    expect(state().pending).toBeNull();
  });

  it("leaves the panel where it was when the reader keeps editing", () => {
    state().showDetails("b");
    state().resolvePending(false);

    expect(state()).toMatchObject({ modId: "a", dirty: true });
    expect(state().pending).toBeNull();
  });
});

describe("the guard with nothing to lose", () => {
  it("switches straight through for a form nobody has typed into", () => {
    useLibrarySidebarStore.setState({ open: true, tab: "details", modId: "a", dirty: false });

    state().showDetails("b");

    expect(state().modId).toBe("b");
    expect(state().pending).toBeNull();
  });
});

/* A drawer covers the grid rather than splitting the row with it, so its width
   is bounded by what the window can spare rather than by a panel's share. */
describe("how wide the drawer may be dragged", () => {
  const WIDE = 1600;

  it("keeps what the reader dragged to, between the bounds", () => {
    expect(clampDrawerWidth(500, WIDE)).toBe(500);
  });

  it("refuses to go under the floor", () => {
    expect(clampDrawerWidth(10, WIDE)).toBe(280);
  });

  it("always leaves the library something to be a grid with", () => {
    expect(clampDrawerWidth(WIDE, WIDE)).toBe(WIDE - 320);
  });

  /* A window too narrow to hold both still has to hold the drawer a reader
     just opened, so the floor wins where the two disagree. */
  it("holds the floor in a window with no room for both", () => {
    expect(clampDrawerWidth(400, 400)).toBe(280);
  });

  it("answers a whole number of pixels", () => {
    expect(clampDrawerWidth(500.6, WIDE)).toBe(501);
  });
});

describe("the drawer's own defaults", () => {
  it("opens at the default width before anyone drags it", () => {
    expect(useLibrarySidebarStore.getState().width).toBe(DEFAULT_DRAWER_WIDTH);
  });
});

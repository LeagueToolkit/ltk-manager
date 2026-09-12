import { beforeEach, describe, expect, it } from "vitest";

import { useLibrarySidebarStore } from "../librarySidebar";

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
    split: null,
  });
});

describe("opening the panel", () => {
  it("lands a card on what the mod is", () => {
    state().showDetails("a");

    expect(state()).toMatchObject({ open: true, tab: "details", modId: "a" });
  });

  it("lands the toolbar on the library-wide tab, which needs no mod", () => {
    state().toggle();

    expect(state()).toMatchObject({ open: true, tab: "licenses" });
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

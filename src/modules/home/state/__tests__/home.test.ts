import { isAfter, useHomeStore } from "..";

describe("home store", () => {
  beforeEach(() => {
    useHomeStore.setState({ seenVersion: null, seenPostAt: null, dismissedNoticeIds: [] });
  });

  it("keeps the version the reader last opened Home on", () => {
    useHomeStore.getState().markVersionSeen("1.15.4");

    expect(useHomeStore.getState().seenVersion).toBe("1.15.4");
  });

  it("moves the post mark forward to the newest post", () => {
    useHomeStore.getState().markPostSeen("2026-05-15T10:00:00Z");
    useHomeStore.getState().markPostSeen("2026-06-01T05:44:14Z");

    expect(useHomeStore.getState().seenPostAt).toBe("2026-06-01T05:44:14Z");
  });

  /* A feed that answers with an older post than the one already seen must not
     make the newer one unread again. */
  it("never moves the post mark back", () => {
    useHomeStore.getState().markPostSeen("2026-06-01T05:44:14Z");
    useHomeStore.getState().markPostSeen("2026-05-15T10:00:00Z");

    expect(useHomeStore.getState().seenPostAt).toBe("2026-06-01T05:44:14Z");
  });

  it("keeps a dismissed notice dismissed, and counts it once", () => {
    useHomeStore.getState().dismissNotice("2026-09-patch-26-9");
    useHomeStore.getState().dismissNotice("2026-09-patch-26-9");

    expect(useHomeStore.getState().dismissedNoticeIds).toEqual(["2026-09-patch-26-9"]);
  });
});

describe("isAfter", () => {
  it("reads no mark as the beginning of time", () => {
    expect(isAfter("2026-06-01T05:44:14Z", null)).toBe(true);
  });

  it("compares the instants rather than the spellings", () => {
    expect(isAfter("2026-06-01T05:44:14+00:00", "2026-06-01T05:44:14Z")).toBe(false);
    expect(isAfter("2026-06-01T05:44:15Z", "2026-06-01T05:44:14+00:00")).toBe(true);
  });

  it("treats a stamp nothing can parse as not newer", () => {
    expect(isAfter("yesterday", "2026-06-01T05:44:14Z")).toBe(false);
  });
});

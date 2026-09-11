import { describe, expect, it } from "vitest";

import { groupInView, type PaneSpan, type SectionSpan } from "../inspectorScroll";

const PANE: PaneSpan = { top: 100, bottom: 500, atEnd: false };

/** Three sections stacked under one another from `from`, each `height` tall. */
function stacked(from: number, height = 200): SectionSpan[] {
  return (["emission", "position", "render"] as const).map((group, at) => ({
    group,
    top: from + at * height,
    bottom: from + (at + 1) * height,
  }));
}

describe("groupInView", () => {
  it("names nothing before the sections have been laid out", () => {
    const unmeasured = stacked(0, 0);

    expect(groupInView(unmeasured, PANE, "position")).toBeNull();
  });

  it("names the section standing at the pane's top", () => {
    expect(groupInView(stacked(100), PANE, null)).toBe("emission");
    expect(groupInView(stacked(-100), PANE, null)).toBe("position");
  });

  it("passes over a section whose last sliver is all that shows", () => {
    expect(groupInView(stacked(-90), PANE, null)).toBe("position");
  });

  it("names the aimed section at the end of the scroll, where it cannot reach the top", () => {
    const end: PaneSpan = { ...PANE, atEnd: true };

    expect(groupInView(stacked(-150), end, "render")).toBe("render");
  });

  it("names the section at the top once the aimed one has left the pane", () => {
    const end: PaneSpan = { ...PANE, atEnd: true };

    expect(groupInView(stacked(300), end, "render")).toBe("emission");
  });
});

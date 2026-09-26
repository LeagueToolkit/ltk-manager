import { describe, expect, it } from "vitest";

import { isCollapseAllKey, isSubtreeClick } from "../treeGestures";

function press(
  key: string,
  modifiers: Partial<Record<"ctrl" | "meta" | "alt" | "shift", boolean>>,
) {
  return {
    key,
    ctrlKey: modifiers.ctrl ?? false,
    metaKey: modifiers.meta ?? false,
    altKey: modifiers.alt ?? false,
    shiftKey: modifiers.shift ?? false,
  };
}

describe("isCollapseAllKey", () => {
  it("takes Ctrl or Cmd with the left arrow", () => {
    expect(isCollapseAllKey(press("ArrowLeft", { ctrl: true }))).toBe(true);
    expect(isCollapseAllKey(press("ArrowLeft", { meta: true }))).toBe(true);
  });

  it("leaves a plain left arrow and the history's Alt+Left alone", () => {
    expect(isCollapseAllKey(press("ArrowLeft", {}))).toBe(false);
    expect(isCollapseAllKey(press("ArrowLeft", { alt: true }))).toBe(false);
    expect(isCollapseAllKey(press("ArrowLeft", { ctrl: true, alt: true }))).toBe(false);
    expect(isCollapseAllKey(press("ArrowLeft", { ctrl: true, shift: true }))).toBe(false);
  });
});

describe("isSubtreeClick", () => {
  const click = (
    held: Partial<Record<"altKey" | "shiftKey" | "ctrlKey" | "metaKey", boolean>>,
  ) => ({
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    ...held,
  });

  it("takes a click with Alt, Shift, Ctrl or Cmd held", () => {
    expect(isSubtreeClick(click({ altKey: true }))).toBe(true);
    expect(isSubtreeClick(click({ shiftKey: true }))).toBe(true);
    expect(isSubtreeClick(click({ ctrlKey: true }))).toBe(true);
    expect(isSubtreeClick(click({ metaKey: true }))).toBe(true);
  });

  it("leaves a plain click to one level", () => {
    expect(isSubtreeClick(click({}))).toBe(false);
    expect(isSubtreeClick(undefined)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import { keysOf } from "@/modules/keys";

import { CANVAS_BINDINGS, CANVAS_KEYS, canvasKey, type KeyTargets } from "../canvasKeys";
import type { ViewTransformControl } from "../useViewTransform";

/** Returns targets that record each call by name. */
function recorder(): { targets: KeyTargets; calls: string[] } {
  const calls: string[] = [];
  const transform = {
    fit: () => calls.push("fit"),
    frame: () => calls.push("frame"),
    zoomTo: () => calls.push("zoomTo"),
    zoomBy: () => calls.push("zoomBy"),
  } as unknown as ViewTransformControl;

  return {
    calls,
    targets: {
      transform,
      selected: { x: 0, y: 0, w: 1, h: 1 },
      clear: () => calls.push("clear"),
      nudge: (dx, dy) => calls.push(`nudge:${dx},${dy}`),
      arrange: (step) => calls.push(`arrange:${step}`),
      remove: () => calls.push("remove"),
    },
  };
}

/** Returns the press of `chord`, a key and the modifiers before it. */
function press(chord: string) {
  const parts = chord.split(/\+(?=.)/);
  const key = parts.at(-1) ?? "";

  return {
    key: key === "Space" ? " " : key,
    ctrlKey: parts.includes("Ctrl"),
    metaKey: false,
    altKey: parts.includes("Alt"),
    shiftKey: parts.includes("Shift"),
  };
}

describe("canvasKey", () => {
  it("answers every chord of every binding", () => {
    for (const { command } of Object.values(CANVAS_BINDINGS)) {
      for (const chord of keysOf(command)) {
        const { targets, calls } = recorder();

        expect(canvasKey(press(chord), targets), chord).toBe(true);
        expect(calls).toHaveLength(1);
      }
    }
  });

  it("returns false for a key outside the table", () => {
    const { targets, calls } = recorder();

    expect(canvasKey(press("Q"), targets)).toBe(false);
    expect(calls).toEqual([]);
  });

  it("arranges to the front and back on the braces that the menus show", () => {
    const { targets, calls } = recorder();

    canvasKey(press(CANVAS_KEYS.front), targets);
    canvasKey(press(CANVAS_KEYS.back), targets);

    expect(calls).toEqual(["arrange:front", "arrange:back"]);
  });

  it("runs one action for two keys of one binding", () => {
    const first = recorder();
    const second = recorder();

    canvasKey(press("="), first.targets);
    canvasKey(press("+"), second.targets);

    expect(first.calls).toEqual(second.calls);
  });
});

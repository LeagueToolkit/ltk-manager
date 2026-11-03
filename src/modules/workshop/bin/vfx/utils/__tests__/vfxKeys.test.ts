import { describe, expect, it } from "vitest";

import { keyEventOf, pressedKey, type VfxKey, vfxShortcut } from "../vfxKeys";

const NAMES: readonly VfxKey[] = [
  "play",
  "stepBack",
  "jumpBack",
  "slower",
  "markerAdd",
  "duplicate",
  "quickAdd",
  "systemNext",
  "curveKeyDelete",
];

describe("vfxShortcut", () => {
  it("shows the words of a keycap", () => {
    expect(vfxShortcut("stepBack")).toBe("Left");
    expect(vfxShortcut("jumpForward")).toBe("Shift+Right");
    expect(vfxShortcut("systemNext")).toBe("Alt+Down");
    expect(vfxShortcut("remove")).toBe("Del");
    expect(vfxShortcut("selectNone")).toBe("Esc");
  });
});

describe("pressedKey", () => {
  const bare = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };

  it("reads a chord in either letter case, and Meta as Ctrl", () => {
    expect(pressedKey({ ...bare, key: "d", ctrlKey: true }, "duplicate")).toBe(true);
    expect(pressedKey({ ...bare, key: "D", metaKey: true }, "duplicate")).toBe(true);
  });

  it("refuses a chord with one more modifier", () => {
    expect(pressedKey({ ...bare, key: "d", ctrlKey: true, shiftKey: true }, "duplicate")).toBe(
      false,
    );
    expect(pressedKey({ ...bare, key: "Delete", ctrlKey: true }, "remove")).toBe(false);
  });

  it("reads every chord of a key with two", () => {
    expect(pressedKey({ ...bare, key: "Tab" }, "quickAdd")).toBe(true);
    expect(pressedKey({ ...bare, key: "A", shiftKey: true }, "quickAdd")).toBe(true);
  });
});

describe("keyEventOf", () => {
  it("returns a press that reads back as the same key", () => {
    for (const name of NAMES) {
      const event = keyEventOf(name);
      const press = {
        key: event.key ?? "",
        ctrlKey: event.ctrlKey === true,
        metaKey: false,
        altKey: event.altKey === true,
        shiftKey: event.shiftKey === true,
      };

      expect(pressedKey(press, name), name).toBe(true);
    }
  });
});

import { describe, expect, it } from "vitest";

import { chordLabel, chordParts, chordText, type KeyPress } from "../chords";

function press(key: string, held: Partial<Omit<KeyPress, "key">> = {}): KeyPress {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...held };
}

describe("chordText", () => {
  it("writes the modifiers in a fixed order before the key", () => {
    expect(chordText(press("z", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Z");
    expect(chordText(press("b", { ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+B");
  });

  it("reads Meta as Ctrl", () => {
    expect(chordText(press("d", { metaKey: true }))).toBe("Ctrl+D");
  });

  it("drops Shift on a symbol that the layout types with it", () => {
    expect(chordText(press("?", { shiftKey: true }))).toBe("?");
    expect(chordText(press("+", { ctrlKey: true, shiftKey: true }))).toBe("Ctrl++");
  });

  it("names the space bar", () => {
    expect(chordText(press(" ", { shiftKey: true }))).toBe("Shift+Space");
  });

  it("reads a digit from the physical key on a layout that types a symbol there", () => {
    expect(chordText(press("&", { code: "Digit1", altKey: true }))).toBe("Alt+1");
    expect(chordText(press("0", { code: "Numpad0", ctrlKey: true }))).toBe("Ctrl+0");
  });

  it("reads a letter of a non-Latin layout from the physical key", () => {
    expect(chordText(press("я", { code: "KeyZ", ctrlKey: true }))).toBe("Ctrl+Z");
  });

  it("reads a Latin letter from the key, wherever the layout puts it", () => {
    expect(chordText(press("z", { code: "KeyW", ctrlKey: true }))).toBe("Ctrl+Z");
  });

  it("returns null for a modifier alone", () => {
    expect(chordText(press("Control", { ctrlKey: true }))).toBeNull();
    expect(chordText(press("Shift", { shiftKey: true }))).toBeNull();
  });
});

describe("chordParts", () => {
  it("keeps the plus key as a part of its own", () => {
    expect(chordParts("Ctrl++")).toEqual(["Ctrl", "+"]);
    expect(chordParts("+")).toEqual(["+"]);
    expect(chordParts("Shift+Space")).toEqual(["Shift", "Space"]);
  });
});

describe("chordLabel", () => {
  it("writes a key in the words of a keycap", () => {
    expect(chordLabel("Alt+ArrowDown")).toBe("Alt+Down");
    expect(chordLabel("Delete")).toBe("Del");
    expect(chordLabel("Escape")).toBe("Esc");
    expect(chordLabel("PageUp")).toBe("Page Up");
  });
});

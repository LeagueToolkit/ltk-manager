import { describe, expect, it } from "vitest";

import { AUDIO_KEYMAP, bindingOf, resolveCommand, shortcutOf } from "../keymap";

/** Returns a key press of `key` with the modifiers of `held`. */
function press(
  key: string,
  held: Partial<Record<"ctrl" | "meta" | "alt" | "shift", boolean>> = {},
) {
  return {
    key,
    ctrlKey: held.ctrl === true,
    metaKey: held.meta === true,
    altKey: held.alt === true,
    shiftKey: held.shift === true,
  };
}

describe("resolveCommand", () => {
  it("resolves a chord to the command that the surface binds to it", () => {
    expect(resolveCommand(press("d", { ctrl: true }), "voices")).toBe("duplicate");
    expect(resolveCommand(press("Delete"), "voices")).toBe("remove");
    expect(resolveCommand(press("ArrowUp", { alt: true }), "lines")).toBe("moveUp");
  });

  it("reads Meta as Ctrl and a letter in either case", () => {
    expect(resolveCommand(press("D", { meta: true }), "voices")).toBe("duplicate");
    expect(resolveCommand(press("c", { ctrl: true }), "media")).toBe("copy");
  });

  it("tells the space bar from Shift and the space bar", () => {
    expect(resolveCommand(press(" "), "voices")).toBe("play");
    expect(resolveCommand(press(" ", { shift: true }), "voices")).toBe("playAll");
  });

  it("resolves a symbol that the layout types with Shift", () => {
    expect(resolveCommand(press("+", { shift: true }), "lines")).toBe("volumeUp");
  });

  it("returns null for a chord that the editor or the app answers", () => {
    expect(resolveCommand(press("s", { ctrl: true }), "document")).toBeNull();
    expect(resolveCommand(press("f", { ctrl: true }), "document")).toBeNull();
    expect(resolveCommand(press("?", { shift: true }), "document")).toBeNull();
  });

  it("returns null for a command that the surface does not bind", () => {
    expect(resolveCommand(press("d", { ctrl: true }), "media")).toBeNull();
    expect(resolveCommand(press("Delete", { ctrl: true }), "voices")).toBeNull();
    expect(resolveCommand(press("x", { ctrl: true }), "lines")).toBeNull();
  });
});

describe("AUDIO_KEYMAP", () => {
  it("lists each command once", () => {
    const ids = AUDIO_KEYMAP.map((binding) => binding.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lists the surfaces of a command from its registry scopes", () => {
    expect(bindingOf("wrap").surfaces).toEqual(["voices"]);
    expect(bindingOf("loop").surfaces).toEqual(["lines", "document"]);
    expect(bindingOf("save").surfaces).toEqual(["document", "lines"]);
  });
});

describe("shortcutOf", () => {
  it("returns the first chord of a command in the words that a keycap shows", () => {
    expect(shortcutOf("duplicate")).toBe("Ctrl+D");
    expect(shortcutOf("moveDown")).toBe("Alt+Down");
    expect(shortcutOf("playAll")).toBe("Shift+Space");
    expect(shortcutOf("movePage")).toBe("Page Up");
    expect(shortcutOf("redo")).toBe("Ctrl+Shift+Z");
  });

  it("returns null for a command without a key", () => {
    expect(shortcutOf("typeAhead")).toBeNull();
    expect(shortcutOf("dragReorder")).toBeNull();
  });
});

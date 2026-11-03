import { describe, expect, it } from "vitest";

import { chordOfAccelerator } from "../accelerator";
import { commandTakenBy } from "../osHotkeys";

describe("chordOfAccelerator", () => {
  it("reads the modifiers of a Tauri accelerator in the chord's order", () => {
    expect(chordOfAccelerator("Shift+Ctrl+R")).toBe("Ctrl+Shift+R");
    expect(chordOfAccelerator("CmdOrCtrl+Alt+K")).toBe("Ctrl+Alt+K");
  });

  it("reads Super as Ctrl, as the app reads Meta", () => {
    expect(chordOfAccelerator("Super+S")).toBe("Ctrl+S");
  });

  it("names the keys that an accelerator spells otherwise", () => {
    expect(chordOfAccelerator("Ctrl+Plus")).toBe("Ctrl++");
    expect(chordOfAccelerator("Alt+Up")).toBe("Alt+ArrowUp");
  });

  it("returns null for an accelerator without a key", () => {
    expect(chordOfAccelerator("Ctrl+Shift")).toBeNull();
  });
});

describe("commandTakenBy", () => {
  it("returns the command that runs on the accelerator's chord", () => {
    expect(commandTakenBy("Ctrl+S")?.id).toBe("editor.save");
  });

  it("returns null for a chord that no command takes", () => {
    expect(commandTakenBy("Ctrl+Shift+K")).toBeNull();
  });
});

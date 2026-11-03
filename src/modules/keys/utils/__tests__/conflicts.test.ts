import { describe, expect, it } from "vitest";

import { findConflicts, RESERVED_CHORDS } from "../conflicts";
import { reservedChords } from "../osHotkeys";
import { COMMANDS } from "../registry";
import type { CommandSpec } from "../types";

function command(spec: Partial<CommandSpec> & Pick<CommandSpec, "id">): CommandSpec {
  return { title: () => spec.id, group: "general", scopes: ["app"], keys: [], ...spec };
}

describe("COMMANDS", () => {
  it("binds no chord that two commands on one scope path claim", () => {
    expect(findConflicts(COMMANDS, RESERVED_CHORDS)).toEqual([]);
  });

  it("gives every command a unique id", () => {
    const ids = COMMANDS.map((each) => each.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("names only commands of the registry in `shadows`", () => {
    const ids = new Set(COMMANDS.map((each) => each.id));
    const unknown = COMMANDS.flatMap((each) => each.shadows ?? []).filter((id) => !ids.has(id));

    expect(unknown).toEqual([]);
  });

  it("takes no chord of a typical pair of OS-global hotkeys", () => {
    const reserved = reservedChords({
      reloadModsHotkey: "Ctrl+Shift+R",
      killLeagueHotkey: "Ctrl+Shift+K",
    });

    expect(findConflicts(COMMANDS, reserved)).toEqual([]);
  });
});

describe("findConflicts", () => {
  it("reports two commands of one scope on one chord", () => {
    const a = command({ id: "a", keys: ["Ctrl+D"] });
    const b = command({ id: "b", keys: ["Ctrl+D"] });

    expect(findConflicts([a, b], [])).toEqual([{ chord: "Ctrl+D", command: "a", with: "b" }]);
  });

  it("reports a narrower scope that takes a wider command's chord without saying so", () => {
    const wide = command({ id: "wide", keys: ["Escape"], scopes: ["editor"] });
    const narrow = command({ id: "narrow", keys: ["Escape"], scopes: ["document:map"] });

    expect(findConflicts([wide, narrow], [])).toHaveLength(1);
    expect(findConflicts([wide, { ...narrow, shadows: ["wide"] }], [])).toEqual([]);
  });

  it("leaves two scopes on separate branches alone", () => {
    const skin = command({ id: "skin", keys: ["W"], scopes: ["document:skin"] });
    const map = command({ id: "map", keys: ["W"], scopes: ["document:map"] });

    expect(findConflicts([skin, map], [])).toEqual([]);
  });

  it("leaves two commands whose guards exclude each other alone", () => {
    const outside = command({ id: "outside", keys: ["Ctrl+D"], when: ["!project"] });
    const inside = command({ id: "inside", keys: ["Ctrl+D"], scopes: ["document:map"] });

    expect(findConflicts([outside, inside], [])).toEqual([]);
  });

  it("reports a command on a reserved chord", () => {
    const reload = command({ id: "reload", keys: ["Ctrl+R"] });

    expect(findConflicts([reload], RESERVED_CHORDS)).toEqual([
      { chord: "Ctrl+R", command: "reload", with: "webview reload" },
    ]);
  });
});

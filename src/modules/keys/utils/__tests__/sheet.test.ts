import { describe, expect, it } from "vitest";

import { COMMANDS } from "../registry";
import { sheetSections } from "../sheet";

describe("sheetSections", () => {
  it("lists the sections of the active scopes first, narrowest first", () => {
    const sections = sheetSections(["focus:audio.events", "document:audio", "editor", "app"]);

    expect(sections.slice(0, 3).map((each) => each.section)).toEqual(["audio", "editor", "app"]);
  });

  it("lists every command with a chord, and every gesture", () => {
    const listed = sheetSections([]).flatMap((section) =>
      section.groups.flatMap((group) => group.commands.map((command) => command.id)),
    );
    const expected = COMMANDS.filter(
      (command) =>
        (command.keys.length > 0 || command.gesture === true) &&
        !(command.when ?? []).includes("dev"),
    ).map((command) => command.id);

    expect(listed).toEqual(expect.arrayContaining(expected));
  });

  it("leaves out a command that only a menu runs", () => {
    const listed = sheetSections([]).flatMap((section) =>
      section.groups.flatMap((group) => group.commands.map((command) => command.id)),
    );

    expect(listed).not.toContain("audio.rename");
    expect(listed).toContain("audio.dragReorder");
  });
});

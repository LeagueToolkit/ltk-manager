import { COMMANDS } from "./registry";
import { SCOPE_SECTIONS, type ScopeId, type SheetSection } from "./scopes";
import type { CommandGroup, CommandSpec } from "./types";

/** The order of the groups inside a section of the sheet. */
const GROUP_ORDER: readonly CommandGroup[] = [
  "general",
  "transport",
  "navigation",
  "view",
  "tools",
  "editing",
  "pointer",
];

/** The order of the sections when no scope of theirs is active. */
const SECTION_ORDER: readonly SheetSection[] = [
  "app",
  "library",
  "workshop",
  "editor",
  "lists",
  "explorer",
  "audio",
  "voiceLines",
  "fields",
  "vfx",
  "curves",
  "skin",
  "map",
  "atlas",
];

/** One group of a section of the sheet. */
export interface SheetGroup {
  readonly group: CommandGroup;
  readonly commands: readonly CommandSpec[];
}

/** One section of the sheet: a document, a widget family or the app. */
export interface SheetSectionGroups {
  readonly section: SheetSection;
  readonly groups: readonly SheetGroup[];
}

/** Returns `true` if the sheet lists `command`: one with a chord, or a gesture. */
function listed(command: CommandSpec): boolean {
  if (command.keys.length === 0 && command.gesture !== true) return false;

  return !(command.when ?? []).includes("dev") || import.meta.env.DEV;
}

/** Returns the section of `command`, which is the section of its first scope. */
function sectionOf(command: CommandSpec): SheetSection {
  const [scope] = command.scopes;

  return scope === undefined ? "app" : SCOPE_SECTIONS[scope];
}

/**
 * Returns the sections of the sheet: the sections of `active` first, narrowest first, then the
 * rest in their own order. A section or a group without a listed command is left out.
 */
export function sheetSections(
  active: readonly ScopeId[],
  commands: readonly CommandSpec[] = COMMANDS,
): SheetSectionGroups[] {
  const first = [...new Set(active.map((scope) => SCOPE_SECTIONS[scope]))];
  const order = [...first, ...SECTION_ORDER.filter((section) => !first.includes(section))];
  const shown = commands.filter(listed);

  return order
    .map((section) => {
      const inSection = shown.filter((command) => sectionOf(command) === section);
      const groups = GROUP_ORDER.map((group) => ({
        group,
        commands: inSection.filter((command) => command.group === group),
      })).filter((each) => each.commands.length > 0);

      return { section, groups };
    })
    .filter((section) => section.groups.length > 0);
}

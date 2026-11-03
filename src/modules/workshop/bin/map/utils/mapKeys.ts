/**
 * The map commands of the key registry, by the name that the map's handlers and menus use.
 *
 * Per "Keys" in docs/ux/MAP_EDITOR.md. The tools keep their `MapTool` name.
 */
import { commandAt, type CommandId, shortcutOf } from "@/modules/keys";

/** The registry command of each map command. */
const MAP_COMMANDS = {
  select: "map.select",
  move: "map.move",
  rotate: "map.rotate",
  scale: "map.scale",
  place: "map.place",
  localAxes: "map.localAxes",
  frameSelection: "map.frameSelection",
  hide: "map.hide",
  showAll: "map.showAll",
  delete: "map.delete",
  duplicate: "map.duplicate",
  rename: "map.rename",
  drop: "map.drop",
  selectAll: "map.selectAll",
  selectNone: "map.selectNone",
} as const satisfies Readonly<Record<string, CommandId>>;

/** A command that a key of the map answers. */
export type MapKeyCommand = keyof typeof MAP_COMMANDS;

/** The key that a menu or a tooltip shows for each map command. */
export const MAP_KEYS = Object.fromEntries(
  Object.entries(MAP_COMMANDS).map(([name, id]) => [name, shortcutOf(id)]),
) as Readonly<Record<MapKeyCommand, string>>;

/** The fields of a keyboard event that decide its command. */
export interface MapKeyEvent {
  readonly key: string;
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}

const BY_ID: ReadonlyMap<CommandId, MapKeyCommand> = new Map(
  Object.entries(MAP_COMMANDS).map(([name, id]) => [id, name as MapKeyCommand]),
);

/**
 * Returns the command that `event` asks for, or null if it matches no map command.
 *
 * Shift is ignored, so a tool key answers while Shift is held for a drag.
 */
export function mapKeyCommand(event: MapKeyEvent): MapKeyCommand | null {
  const id = commandAt({ ...event, shiftKey: false }, "document:map");

  return id === null ? null : (BY_ID.get(id) ?? null);
}

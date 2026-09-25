import type { BinRow } from "@/lib/tauri";

import { chunkPath } from "../../links/utils/linkDecision";

/** The file kinds a path field can expect, and the extensions of each. */
const KIND_EXTENSIONS = {
  texture: ["dds", "tex", "png", "tga"],
  mesh: ["scb", "sco", "skn"],
  skeleton: ["skl"],
  animation: ["anm"],
  bin: ["bin"],
} as const satisfies Record<string, readonly string[]>;

type AssetKind = keyof typeof KIND_EXTENSIONS;

/**
 * Property name endings of path fields, and the kind each expects.
 *
 * Compared with the lowercased name without the `m` prefix. The first match wins, so a
 * longer ending is listed before a shorter ending it contains.
 */
const NAME_ENDINGS: readonly (readonly [ending: string, kind: AssetKind | null])[] = [
  ["texturename", "texture"],
  ["texturepath", "texture"],
  ["texture", "texture"],
  ["mapname", "texture"],
  ["meshname", "mesh"],
  ["simpleskin", "mesh"],
  ["skeletonname", "skeleton"],
  ["skeleton", "skeleton"],
  ["animationfilepath", "animation"],
  ["filepath", null],
  ["filename", null],
  ["path", null],
];

/** Names that end like a path field but are not one: `mapName` is a map's name, `path` is too general. */
const BARE_ENDINGS: ReadonlySet<string> = new Set(["mapname", "path"]);

/** A name that starts with this prefix is an icon, which is a texture. */
const ICON_PREFIX = "icon";

/** How a row's path field ranks and picks suggestions. */
export interface PathField {
  /** The extensions the field expects, without the dot. Empty where nothing says. */
  readonly extensions: readonly string[];
  /**
   * `Enter` on search terms picks the top suggestion. False for a string that contains text
   * other than a path, which only its property name made a path field, so `Enter` keeps
   * the typed text.
   */
  readonly enterPicks: boolean;
}

/**
 * The path field a row edits in, or null for a row that edits as plain text.
 *
 * Per "A path field" in docs/ux/BIN_EDITOR.md: every `file` value, a string that contains a
 * path, and a string whose property name has a path field's ending.
 */
export function pathFieldOf(row: BinRow): PathField | null {
  const { value } = row;
  const name = row.node === "property" && !row.unnamed ? row.name : null;

  if (value.type === "wadChunkLink") {
    return { extensions: expectedExtensions(value.path, name), enterPicks: true };
  }
  if (value.type !== "string") return null;

  const path = chunkPath(value.value);
  if (path === null && (name === null || nameKind(name) === undefined)) return null;

  return {
    extensions: expectedExtensions(path, name),
    enterPicks: path !== null || value.value === "",
  };
}

/** The extensions of the current path's kind, or of the kind the property name implies. */
function expectedExtensions(path: string | null, name: string | null): readonly string[] {
  const pathKind = path === null ? undefined : kindOfExtension(extensionOf(path));
  const kind = pathKind ?? (name === null ? null : (nameKind(name) ?? null));
  return kind === null ? [] : KIND_EXTENSIONS[kind];
}

/**
 * The kind a property name implies. Null for a path field with no specific kind, and
 * undefined for a name that is not a path field.
 */
function nameKind(name: string): AssetKind | null | undefined {
  const bare = /^m[A-Z]/.test(name) ? name.slice(1) : name;
  const lower = bare.toLowerCase();

  if (lower.startsWith(ICON_PREFIX)) return "texture";

  const found = NAME_ENDINGS.find(([ending]) => lower.endsWith(ending));
  if (found === undefined || BARE_ENDINGS.has(lower)) return undefined;

  return found[1];
}

function kindOfExtension(extension: string): AssetKind | undefined {
  return (Object.keys(KIND_EXTENSIONS) as AssetKind[]).find((kind) =>
    (KIND_EXTENSIONS[kind] as readonly string[]).includes(extension),
  );
}

/** A path's extension lowercased, without the dot, or empty for a name that has none. */
export function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot < 1 ? "" : name.slice(dot + 1).toLowerCase();
}

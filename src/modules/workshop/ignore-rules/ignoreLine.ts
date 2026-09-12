import type { IgnoreMatch } from "@/lib/tauri";

/**
 * The `.modignore` lines the row menu writes - per "Ignore rules" in
 * docs/ux/PROJECT_EDITOR.md.
 */

/** Characters the matcher reads as syntax rather than as a name. */
const SYNTAX = /[\\*?[{!#]/g;

/** The project's root file, as a rule names the file it came from. */
const ROOT_FILE = ".modignore";

/** One path segment as a pattern that means that name and nothing else. */
function escapeSegment(segment: string): string {
  return segment
    .replace(SYNTAX, (character) => `\\${character}`)
    .replace(/^ /, "\\ ")
    .replace(/ $/, "\\ ");
}

/** `relativePath` under `layerName`, anchored the way the root file counts. */
function anchored(layerName: string, relativePath: string): string {
  const segments = [layerName, ...relativePath.split("/")].filter((segment) => segment.length > 0);
  return `/${segments.map(escapeSegment).join("/")}`;
}

/** The line that leaves one file out, wherever the row's layer sits. */
export function fileIgnoreLine(layerName: string, relativePath: string): string {
  return anchored(layerName, relativePath);
}

/** The line that leaves one folder out, along with everything under it. */
export function folderIgnoreLine(layerName: string, relativePath: string): string {
  return `${anchored(layerName, relativePath)}/`;
}

/**
 * The line that leaves every file of `fileName`'s kind out, or null for a name
 * carrying no extension.
 *
 * Unanchored and written raw, so it covers every layer and reads as the
 * pattern a creator would write by hand.
 */
export function extensionIgnoreLine(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return null;
  return `*${fileName.slice(dot)}`;
}

/** `text` with `line` under it, whether or not the file ended in a newline. */
export function appendIgnoreLine(text: string, line: string): string {
  const ended = text.length === 0 || text.endsWith("\n") ? text : `${text}\n`;
  return `${ended}${line}\n`;
}

/**
 * `text` without `line`, the last of several identical ones going first.
 *
 * The last is the one the matcher's last-match-wins reported, so it is the one
 * a rule's own line names.
 */
export function removeIgnoreLine(text: string, line: string): string {
  const lines = text.split("\n");
  let at = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index]!.trimEnd() === line) at = index;
  }
  if (at < 0) return text;

  lines.splice(at, 1);
  return lines.join("\n");
}

/** A row, as the little a line needs to know about it. */
export interface IgnoreRow {
  /** Path relative to the layer root, POSIX-style. */
  readonly relativePath: string;
  readonly isDir: boolean;
}

/**
 * Whether `rule` is the line this row's own menu wrote.
 *
 * A broader pattern and a nested file both decide the row without naming it,
 * and neither can be taken back by deleting one line.
 */
export function isOwnLine(rule: IgnoreMatch, layerName: string, row: IgnoreRow): boolean {
  if (rule.source !== ROOT_FILE) return false;

  const own = row.isDir
    ? folderIgnoreLine(layerName, row.relativePath)
    : fileIgnoreLine(layerName, row.relativePath);
  return rule.pattern === own;
}

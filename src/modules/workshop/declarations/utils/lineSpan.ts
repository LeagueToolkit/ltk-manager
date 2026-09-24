import type { LineSpan } from "@/lib/tauri";

/** Where the one-based `line` and character `column` fall in `text`, as a string index. */
function offsetOf(lines: readonly string[], line: number, column: number): number {
  const index = Math.min(Math.max(line, 1), lines.length) - 1;
  const before = lines.slice(0, index).reduce((total, held) => total + held.length + 1, 0);
  const held = lines[index] ?? "";
  const prefix = Array.from(held)
    .slice(0, Math.max(column, 1) - 1)
    .join("");

  return before + prefix.length;
}

/**
 * Where `span` falls in `text`, as a selection.
 *
 * The backend counts a column in characters and the buffer in UTF-16 units, so a line is
 * walked by code point. A span ending at the start of a line stops at the end of the one
 * above.
 */
export function selectionOf(text: string, span: LineSpan): [number, number] {
  const lines = text.split("\n");
  const from = offsetOf(lines, span.line, span.column);
  const to = offsetOf(lines, span.endLine, span.endColumn);
  const trimmed = to > from && text[to - 1] === "\n" ? to - 1 : to;

  return [from, Math.max(from, trimmed)];
}

/** What a run of a YAML line spells. */
export type YamlTokenKind =
  | "space"
  | "comment"
  | "punct"
  | "key"
  | "tag"
  | "class"
  | "string"
  | "scalar";

/** One run of a YAML line. */
export interface YamlToken {
  kind: YamlTokenKind;
  text: string;
}

/** A struct pin's kind and its class, `!embed(C)` or `embed: {class: C}`. */
export interface YamlTag {
  name: string;
  className: string | null;
}

/** A key's value as the outline sums it up on one line. */
export type ValueSummary =
  /** The value as one line of YAML: its own line, or a block folded into flow. */
  | { kind: "line"; tokens: YamlToken[] }
  /** A game-copy reference, `!ref <entry>:<path>`. */
  | { kind: "reference"; target: string }
  /** A struct pin, by its kind and class. */
  | { kind: "struct"; tag: YamlTag }
  /** A block list whose items are all struct pins of one class. */
  | { kind: "structs"; items: number; tag: YamlTag };

const FLOW = new Set(["[", "]", "{", "}", ","]);
const TAG_NAME = /^!([A-Za-z0-9_-]*)(?:\(([^)]*)\))?/;
const STRUCT_TAG = /^!(pointer|embed)(?:\(([^)]*)\))?(?:\s|$)/;
const STRUCT_KEY = /^(pointer|embed):(?:\s*\{.*?\bclass:\s*([^,}\s]+))?/;
const CLASS_LINE = /^\s*class:\s*(\S+)\s*$/;
const REFERENCE = /^(?:!ref\s+|\{?\s*ref:\s*)(.+?)\s*\}?$/;
const KEY_LINE = /^(?:"[^"]*"|'[^']*'|[^\s#"'[\]{},][^:#]*?):(?:\s|$)/;

/**
 * The runs of one line of YAML, for colouring.
 *
 * A reading of the surface only: it tells a key from a scalar by the `: ` after it and knows
 * no flow context, which is enough for the values a manifest spells.
 */
export function tokenizeYamlLine(line: string): YamlToken[] {
  const tokens: YamlToken[] = [];
  const push = (kind: YamlTokenKind, text: string) => {
    if (text.length > 0) tokens.push({ kind, text });
  };
  let at = 0;
  let itemPosition = true;

  while (at < line.length) {
    const char = line[at]!;

    if (char === " " || char === "\t") {
      const end = runEnd(line, at, (next) => next === " " || next === "\t");
      push("space", line.slice(at, end));
      at = end;
      continue;
    }

    if (char === "#" && (at === 0 || line[at - 1] === " ")) {
      push("comment", line.slice(at));
      break;
    }

    if (char === "-" && itemPosition && (line[at + 1] === " " || at + 1 === line.length)) {
      push("punct", "-");
      at += 1;
      continue;
    }
    itemPosition = false;

    if (char === "!") {
      const match = TAG_NAME.exec(line.slice(at))!;
      push("tag", `!${match[1]}`);
      if (match[2] !== undefined) {
        push("punct", "(");
        push("class", match[2]);
        push("punct", ")");
      }
      at += match[0].length;
      continue;
    }

    if (char === '"' || char === "'") {
      const end = quotedEnd(line, at);
      const text = line.slice(at, end);
      at = end;
      push(isKeyEnd(line, at) ? "key" : "string", text);
      continue;
    }

    if (FLOW.has(char)) {
      push("punct", char);
      at += 1;
      continue;
    }

    if (char === ":" && isKeyEnd(line, at)) {
      push("punct", ":");
      at += 1;
      itemPosition = false;
      continue;
    }

    const end = plainEnd(line, at);
    const text = line.slice(at, end);
    at = end;
    push(isKeyEnd(line, at) ? "key" : "scalar", text);
  }

  return tokens;
}

/**
 * The value text of one key, summed up for a single row.
 *
 * A struct pin reads as its kind and class, in the tag form and in the document form alike. A
 * block list folds to its items' first lines in brackets, and a block mapping to its keys in
 * braces, a nested value standing as `…`.
 */
export function summarizeValue(value: string): ValueSummary {
  const lines = value.split("\n").filter((line) => line.trim().length > 0);
  const first = lines[0] ?? "";

  const reference = REFERENCE.exec(first.trim());
  if (lines.length <= 1 && reference) {
    return { kind: "reference", target: unquote(reference[1]!) };
  }
  if (lines.length <= 1) return { kind: "line", tokens: tokenizeYamlLine(first) };

  const tag = structOf(lines);
  if (tag !== null) return { kind: "struct", tag };

  if (first.startsWith("-")) {
    const items = blocks(lines, (line) => /^-(?:\s|$)/.test(line)).map(itemLines);
    const tags = items.map(structOf);
    const shared = tags[0];
    if (shared && tags.every((each) => each !== null && sameTag(each, shared))) {
      return { kind: "structs", items: items.length, tag: shared };
    }

    const folded = items.map((item) => foldedLine(item));
    return { kind: "line", tokens: tokenizeYamlLine(`[${folded.join(", ")}]`) };
  }

  const entries = blocks(lines, (line) => KEY_LINE.test(line));
  const folded = entries.map((entry) => foldedLine(entry));
  return { kind: "line", tokens: tokenizeYamlLine(`{${folded.join(", ")}}`) };
}

/** The struct pin `lines` spell, if they spell one. */
function structOf(lines: readonly string[]): YamlTag | null {
  const first = (lines[0] ?? "").trim();

  const tagged = STRUCT_TAG.exec(first);
  if (tagged) return { name: tagged[1]!, className: tagged[2] ?? null };

  const keyed = STRUCT_KEY.exec(first);
  if (!keyed) return null;
  if (keyed[2] !== undefined) return { name: keyed[1]!, className: unquote(keyed[2]) };

  const declared = lines.slice(1).map((line) => CLASS_LINE.exec(line)?.[1]);
  const className = declared.find((found) => found !== undefined);
  return { name: keyed[1]!, className: className === undefined ? null : unquote(className) };
}

/** The lines of `lines` split where `starts` holds, each group led by such a line. */
function blocks(lines: readonly string[], starts: (line: string) => boolean): string[][] {
  const groups: string[][] = [];
  for (const line of lines) {
    if (starts(line) || groups.length === 0) {
      groups.push([line]);
    } else {
      groups.at(-1)!.push(line);
    }
  }
  return groups;
}

/** A list item's lines as a value of its own: the dash dropped, the rest moved left. */
function itemLines(item: readonly string[]): string[] {
  const [first = "", ...rest] = item;
  const inner = first.replace(/^-\s?/, "");
  return [inner, ...rest.map((line) => line.replace(/^ {1,2}/, ""))];
}

/** A value's first line, `…` standing for what the lines under it hold. */
function foldedLine(lines: readonly string[]): string {
  const first = (lines[0] ?? "").trimEnd();
  return lines.length === 1 ? first : `${first} …`;
}

function sameTag(a: YamlTag, b: YamlTag): boolean {
  return a.name === b.name && a.className === b.className;
}

function unquote(text: string): string {
  const trimmed = text.trim();
  const quoted =
    trimmed.length >= 2 &&
    (trimmed[0] === '"' || trimmed[0] === "'") &&
    trimmed.at(-1) === trimmed[0];
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

function runEnd(line: string, from: number, keep: (char: string) => boolean): number {
  let at = from;
  while (at < line.length && keep(line[at]!)) at += 1;
  return at;
}

/** The index just past a quoted scalar opening at `from`. */
function quotedEnd(line: string, from: number): number {
  const quote = line[from]!;
  let at = from + 1;
  while (at < line.length) {
    if (quote === '"' && line[at] === "\\") {
      at += 2;
      continue;
    }
    if (line[at] === quote) {
      if (quote === "'" && line[at + 1] === "'") {
        at += 2;
        continue;
      }
      return at + 1;
    }
    at += 1;
  }
  return line.length;
}

/** The index a plain scalar starting at `from` runs to. */
function plainEnd(line: string, from: number): number {
  let at = from;
  while (at < line.length) {
    const char = line[at]!;
    if (FLOW.has(char)) break;
    if (char === ":" && isKeyEnd(line, at)) break;
    if (char === "#" && line[at - 1] === " ") break;
    at += 1;
  }
  while (at > from && line[at - 1] === " ") at -= 1;
  return at;
}

/** Whether the text at `at` is the `:` that ends a key. */
function isKeyEnd(line: string, at: number): boolean {
  return line[at] === ":" && (at + 1 === line.length || line[at + 1] === " ");
}

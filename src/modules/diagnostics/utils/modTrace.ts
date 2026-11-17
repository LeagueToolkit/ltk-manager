import { m } from "@/i18n";
import type {
  GameReading,
  ModHealth,
  OverlayOutcome,
  OverlayReading,
  RowReading,
  TraceRow,
} from "@/lib/tauri";

import { advisoryText } from "./advisories";
import { formatClock } from "./incident";

/** The sentences of a tagged union, exhaustive over the tag `Tag`. A member without a sentence fails `tsc`. */
type Catalog<Union, Tag extends keyof Union> = {
  readonly [Kind in Union[Tag] & string]: (
    reading: Extract<Union, Record<Tag, Kind>>,
    now: Date,
  ) => string;
};

/** The sentence for each health of a mod. */
const HEALTH_TEXT: Readonly<Record<ModHealth, (when: string) => string>> = {
  healthy: (when) => m["trace.health.healthy"]({ when }),
  repairable: (when) => m["trace.health.repairable"]({ when }),
  unrepairable: (when) => m["trace.health.unrepairable"]({ when }),
};

/** The sentence for each outcome of an overlay. */
const OUTCOME_TEXT: Readonly<Record<OverlayOutcome, () => string>> = {
  live: () => m["trace.outcome.live"](),
  "too-late": () => m["trace.outcome.too-late"](),
  "end-of-life": () => m["trace.outcome.end-of-life"](),
  disabled: () => m["trace.outcome.disabled"](),
  "hook-failed": () => m["trace.outcome.hook-failed"](),
  refused: () => m["trace.outcome.refused"](),
  none: () => m["trace.outcome.none"](),
};

/** The sentence for each reading of the overlay row. */
const OVERLAY_TEXT: Catalog<OverlayReading, "reading"> = {
  built: ({ builtAt }, now) => m["trace.overlay.built"]({ when: formatWhen(builtAt, now) }),
  stale: ({ builtAt }, now) => m["trace.overlay.stale"]({ when: formatWhen(builtAt, now) }),
  "not-built": () => m["trace.overlay.not-built"](),
  "left-out": () => m["trace.overlay.left-out"](),
  "without-mod": ({ builtAt }, now) =>
    m["trace.overlay.without-mod"]({ when: formatWhen(builtAt, now) }),
};

/** The sentence for each reading of the last game row. */
const GAME_TEXT: Catalog<GameReading, "reading"> = {
  "no-game": () => m["trace.last-game.no-game"](),
  "patcher-not-running": () => m["trace.last-game.patcher-not-running"](),
  unwatched: () => m["trace.last-game.unwatched"](),
  "overlay-not-live": () => m["trace.last-game.overlay-not-live"](),
  "archives-not-served": ({ archives }) =>
    m["trace.last-game.archives-not-served"]({ count: archives.length }),
  "archives-not-loaded": ({ champions }) => {
    if (champions.length === 0) return m["trace.last-game.archives-not-loaded"]();
    return m["trace.last-game.champions-absent"]({
      count: champions.length,
      names: champions.join(", "),
    });
  },
  loaded: ({ loaded, total }) => {
    if (loaded === total) return m["trace.last-game.loaded"]();
    return m["trace.last-game.partly-loaded"]({ loaded, total });
  },
  "overlay-live": () => m["trace.last-game.overlay-live"](),
};

/** The sentence for each row. */
const ROW_TEXT: Catalog<RowReading, "row"> = {
  enabled: ({ enabled, profile }) => {
    if (enabled) return m["trace.enabled.yes"]({ profile });
    return m["trace.enabled.no"]({ profile });
  },
  health: ({ check }, now) => {
    if (!check) return m["trace.health.unchecked"]();
    return HEALTH_TEXT[check.health](formatWhen(check.checkedAt, now));
  },
  overlay: (row, now) => worded(OVERLAY_TEXT, row.reading)(row, now),
  archives: ({ archives }) => {
    if (archives.length === 0) return m["trace.archives.none"]();
    return m["trace.archives.some"]({ count: archives.length, names: archives.join(", ") });
  },
  advisory: ({ code }) => advisoryText(code),
  "last-game": (row, now) => worded(GAME_TEXT, row.reading)(row, now),
};

/** Returns the sentence function of `kind` in `catalog`, typed for every member of the union. */
function worded<Union, Tag extends keyof Union>(
  catalog: Catalog<Union, Tag>,
  kind: Union[Tag] & string,
): (reading: Union, now: Date) => string {
  return catalog[kind] as (reading: Union, now: Date) => string;
}

/**
 * Returns a time for a sentence: the clock for a time on the day of `now`, and the date with
 * the clock for another day.
 */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (date.toDateString() === now.toDateString()) return formatClock(iso);

  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Returns the sentence of `row`. */
export function rowText(row: RowReading, now: Date = new Date()): string {
  return worded(ROW_TEXT, row.row)(row, now);
}

/**
 * Returns the second line of `row`: the sentence of the advisory, the reason and the code of
 * the patcher, or the archives. Returns `null` for a row with one line.
 */
export function rowDetail(row: RowReading): string | null {
  if (row.row === "overlay" && row.reading === "left-out") return advisoryText(row.advisory);
  if (row.row !== "last-game") return null;

  switch (row.reading) {
    case "overlay-not-live":
      return [OUTCOME_TEXT[row.outcome](), row.patcherCode].filter(Boolean).join(" ");
    case "archives-not-served":
      return row.archives.join(", ");
    default:
      return null;
  }
}

/** The action that the panel offers first. */
export type TraceFix = "rebuild" | "autostart" | "help";

/** The readings of the overlay row that a rebuild of the overlay fixes. */
const REBUILD_FIXES: readonly OverlayReading["reading"][] = ["not-built", "without-mod", "stale"];

/**
 * Returns the action that the panel offers first for `rows`.
 *
 * Returns `rebuild` if a row holds a reading that a rebuild fixes. Returns `autostart` if the
 * manager was not running during the last game. Returns `help` otherwise.
 */
export function traceFix(rows: readonly TraceRow[]): TraceFix {
  const rebuilds = rows.some(
    (row) =>
      (row.row === "overlay" && REBUILD_FIXES.includes(row.reading)) ||
      (row.row === "last-game" && row.reading === "archives-not-served"),
  );
  if (rebuilds) return "rebuild";
  if (rows.some((row) => row.row === "last-game" && row.reading === "unwatched")) {
    return "autostart";
  }

  return "help";
}

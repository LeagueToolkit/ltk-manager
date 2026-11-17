import { m } from "@/i18n";
import type { ModHealth, OverlayOutcome, TraceFact, TraceRow } from "@/lib/tauri";

import { advisoryText } from "./advisories";
import { formatClock } from "./incident";

type FactKind = TraceFact["kind"];
type FactOf<K extends FactKind> = Extract<TraceFact, { kind: K }>;

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

/** The sentence of each fact, exhaustive over the kinds. A kind without a sentence fails `tsc`. */
const FACT_TEXT: { readonly [K in FactKind]: (fact: FactOf<K>, now: Date) => string } = {
  enabled: ({ profile }) => m["trace.enabled"]({ profile }),
  "not-enabled": ({ profile }) => m["trace.not-enabled"]({ profile }),
  health: ({ health, checkedAt }, now) => HEALTH_TEXT[health](formatWhen(checkedAt, now)),
  "health-unchecked": () => m["trace.health-unchecked"](),
  "overlay-built": ({ builtAt }, now) =>
    m["trace.overlay-built"]({ when: formatWhen(builtAt, now) }),
  "overlay-stale": ({ builtAt }, now) =>
    m["trace.overlay-stale"]({ when: formatWhen(builtAt, now) }),
  "overlay-not-built": () => m["trace.overlay-not-built"](),
  "overlay-left-out": () => m["trace.overlay-left-out"](),
  "overlay-without-mod": ({ builtAt }, now) =>
    m["trace.overlay-without-mod"]({ when: formatWhen(builtAt, now) }),
  archives: ({ archives }) =>
    m["trace.archives"]({ count: archives.length, names: archives.join(", ") }),
  "no-archives": () => m["trace.no-archives"](),
  advisory: ({ code }) => advisoryText(code),
  "game-none": () => m["trace.game-none"](),
  "game-patcher-not-running": () => m["trace.game-patcher-not-running"](),
  "game-unwatched": () => m["trace.game-unwatched"](),
  "game-overlay-not-live": () => m["trace.game-overlay-not-live"](),
  "game-archives-not-served": ({ archives }) =>
    m["trace.game-archives-not-served"]({ count: archives.length }),
  "game-archives-not-loaded": ({ champions }) => {
    if (champions.length === 0) return m["trace.game-archives-not-loaded"]();
    return m["trace.game-champions-absent"]({
      count: champions.length,
      names: champions.join(", "),
    });
  },
  "game-loaded": ({ loaded, total }) => {
    if (loaded === total) return m["trace.game-loaded"]();
    return m["trace.game-partly-loaded"]({ loaded, total });
  },
  "game-overlay-live": () => m["trace.game-overlay-live"](),
};

/**
 * Returns a time for a sentence: the clock for a time on the day of `now`, and the date with
 * the clock for another day.
 */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (date.toDateString() === now.toDateString()) return formatClock(iso);

  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** Returns the sentence of `fact`. */
export function factText(fact: TraceFact, now: Date = new Date()): string {
  const text = FACT_TEXT[fact.kind] as (fact: TraceFact, now: Date) => string;
  return text(fact, now);
}

/**
 * Returns the second line of `fact`: the sentence of the advisory, the reason and the code
 * of the patcher, or the archives. Returns `null` for a fact with one line.
 */
export function factDetail(fact: TraceFact): string | null {
  switch (fact.kind) {
    case "overlay-left-out":
      return advisoryText(fact.advisory);
    case "game-overlay-not-live":
      return [OUTCOME_TEXT[fact.outcome](), fact.patcherCode].filter(Boolean).join(" ");
    case "game-archives-not-served":
      return fact.archives.join(", ");
    default:
      return null;
  }
}

/** The action that the panel offers first. */
export type TraceFix = "rebuild" | "autostart" | "help";

/** The kinds of fact that a rebuild of the overlay fixes. */
const REBUILD_FIXES: readonly FactKind[] = [
  "overlay-not-built",
  "overlay-without-mod",
  "overlay-stale",
  "game-archives-not-served",
];

/**
 * Returns the action that the panel offers first for `rows`.
 *
 * Returns `rebuild` if a row holds a fact that a rebuild fixes. Returns `autostart` if the
 * manager was not running during the last game. Returns `help` otherwise.
 */
export function traceFix(rows: readonly TraceRow[]): TraceFix {
  if (rows.some((row) => REBUILD_FIXES.includes(row.fact.kind))) return "rebuild";
  if (rows.some((row) => row.fact.kind === "game-unwatched")) return "autostart";

  return "help";
}

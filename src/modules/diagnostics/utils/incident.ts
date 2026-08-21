import type { Confidence, Ending, Incident, SessionOrigin, VerdictKind } from "@/lib/tauri";

const DAY_MS = 86_400_000;

/**
 * A verdict that reports facts without blaming anything is information, and
 * one that names a failure is a warning. The glyph and the toast follow this.
 */
export function isInformational(kind: VerdictKind): boolean {
  return kind === "unmodded" || kind === "ended-without-reason";
}

/**
 * The game rejected an archive for carrying a Riot skin ported onto a base
 * champion. The status alone is not enough: another failure can outrank the
 * rejection and win the verdict, and the art belongs to the verdict.
 */
export function isSkinhackRejection(incident: Incident): boolean {
  return incident.verdict.kind === "archive-rejected" && incident.scanStatus === "skinhack";
}

/** The line under a row's title: the subject where there is one, else the first suspect. */
export function subjectLine(incident: Incident): string | null {
  return incident.verdict.subject ?? incident.suspects[0]?.displayName ?? null;
}

/** `HH:mm` in the user's locale, on a 24-hour clock. */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** The local calendar day an instant falls on, as a key that groups equal days. */
export function dayKey(iso: string): number {
  return startOfDay(new Date(iso));
}

/** `Today`, `Yesterday`, or the date, for the heading over a day's rows. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** `12 s`, `4 min`, `1 h 20 min`. */
export function formatSeconds(secs: number): string {
  if (secs < 60) return `${secs} s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

/** How long the game ran, or null when the two stamps do not make a span. */
export function formatDuration(startedAt: string, endedAt: string): string | null {
  const secs = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(secs) || secs < 0) return null;
  return formatSeconds(secs);
}

/** `Library`, or `Testing 2 projects`. */
export function formatOrigin(origin: SessionOrigin): string {
  if (origin.kind === "library") return "Library";
  const count = origin.projects.length;
  if (count === 1) return "Testing 1 project";
  return `Testing ${count} projects`;
}

/** The client's reason and code, and whether crashpad ran, in one clause. */
export function describeEnding(ending: Ending): string {
  const parts: string[] = [];
  if (ending.exitReason) parts.push(ending.exitReason);
  if (ending.exitCode !== null) parts.push(`exit code ${ending.exitCode}`);
  if (ending.crashed === true) parts.push("crashpad ran");
  if (parts.length === 0) return "No reason recorded";
  return parts.join(", ");
}

/** The route param for a workshop project is its directory name. */
export function projectNameFromPath(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

/** The verdict titles by the number the token carries them as. */
export const TOKEN_VERDICT_TITLES: Readonly<Record<number, string>> = {
  1: "The patcher did not run",
  2: "The patcher is out of date",
  3: "An archive was rejected",
  4: "The overlay was disabled",
  5: "Unmodded game",
  6: "Missing data",
  7: "A corrupt archive",
  8: "A texture failed",
  9: "Out of memory",
  10: "A graphics fault",
  11: "Stuck loading",
  12: "An archive was skipped",
  13: "Ended without a reason",
};

const TOKEN_CONFIDENCES: Readonly<Record<number, Confidence>> = {
  1: "lead",
  2: "likely",
  3: "confirmed",
};

/** The confidence word the token's number stands for, or null for none. */
export function tokenConfidence(value: number | null): Confidence | null {
  if (value === null) return null;
  return TOKEN_CONFIDENCES[value] ?? null;
}

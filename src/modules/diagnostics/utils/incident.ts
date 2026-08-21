import type {
  Ending,
  GamePhase,
  Incident,
  LaunchKind,
  OriginKind,
  OverlayOutcome,
  ScanMode,
  ScanStatus,
  SessionOrigin,
  VerdictKind,
} from "@/lib/tauri";

const DAY_MS = 86_400_000;

/**
 * A verdict that reports facts without blaming anything is information, and
 * one that names a failure is a warning. The glyph and the toast follow this.
 */
export function isInformational(kind: VerdictKind): boolean {
  return kind === "unmodded" || kind === "ended-without-reason";
}

/**
 * The scan rejected an archive for carrying a Riot skin ported onto a base
 * champion.
 *
 * Its own verdict kind, so this reads one field. A rejection for any other
 * status stays `archive-rejected` and takes neither the art nor the hue.
 */
export function isSkinhackRejection(incident: Incident): boolean {
  return incident.verdict.kind === "skinhack-detected";
}

/**
 * The line under a row's title: the subject where there is one, else the first
 * suspect.
 *
 * A subject that is a game path is shortened to its file name. The rail is too
 * narrow to read one, and the card shows it whole.
 */
export function subjectLine(incident: Incident): string | null {
  const subject = incident.verdict.subject;
  if (subject) return subject.split(/[\\/]/).at(-1) ?? subject;
  return incident.suspects[0]?.displayName ?? null;
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

/**
 * The `NTSTATUS` names a game crash reaches, mirroring `diagnostics::exit_status`.
 *
 * The backend formats the ending for an incident, and this is here for a token,
 * which carries the bare number and is decoded without asking the backend.
 */
const EXIT_STATUS_NAMES: Readonly<Record<number, string>> = {
  0x40010004: "DBG_TERMINATE_PROCESS",
  0x80000003: "STATUS_BREAKPOINT",
  0xc0000005: "STATUS_ACCESS_VIOLATION",
  0xc0000006: "STATUS_IN_PAGE_ERROR",
  0xc0000017: "STATUS_NO_MEMORY",
  0xc000001d: "STATUS_ILLEGAL_INSTRUCTION",
  0xc0000025: "STATUS_NONCONTINUABLE_EXCEPTION",
  0xc000008c: "STATUS_ARRAY_BOUNDS_EXCEEDED",
  0xc000008e: "STATUS_FLOAT_DIVIDE_BY_ZERO",
  0xc0000090: "STATUS_FLOAT_INVALID_OPERATION",
  0xc0000094: "STATUS_INTEGER_DIVIDE_BY_ZERO",
  0xc0000095: "STATUS_INTEGER_OVERFLOW",
  0xc0000096: "STATUS_PRIVILEGED_INSTRUCTION",
  0xc000009a: "STATUS_INSUFFICIENT_RESOURCES",
  0xc00000fd: "STATUS_STACK_OVERFLOW",
  0xc0000135: "STATUS_DLL_NOT_FOUND",
  0xc000013a: "STATUS_CONTROL_C_EXIT",
  0xc0000142: "STATUS_DLL_INIT_FAILED",
  0xc0000374: "STATUS_HEAP_CORRUPTION",
  0xc0000409: "STATUS_STACK_BUFFER_OVERRUN",
  0xc000041d: "STATUS_FATAL_USER_CALLBACK_EXCEPTION",
  0xc0000602: "STATUS_FAIL_FAST_EXCEPTION",
};

/**
 * `0xC0000005 STATUS_ACCESS_VIOLATION`, or what is left without a name.
 *
 * A code with the high bit set is an `NTSTATUS` named or not, so it reads as
 * hex. Anything else is a plain exit code and reads as a number.
 */
export function describeExitCode(code: number): string {
  const bits = code >>> 0;
  const name = EXIT_STATUS_NAMES[bits];
  const hex = `0x${bits.toString(16).toUpperCase().padStart(8, "0")}`;
  if (name) return `${hex} ${name}`;
  if (code < 0) return hex;
  return String(code);
}

/** The client's reason and code, and whether crashpad ran, in one clause. */
export function describeEnding(ending: Ending): string {
  const parts: string[] = [];
  if (ending.exitReason) parts.push(ending.exitReason);
  if (ending.exitCode !== null) parts.push(`exit code ${describeExitCode(ending.exitCode)}`);
  if (ending.crashed === true) parts.push("crashpad ran");
  if (parts.length === 0) return "No reason recorded";
  return parts.join(", ");
}

/** The route param for a workshop project is its directory name. */
export function projectNameFromPath(path: string): string {
  const segments = path.split(/[\\/]/).filter((segment) => segment.length > 0);
  return segments[segments.length - 1] ?? path;
}

/**
 * The words a decoded token reads under, keyed by the enums the backend
 * resolves it to, so a variant added there is a compile error here and not
 * a number with no name.
 */
export const OVERLAY_LABELS: Readonly<Record<OverlayOutcome, string>> = {
  live: "Overlay live",
  "too-late": "DLL joined too late",
  "end-of-life": "DLL refused the game build",
  disabled: "Overlay turned off by the scan",
  "hook-failed": "A hook did not install",
  none: "DLL said nothing",
};

export const SCAN_LABELS: Readonly<Record<ScanMode, string>> = {
  eager: "eager scan",
  lazy: "lazy scan",
};

export const LAUNCH_LABELS: Readonly<Record<LaunchKind, string>> = {
  match: "match",
  replay: "replay",
  spectator: "spectator",
  pbe: "PBE",
};

export const PHASE_LABELS: Readonly<Record<GamePhase, string>> = {
  unknown: "no log read",
  loading: "stopped on the loading screen",
  "in-game": "reached the game",
  "torn-down": "ended the way it should",
};

export const ORIGIN_KIND_LABELS: Readonly<Record<OriginKind, string>> = {
  library: "Library",
  workshop: "Workshop test",
};

export const SCAN_STATUS_LABELS: Readonly<Record<ScanStatus, string>> = {
  skinhack: "skinhack",
  "missing-bin": "a linked .bin is missing",
  corrupt: "corrupt or unsupported",
  "out-of-memory": "out of memory mid-scan",
  "base-skin": "base skin with a mesh missing",
  unknown: "a status this build does not know",
};

/** What the DLL's detail is about, for the overlay outcomes that carry one. */
export const OVERLAY_DETAIL_LABELS: Readonly<Partial<Record<OverlayOutcome, string>>> = {
  "end-of-life": "DLL build",
  "hook-failed": "Hook",
  disabled: "Did not verify",
};

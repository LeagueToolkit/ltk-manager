import { m } from "@/i18n";
import type {
  Ending,
  GamePhase,
  Incident,
  LaunchKind,
  OriginKind,
  OverlayOutcome,
  ScanMode,
  SessionOrigin,
  ShaderFailure,
  VerdictKind,
} from "@/lib/tauri";
import { scanRejectionCause } from "@/modules/patcher";

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
  if (days === 0) return m.diagnostics_day_today_label();
  if (days === 1) return m.diagnostics_day_yesterday_label();
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

/** `12 s`, `4 min`, `1 h 20 min`. */
export function formatSeconds(secs: number): string {
  if (secs < 60) return m.diagnostics_duration_seconds_label({ secs });
  const mins = Math.round(secs / 60);
  if (mins < 60) return m.diagnostics_duration_minutes_label({ mins });
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (rest === 0) return m.diagnostics_duration_hours_label({ hours });
  return m.diagnostics_duration_hours_minutes_label({ hours, mins: rest });
}

/** How long the game ran, or null when the two stamps do not make a span. */
export function formatDuration(startedAt: string, endedAt: string): string | null {
  const secs = Math.round((Date.parse(endedAt) - Date.parse(startedAt)) / 1000);
  if (!Number.isFinite(secs) || secs < 0) return null;
  return formatSeconds(secs);
}

/** `Library`, or `Testing 2 projects`. */
export function formatOrigin(origin: SessionOrigin): string {
  if (origin.kind === "library") return m.diagnostics_origin_library_label();
  return m.diagnostics_origin_testing_label({ count: origin.projects.length });
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
  if (ending.exitCode !== null)
    parts.push(m.diagnostics_ending_exit_code_label({ code: describeExitCode(ending.exitCode) }));
  if (ending.crashed === true) parts.push(m.diagnostics_ending_crashpad_label());
  if (parts.length === 0) return m.diagnostics_ending_empty();
  return parts.join(", ");
}

/**
 * The words a decoded token reads under, keyed by the enums the backend
 * resolves it to, so a variant added there is a compile error here and not
 * a number with no name.
 */
export const OVERLAY_LABELS: Readonly<Record<OverlayOutcome, string>> = {
  get live() {
    return m.diagnostics_overlay_live_label();
  },
  get "too-late"() {
    return m.diagnostics_overlay_too_late_label();
  },
  get "end-of-life"() {
    return m.diagnostics_overlay_end_of_life_label();
  },
  get disabled() {
    return m.diagnostics_overlay_disabled_label();
  },
  get "hook-failed"() {
    return m.diagnostics_overlay_hook_failed_label();
  },
  get none() {
    return m.diagnostics_overlay_none_label();
  },
};

export const SCAN_LABELS: Readonly<Record<ScanMode, string>> = {
  get eager() {
    return m.diagnostics_scan_eager_label();
  },
  get lazy() {
    return m.diagnostics_scan_lazy_label();
  },
};

export const LAUNCH_LABELS: Readonly<Record<LaunchKind, string>> = {
  get match() {
    return m.diagnostics_launch_match_label();
  },
  get replay() {
    return m.diagnostics_launch_replay_label();
  },
  get spectator() {
    return m.diagnostics_launch_spectator_label();
  },
  get pbe() {
    return m.diagnostics_launch_pbe_label();
  },
};

export const PHASE_LABELS: Readonly<Record<GamePhase, string>> = {
  get unknown() {
    return m.diagnostics_phase_unknown_label();
  },
  get loading() {
    return m.diagnostics_phase_loading_label();
  },
  get "in-game"() {
    return m.diagnostics_phase_in_game_label();
  },
  get "torn-down"() {
    return m.diagnostics_phase_torn_down_label();
  },
};

export const ORIGIN_KIND_LABELS: Readonly<Record<OriginKind, string>> = {
  get library() {
    return m.diagnostics_origin_library_label();
  },
  get workshop() {
    return m.diagnostics_origin_workshop_label();
  },
};

/** What the DLL's detail is about, for the overlay outcomes that carry one. */
export const OVERLAY_DETAIL_LABELS: Readonly<Partial<Record<OverlayOutcome, string>>> = {
  get "end-of-life"() {
    return m.diagnostics_overlay_detail_end_of_life_label();
  },
  get "hook-failed"() {
    return m.diagnostics_overlay_detail_hook_failed_label();
  },
  get disabled() {
    return m.diagnostics_overlay_detail_disabled_label();
  },
};

/**
 * The heading a caught skinhack reads under, in place of the verdict's own.
 *
 * The rail has room for the finding and the card has room for the verb, so the
 * two say the same thing at the length each has.
 */
function skinhackTitle(): string {
  return m.diagnostics_skinhack_title();
}

function shaderFailureLead({ variants: count, missingPipeline }: ShaderFailure): string {
  if (count === 0) return m.diagnostics_shader_pipeline_description();
  if (missingPipeline) return m.diagnostics_shader_compile_pipeline_description({ count });
  return m.diagnostics_shader_compile_description({ count });
}

/** The sentences a shader verdict reads as, from the facts the log gave. */
export function shaderFailureCause(shader: ShaderFailure): string {
  const lead = shaderFailureLead(shader);
  if (!shader.unnamedPrograms) return lead;
  return `${lead} ${m.diagnostics_shader_unnamed_description()}`;
}

/**
 * The verdict's cause as the player reads it.
 *
 * The backend's own sentence where it wrote one, else the catalog's words for
 * the facts it sent instead.
 */
export function verdictCause(incident: Incident): string {
  if (incident.verdict.cause) return incident.verdict.cause;
  if (incident.shader) return shaderFailureCause(incident.shader);
  return scanRejectionCause(incident);
}

/** The verdict's heading as the player reads it, wherever the incident is drawn. */
export function verdictTitle(incident: Incident): string {
  return isSkinhackRejection(incident) ? skinhackTitle() : incident.verdict.title;
}

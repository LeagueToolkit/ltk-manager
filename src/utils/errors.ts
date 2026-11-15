import type { AppErrorResponse as AppError } from "@/lib/bindings";

export type { AppErrorResponse as AppError, OverlayErrorCategory } from "@/lib/bindings";

/** The `code` tag of an `AppError`, the name a caller branches on. */
export type ErrorCode = AppError["code"];

/** Narrows `error` to the variant tagged `code`, so its fields are in reach. */
export function hasErrorCode<T extends ErrorCode>(
  error: AppError,
  code: T,
): error is Extract<AppError, { code: T }> {
  return error.code === code;
}

/** Whether a thrown value is a backend error rather than a JS `Error`. */
export function isAppError(error: unknown): error is AppError {
  return (
    typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
  );
}

/** The facts of a backend error that find the failure in the log. */
export interface ErrorDetails {
  code: ErrorCode;
  /** The variant under a code that has several variants. */
  kind: string | null;
  /** Prose from outside the app, such as the message of an OS error. */
  detail: string | null;
  /** The reference that the log line of the failure holds. Null if no command returned the error. */
  ref: string | null;
}

/**
 * The codes of a failure that the manager does not expect in normal use.
 *
 * A toast for one of them offers `Get help`. Every other code is a routine refusal, such as a
 * League path that is not set.
 */
const UNEXPECTED_CODES: ReadonlySet<ErrorCode> = new Set([
  "UNKNOWN",
  "IO",
  "INTERNAL_STATE",
  "WAD",
  "OVERLAY",
  "PATCHER",
]);

/** Returns whether `code` is a failure that the manager does not expect in normal use. */
export function isUnexpectedCode(code: ErrorCode): boolean {
  return UNEXPECTED_CODES.has(code);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Returns the code, the kind, the detail text and the reference of `error`.
 *
 * Reads the kind and the detail from the error, or from the domain error under `error`.
 */
export function errorDetails(error: AppError): ErrorDetails {
  const fields: Record<string, unknown> = error;
  const nested: Record<string, unknown> =
    typeof fields.error === "object" && fields.error !== null
      ? (fields.error as Record<string, unknown>)
      : {};

  return {
    code: error.code,
    kind: stringOrNull(fields.kind ?? nested.kind),
    detail: stringOrNull(fields.detail ?? nested.detail),
    ref: stringOrNull(fields.ref),
  };
}

/** Returns `title` and `details` as the text that `Copy` puts on the clipboard. */
export function errorDetailsText(title: string, details: ErrorDetails): string {
  const lines = [title, `code: ${details.code}`];
  if (details.kind !== null) lines.push(`kind: ${details.kind}`);
  if (details.ref !== null) lines.push(`ref: ${details.ref}`);
  if (details.detail !== null) lines.push(details.detail);

  return lines.join("\n");
}

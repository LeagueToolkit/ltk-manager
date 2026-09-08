import { api, type UiError } from "@/lib/tauri";

/**
 * What an unknown thrown value says about itself.
 *
 * Anything can be thrown, and a rejection carries whatever it was rejected
 * with, so a value that is not an `Error` still has to arrive as one.
 */
export function describeThrown(thrown: unknown): Pick<UiError, "name" | "message" | "stack"> {
  if (thrown instanceof Error) {
    return {
      name: thrown.name,
      message: thrown.message,
      stack: thrown.stack ?? null,
    };
  }

  return { name: "UnknownError", message: String(thrown), stack: null };
}

/** Which screen the reader was on, as the location a crash carries. */
export function currentRoute(): string {
  return window.location.hash.replace(/^#/, "") || window.location.pathname;
}

/**
 * Hand a crash to the backend, which is the only thing here that reaches the
 * network.
 *
 * Never throws and never waits. A failure to report a crash is not worth a
 * second crash, and a fallback that awaits this would not draw until the queue
 * had answered.
 */
export function reportUiError(error: UiError): void {
  void api.diagnostics.trackUiError(error).catch(() => undefined);
}

/**
 * Report what no boundary sees, which is everything outside React's render.
 *
 * An event handler, a timer and a rejected promise all miss the boundary, and
 * before this they reached the console and stopped there.
 */
export function installGlobalErrorHandlers(): void {
  window.addEventListener("error", (event) => {
    reportUiError({
      ...describeThrown(event.error ?? event.message),
      componentStack: null,
      route: currentRoute(),
      handled: false,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    reportUiError({
      ...describeThrown(event.reason),
      componentStack: null,
      route: currentRoute(),
      handled: false,
    });
  });
}

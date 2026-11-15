import { WarningOctagonIcon } from "@phosphor-icons/react";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { m } from "@/i18n";
import { currentRoute, describeThrown, reportUiError } from "@/lib/crashReporting";

import { Button } from "./Button";

interface CrashScreenProps {
  /** Opens the `Get help` dialog. The screen offers a reload only without it. */
  onGetHelp?: () => void;
}

/** The whole-window screen for a render that threw, with a reload and `Get help`. */
export function CrashScreen({ onGetHelp }: CrashScreenProps) {
  return (
    <div
      className="flex h-screen w-screen items-center justify-center bg-surface-950 p-8"
      data-ui="ErrorBoundary"
    >
      <div className="flex max-w-md flex-col items-center gap-4 rounded-lg bg-surface-900 p-8 text-center">
        <WarningOctagonIcon className="size-10 text-danger-text" weight="duotone" />
        <div className="flex flex-col gap-2">
          <h1 className="text-base font-medium text-surface-100">{m.common_crash_title()}</h1>
          <p className="text-sm text-surface-400">{m.common_crash_description()}</p>
        </div>
        <div className="flex gap-2">
          {onGetHelp && (
            <Button variant="ghost" onClick={onGetHelp}>
              {m.common_get_help_action()}
            </Button>
          )}
          <Button onClick={() => window.location.reload()}>{m.common_crash_reload_action()}</Button>
        </div>
      </div>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: ReactNode;
  /**
   * What to draw in place of the children once one threw, given the way to draw them again
   * and the value that was thrown.
   *
   * A boundary around one pane draws a notice in that pane. The one above the router draws
   * the whole-window fallback and offers a reload instead.
   */
  fallback?: (retry: () => void, error: unknown) => ReactNode;
}

interface ErrorBoundaryState {
  crashed: boolean;
  /** The value that the children threw. */
  error: unknown;
}

/**
 * The last thing between a render that threw and a window with nothing in it.
 *
 * A class because React offers no hook that catches a render, and it sits above
 * the router so a crash on any screen still draws something a reader can act on.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { crashed: false, error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { crashed: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportUiError({
      ...describeThrown(error),
      componentStack: info.componentStack ?? null,
      route: currentRoute(),
      handled: true,
    });
  }

  retry = () => {
    this.setState({ crashed: false, error: null });
  };

  render() {
    if (!this.state.crashed) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.retry, this.state.error);

    return <CrashScreen />;
  }
}

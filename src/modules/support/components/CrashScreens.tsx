import { useEffect, useState } from "react";

import { CrashScreen } from "@/components";
import { currentRoute, describeThrown, reportUiError } from "@/lib/crashReporting";
import type { ReportOrigin } from "@/lib/tauri";

import { GetHelpForm } from "./GetHelpDialog";

/**
 * The whole-window crash screen with `Get help`, for the render error `error`.
 *
 * The screen mounts the dialog itself. The root layout mounts the dialog of the app, and the
 * root layout is part of the tree that crashed.
 */
export function GetHelpCrashScreen({ error }: { error: unknown }) {
  const [helping, setHelping] = useState(false);
  // Read once, because the route can change while the screen is up.
  const [origin] = useState<ReportOrigin>(() => ({
    kind: "crash",
    route: currentRoute(),
    message: describeThrown(error).message,
  }));

  return (
    <>
      <CrashScreen onGetHelp={() => setHelping(true)} />
      {helping && <GetHelpForm context={{ origin }} onClose={() => setHelping(false)} />}
    </>
  );
}

/**
 * The router's error component. Reports `error` once and renders the crash screen.
 *
 * The router catches a route's render error before `ErrorBoundary` sees it, so the report
 * has to be sent here.
 */
export function RouteCrashScreen({ error }: { error: unknown }) {
  useEffect(() => {
    reportUiError({
      ...describeThrown(error),
      componentStack: null,
      route: currentRoute(),
      handled: true,
    });
  }, [error]);

  return <GetHelpCrashScreen error={error} />;
}

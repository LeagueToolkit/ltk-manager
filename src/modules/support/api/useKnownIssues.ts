import { useQuery } from "@tanstack/react-query";

import type { Incident, KnownIssue } from "@/lib/tauri";

import { knownIssueFor } from "../utils/findings";
import { supportQueries } from "./queries";

/**
 * Returns the known issues that the maintainers publish for this build.
 *
 * The data is undefined while the feed loads and if the feed cannot be read, so a caller that
 * defaults to an empty list shows no issue.
 */
export function useKnownIssues() {
  return useQuery(supportQueries.knownIssues());
}

/** Returns the known issue that explains the verdict of `incident`, or `null`. */
export function useKnownIssue(incident: Incident | null): KnownIssue | null {
  const { data: issues = [] } = useKnownIssues();

  return knownIssueFor(issues, incident, []);
}

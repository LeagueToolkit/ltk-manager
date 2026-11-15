import type { AppInfo } from "@/lib/tauri";

const NEW_ISSUE_URL = "https://github.com/LeagueToolkit/ltk-manager/issues/new";

/**
 * Returns the URL of the bug report form, with the version, the OS and the incident token
 * filled in.
 *
 * Leaves out a field whose value is not known.
 */
export function bugReportUrl(appInfo: AppInfo | undefined, diagnosticToken: string | null): string {
  const params = new URLSearchParams({ template: "bug_report.yml" });

  if (appInfo) {
    params.set("version", appInfo.version);
    params.set("os", `${appInfo.os} ${appInfo.arch}`);
  }
  if (diagnosticToken) params.set("diagnostic", diagnosticToken);

  return `${NEW_ISSUE_URL}?${params.toString()}`;
}

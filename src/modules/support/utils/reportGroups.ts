import type { ReportPreviewFile } from "@/lib/tauri";

/** A group of report files that the dialog shows as one row. */
export type ReportGroupId = "summary" | "log" | "incidents" | "games" | "system" | "gameLog";

export interface ReportGroup {
  id: ReportGroupId;
  /** The size of the files of the group together. */
  bytes: number;
  /** The number of records, for the `incidents` and the `games` group. Zero for every other group. */
  count: number;
}

const ORDER: readonly ReportGroupId[] = [
  "summary",
  "log",
  "incidents",
  "games",
  "system",
  "gameLog",
];

function groupOf(path: string): ReportGroupId {
  if (path === "report.md" || path === "manifest.json") return "summary";
  if (path.startsWith("log/")) return "log";
  if (path.startsWith("incidents/")) return "incidents";
  if (path.startsWith("games/")) return "games";
  if (path.startsWith("game-log/")) return "gameLog";

  return "system";
}

/**
 * Groups the files of a report into the rows that the dialog shows, in a fixed order.
 *
 * Leaves out a group that holds no file.
 */
export function groupReportFiles(files: readonly ReportPreviewFile[]): ReportGroup[] {
  const groups = new Map<ReportGroupId, ReportGroup>();

  for (const file of files) {
    const id = groupOf(file.path);
    const group = groups.get(id) ?? { id, bytes: 0, count: 0 };

    group.bytes += file.bytes;
    // The incidents and the games hold one JSON file for each record.
    const counted = id === "incidents" || id === "games";
    if (counted && file.path.endsWith(".json")) group.count += 1;

    groups.set(id, group);
  }

  return ORDER.flatMap((id) => groups.get(id) ?? []);
}

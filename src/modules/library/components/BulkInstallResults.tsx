import { CircleCheck, CircleX } from "lucide-react";

import type { BulkInstallResult } from "@/lib/tauri";

interface BulkInstallResultsProps {
  result: BulkInstallResult;
  /** Verb used in the success message (e.g. "imported", "installed"). */
  verb?: string;
}

export function BulkInstallResults({ result, verb = "installed" }: BulkInstallResultsProps) {
  return (
    <div className="space-y-3">
      {result.installed.length > 0 && (
        <div className="flex items-center gap-2 text-sm text-green-400">
          <CircleCheck className="h-4 w-4 shrink-0" />
          <span>
            {result.installed.length} mod{result.installed.length !== 1 ? "s" : ""} {verb}
          </span>
        </div>
      )}

      {result.failed.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-red-400">
            <CircleX className="h-4 w-4 shrink-0" />
            <span>{result.failed.length} failed</span>
          </div>
          <ul className="space-y-1 pl-6">
            {result.failed.map((err) => (
              <li key={err.filePath} className="text-sm text-surface-400">
                <span className="font-medium text-surface-300">{err.fileName}</span>
                {" — "}
                {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

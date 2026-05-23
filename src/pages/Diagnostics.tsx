import { ClipboardCopy, RotateCw, Stethoscope } from "lucide-react";

import { AlertBox, Button, Spinner, useToast } from "@/components";
import type { DiagnosticReport } from "@/lib/tauri";
import { DiagnosticsReportView, useDiagnostics } from "@/modules/diagnostics";

function formatGeneratedAt(iso: string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function reportToText(report: DiagnosticReport): string {
  const lines: string[] = [];
  lines.push(`# LTK Manager diagnostics`);
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`App version: ${report.appVersion}`);
  lines.push("");
  for (const c of report.checks) {
    lines.push(`[${c.severity.toUpperCase()}] ${c.label} — ${c.summary}`);
    for (const d of c.details) {
      lines.push(`    ${d.key}: ${d.value}`);
    }
    if (c.suggestion) {
      lines.push(`    note: ${c.suggestion}`);
    }
    if (c.fixCommand) {
      for (const cmdLine of c.fixCommand.split("\n")) {
        lines.push(`    > ${cmdLine}`);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function Diagnostics() {
  const diagnostics = useDiagnostics();
  const toast = useToast();
  const report = diagnostics.data;

  function copyReport() {
    if (!report) return;
    navigator.clipboard
      .writeText(reportToText(report))
      .then(() => toast.success("Copied", "Diagnostic report copied to clipboard"))
      .catch(() => toast.error("Copy failed", "Could not access the clipboard"));
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-surface-100">
              <Stethoscope className="h-5 w-5 text-accent-400" />
              Diagnostics
            </h1>
            <p className="mt-1 text-sm text-surface-400">
              Checks the most common reasons the patcher fails to load mods. Re-run after changing
              settings or a Windows update. All checks are read-only — fixes are shown as commands
              you can copy and run in an elevated terminal.
            </p>
            {report && (
              <p className="mt-1 text-xs text-surface-500">
                Last run: {formatGeneratedAt(report.generatedAt)} · LTK Manager v{report.appVersion}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={copyReport}
              disabled={!report}
              left={<ClipboardCopy className="h-4 w-4" />}
            >
              Copy report
            </Button>
            <Button
              variant="filled"
              size="sm"
              onClick={() => diagnostics.refetch()}
              loading={diagnostics.isFetching}
              left={<RotateCw className="h-4 w-4" />}
            >
              {diagnostics.isFetching ? "Running…" : "Re-run"}
            </Button>
          </div>
        </header>

        {diagnostics.isError && (
          <AlertBox variant="error" title="Diagnostics failed to run">
            {diagnostics.error?.message ?? "Unknown error"}
          </AlertBox>
        )}

        {!report && diagnostics.isFetching && (
          <div className="flex items-center justify-center rounded-xl border border-surface-700/50 bg-surface-900/50 py-16">
            <Spinner size="lg" />
          </div>
        )}

        {report && <DiagnosticsReportView report={report} />}
      </div>
    </div>
  );
}

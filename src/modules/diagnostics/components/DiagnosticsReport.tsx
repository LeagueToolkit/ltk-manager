import { useMemo } from "react";

import type { Category, Check, DiagnosticReport, Severity } from "@/lib/tauri";

import { CheckRow } from "./CheckRow";

const CATEGORY_ORDER: Category[] = ["system", "manager", "league", "patcher", "storage", "library"];

const CATEGORY_LABELS: Record<Category, { title: string; description: string }> = {
  system: {
    title: "System",
    description: "Windows version, UAC, long-paths support",
  },
  manager: {
    title: "LTK Manager",
    description: "Manager elevation, conflicting processes",
  },
  league: {
    title: "League installation",
    description: "Install path, writability, compatibility flags",
  },
  patcher: {
    title: "Patcher",
    description: "DLL presence, signature, file lock state",
  },
  storage: {
    title: "Mod storage",
    description: "Storage path, free space, drive type",
  },
  library: {
    title: "Library",
    description: "Mod library index integrity",
  },
};

const SEVERITY_ORDER: Severity[] = ["bad", "warn", "info", "ok"];

interface DiagnosticsReportProps {
  report: DiagnosticReport;
}

export function DiagnosticsReportView({ report }: DiagnosticsReportProps) {
  const grouped = useMemo(() => groupChecks(report.checks), [report.checks]);
  return (
    <div className="space-y-6">
      <CountsHeader checks={report.checks} />
      {CATEGORY_ORDER.map((cat) => {
        const checks = grouped.get(cat);
        if (!checks || checks.length === 0) return null;
        const labels = CATEGORY_LABELS[cat];
        return (
          <section key={cat} className="space-y-2">
            <header className="px-1">
              <h3 className="text-sm font-semibold text-surface-100">{labels.title}</h3>
              <p className="text-xs text-surface-500">{labels.description}</p>
            </header>
            <div className="overflow-hidden rounded-xl border border-surface-700/50 bg-surface-900/95">
              {checks.map((c) => (
                <CheckRow key={c.id} check={c} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function groupChecks(checks: Check[]): Map<Category, Check[]> {
  const map = new Map<Category, Check[]>();
  for (const c of checks) {
    if (!map.has(c.category)) map.set(c.category, []);
    map.get(c.category)!.push(c);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  }
  return map;
}

function CountsHeader({ checks }: { checks: Check[] }) {
  const counts: Record<Severity, number> = { ok: 0, info: 0, warn: 0, bad: 0 };
  for (const c of checks) counts[c.severity]++;

  const items: { sev: Severity; label: string; cls: string }[] = [
    { sev: "bad", label: "Issues", cls: "text-red-300" },
    { sev: "warn", label: "Warnings", cls: "text-amber-300" },
    { sev: "ok", label: "Passing", cls: "text-green-300" },
    { sev: "info", label: "Info", cls: "text-blue-300" },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 rounded-xl border border-surface-700/50 bg-surface-900/95 p-3 sm:grid-cols-4">
      {items.map((it) => (
        <div
          key={it.sev}
          className="flex flex-col items-baseline gap-1 rounded-md border border-surface-700/40 bg-surface-950/40 px-3 py-2"
        >
          <span className="text-[10px] font-medium tracking-wider text-surface-500 uppercase">
            {it.label}
          </span>
          <span className={`text-xl font-semibold tabular-nums ${it.cls}`}>{counts[it.sev]}</span>
        </div>
      ))}
    </div>
  );
}

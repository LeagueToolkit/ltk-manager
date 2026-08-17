import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { match } from "ts-pattern";

import type { Severity } from "@/lib/tauri";

const styles: Record<Severity, { bg: string; text: string; label: string }> = {
  ok: { bg: "border-success/40 bg-success/10", text: "text-success-text", label: "OK" },
  info: { bg: "border-info/40 bg-info/10", text: "text-info-text", label: "INFO" },
  warn: { bg: "border-warning/40 bg-warning/10", text: "text-warning-text", label: "WARN" },
  bad: { bg: "border-danger/40 bg-danger/10", text: "text-danger-text", label: "BAD" },
};

export function SeverityBadge({ severity }: { severity: Severity }) {
  const s = styles[severity];
  return (
    <span
      className={twMerge(
        "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold tracking-wider",
        s.bg,
        s.text,
      )}
    >
      <SeverityIcon severity={severity} className="h-3 w-3" />
      {s.label}
    </span>
  );
}

export function SeverityIcon({ severity, className }: { severity: Severity; className?: string }) {
  return match(severity)
    .with("ok", () => <CircleCheck className={className} />)
    .with("info", () => <Info className={className} />)
    .with("warn", () => <CircleAlert className={className} />)
    .with("bad", () => <CircleX className={className} />)
    .exhaustive();
}

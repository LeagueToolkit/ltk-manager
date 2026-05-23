import { CircleAlert, CircleCheck, CircleX, Info } from "lucide-react";
import { twMerge } from "tailwind-merge";
import { match } from "ts-pattern";

import type { Severity } from "@/lib/tauri";

const styles: Record<Severity, { bg: string; text: string; label: string }> = {
  ok: { bg: "bg-green-950/40 border-green-800/60", text: "text-green-300", label: "OK" },
  info: { bg: "bg-blue-950/40 border-blue-800/60", text: "text-blue-300", label: "INFO" },
  warn: { bg: "bg-amber-950/40 border-amber-800/60", text: "text-amber-300", label: "WARN" },
  bad: { bg: "bg-red-950/40 border-red-800/60", text: "text-red-300", label: "BAD" },
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

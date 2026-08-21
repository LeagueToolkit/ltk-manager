import { twMerge } from "tailwind-merge";

import type { Confidence } from "@/lib/tauri";

/* A confirmed verdict states a fact, a likely one asks for caution, and a lead
   is a heuristic that has earned no status hue at all: DS-KIND-HUE. */
const BANDS: Record<Confidence, { label: string; className: string }> = {
  confirmed: { label: "Confirmed", className: "border-info/40 bg-info/10 text-info-text" },
  likely: { label: "Likely", className: "border-warning/40 bg-warning/10 text-warning-text" },
  lead: { label: "Lead", className: "border-surface-600 bg-surface-800 text-surface-300" },
};

interface ConfidenceChipProps {
  confidence: Confidence;
  className?: string;
}

/** One word for how sure the manager is, in the verdict's band. */
export function ConfidenceChip({ confidence, className }: ConfidenceChipProps) {
  const band = BANDS[confidence];
  return (
    <span
      data-ui="ConfidenceChip"
      className={twMerge(
        "inline-flex h-5 shrink-0 items-center rounded-sm border px-1.5 font-mono text-[10px] font-semibold tracking-wider uppercase select-none",
        band.className,
        className,
      )}
    >
      {band.label}
    </span>
  );
}

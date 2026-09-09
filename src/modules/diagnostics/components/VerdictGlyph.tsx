import { InfoIcon, WarningIcon } from "@phosphor-icons/react";

import type { VerdictKind } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { isInformational } from "../utils/incident";

interface VerdictGlyphProps {
  kind: VerdictKind;
  className?: string;
}

/** The warning triangle for a verdict that names a failure, and an info mark for one that states facts. */
export function VerdictGlyph({ kind, className }: VerdictGlyphProps) {
  /* Glyphs take the -text variant: DS-TEXT. */
  if (isInformational(kind)) {
    return (
      <InfoIcon
        weight="bold"
        aria-label="Information"
        className={twMerge("text-info-text", className)}
      />
    );
  }
  return (
    <WarningIcon
      weight="bold"
      aria-label="Warning"
      className={twMerge("text-danger-text", className)}
    />
  );
}

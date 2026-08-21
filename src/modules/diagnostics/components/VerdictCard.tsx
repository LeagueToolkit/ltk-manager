import type { Incident } from "@/lib/tauri";

import { ConfidenceChip } from "./ConfidenceChip";
import { VerdictGlyph } from "./VerdictGlyph";

interface VerdictCardProps {
  incident: Incident;
}

/** The verdict as the player reads it first: the title, how sure the manager is, and the cause. */
export function VerdictCard({ incident }: VerdictCardProps) {
  const { verdict } = incident;

  return (
    <section
      data-ui="VerdictCard"
      className="flex items-start gap-3 rounded-lg border border-surface-700/50 bg-surface-900/95 p-4"
    >
      <VerdictGlyph kind={verdict.kind} className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-surface-100">{verdict.title}</h2>
          {verdict.confidence && <ConfidenceChip confidence={verdict.confidence} />}
          {incident.dismissed && (
            <span className="inline-flex h-5 items-center rounded-sm border border-surface-600 px-1.5 text-[10px] font-medium tracking-wider text-surface-400 uppercase">
              Dismissed
            </span>
          )}
        </div>
        <p className="mt-1 text-sm leading-relaxed text-surface-300">{verdict.cause}</p>
        {verdict.subject && (
          <p className="mt-2 font-mono text-xs break-all text-surface-200 select-text">
            {verdict.subject}
          </p>
        )}
      </div>
    </section>
  );
}

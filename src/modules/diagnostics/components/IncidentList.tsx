import { type KeyboardEvent, useEffect, useMemo, useRef } from "react";
import { twMerge } from "tailwind-merge";
import { match } from "ts-pattern";

import type { Incident } from "@/lib/tauri";

import {
  dayKey,
  dayLabel,
  formatClock,
  formatDuration,
  formatOrigin,
  isSkinhackRejection,
  subjectLine,
} from "../utils/incident";
import { VerdictGlyph } from "./VerdictGlyph";

interface IncidentListProps {
  /** Newest first, as the store hands them over. */
  incidents: Incident[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

interface DayGroup {
  key: number;
  label: string;
  incidents: Incident[];
}

function groupByDay(incidents: Incident[], now: Date): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const incident of incidents) {
    const key = dayKey(incident.endedAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.incidents.push(incident);
    } else {
      groups.push({ key, label: dayLabel(incident.endedAt, now), incidents: [incident] });
    }
  }
  return groups;
}

function rowId(id: string): string {
  return `incident-${id}`;
}

/**
 * Every incident, newest first and grouped by day. The selection is the
 * caller's, because it is the page's `incident` search param, so the arrows
 * move it through `onSelect` rather than through a highlight of their own.
 */
export function IncidentList({ incidents, selectedId, onSelect }: IncidentListProps) {
  const groups = useMemo(() => groupByDay(incidents, new Date()), [incidents]);
  const rows = useRef(new Map<string, HTMLElement>());

  useEffect(() => {
    if (!selectedId) return;
    rows.current.get(selectedId)?.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (incidents.length === 0) return;
    const at = incidents.findIndex((incident) => incident.id === selectedId);
    const last = incidents.length - 1;
    const target = match(event.key)
      .with("ArrowDown", () => Math.min(at + 1, last))
      .with("ArrowUp", () => Math.max(at - 1, 0))
      .with("Home", () => 0)
      .with("End", () => last)
      .otherwise(() => null);
    if (target === null) return;
    event.preventDefault();
    const next = incidents[target];
    if (next && target !== at) onSelect(next.id);
  }

  return (
    <div
      data-ui="IncidentList"
      role="listbox"
      aria-label="Incidents"
      aria-activedescendant={selectedId ? rowId(selectedId) : undefined}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex flex-col outline-none select-none focus-visible:ring-1 focus-visible:ring-accent-500/60 focus-visible:ring-inset"
    >
      {groups.map((group) => (
        <div key={group.key} role="group" aria-label={group.label} className="flex flex-col">
          {/* A band of its own, so a long day still says which day while it scrolls. */}
          <div className="sticky top-0 z-10 flex h-6 items-center gap-2 border-y border-surface-800 bg-surface-900 px-3 text-[10px] font-medium tracking-wider text-surface-400 uppercase">
            <span className="min-w-0 flex-1 truncate">{group.label}</span>
            <span className="shrink-0 font-mono tabular-nums">{group.incidents.length}</span>
          </div>
          {/* Hairlines, not gaps, so the rows read as one table. */}
          <div className="flex flex-col divide-y divide-surface-800/60">
            {group.incidents.map((incident) => (
              <IncidentRow
                key={incident.id}
                incident={incident}
                selected={incident.id === selectedId}
                onSelect={onSelect}
                ref={(element) => {
                  if (element) rows.current.set(incident.id, element);
                  else rows.current.delete(incident.id);
                }}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

interface IncidentRowProps {
  incident: Incident;
  selected: boolean;
  onSelect: (id: string) => void;
  ref: (element: HTMLButtonElement | null) => void;
}

/** `Library · 4 min`, and `dismissed` where the player has closed the incident. */
function metaLine(incident: Incident): string {
  const parts = [
    formatOrigin(incident.origin),
    formatDuration(incident.startedAt, incident.endedAt),
  ];
  if (incident.dismissed) parts.push("dismissed");
  return parts.filter((part): part is string => !!part).join(" · ");
}

/**
 * Two lines: the title with the clock beside it, and the facts under it.
 *
 * The rail is a record of what happened rather than a set of cards, so the row
 * is a table row - full bleed, hairline separated, and everything the machine
 * produced set in mono. The consequence has no chip here. It reads on the
 * detail page, and thirteen coloured pills down a rail only made the rail loud.
 */
function IncidentRow({ incident, selected, onSelect, ref }: IncidentRowProps) {
  const subtitle = subjectLine(incident);
  const skinhack = isSkinhackRejection(incident);

  return (
    <button
      ref={ref}
      type="button"
      role="option"
      id={rowId(incident.id)}
      aria-selected={selected}
      data-ui="IncidentList:row"
      tabIndex={-1}
      onClick={() => onSelect(incident.id)}
      className={twMerge(
        /* A row owns no surface, so it hovers with the veil: DS-VEIL. */
        "flex w-full cursor-pointer items-start gap-2 border-l-2 border-l-transparent px-3 py-1.5 text-left transition-colors outline-none",
        !selected && "hover:bg-surface-veil",
        /* Selection holds the accent, and the bar keeps the row a row: DS-HOVER. */
        selected && "border-l-accent-500 bg-accent-500/12",
        incident.dismissed && "opacity-55",
      )}
    >
      {/* Glyphs take the -text variant: DS-TEXT. */}
      <VerdictGlyph
        kind={incident.verdict.kind}
        className={twMerge("mt-0.5 h-3.5 w-3.5 shrink-0", skinhack && "text-void-text")}
      />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-2">
          <span
            className={twMerge(
              "min-w-0 flex-1 truncate text-[13px] font-medium text-surface-100",
              skinhack && "text-void-text",
            )}
          >
            {incident.verdict.title}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-surface-500 tabular-nums">
            {formatClock(incident.endedAt)}
          </span>
        </span>
        <span className="flex items-baseline gap-2 font-mono text-[11px] text-surface-500">
          {subtitle && <span className="min-w-0 flex-1 truncate">{subtitle}</span>}
          <span className={twMerge("shrink-0 truncate", !subtitle && "min-w-0 flex-1")}>
            {metaLine(incident)}
          </span>
        </span>
      </span>
    </button>
  );
}

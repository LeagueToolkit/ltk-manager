import { type KeyboardEvent, useEffect, useMemo, useRef } from "react";
import { twMerge } from "tailwind-merge";
import { match } from "ts-pattern";

import type { Incident } from "@/lib/tauri";

import { dayKey, dayLabel, formatClock, subjectLine } from "../utils/incident";
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
      className="flex flex-col rounded-lg outline-none select-none focus-visible:ring-2 focus-visible:ring-accent-500"
    >
      {groups.map((group) => (
        <div key={group.key} role="group" aria-label={group.label} className="flex flex-col">
          <div className="px-2 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-surface-500 uppercase">
            {group.label}
          </div>
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

function IncidentRow({ incident, selected, onSelect, ref }: IncidentRowProps) {
  const subtitle = subjectLine(incident);

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
        "flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors",
        !selected && "hover:bg-surface-veil",
        selected && "bg-accent-500/15",
        incident.dismissed && "opacity-60",
      )}
    >
      <VerdictGlyph kind={incident.verdict.kind} className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="mt-px w-10 shrink-0 font-mono text-xs text-surface-400 tabular-nums">
        {formatClock(incident.endedAt)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-surface-100">
          {incident.verdict.title}
        </span>
        {subtitle && <span className="block truncate text-xs text-surface-400">{subtitle}</span>}
      </span>
    </button>
  );
}

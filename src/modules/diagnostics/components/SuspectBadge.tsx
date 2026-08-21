import { WarningIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";

import { Tooltip } from "@/components";
import { useIncidentLineStore } from "@/stores";

import { useLatestIncident } from "../api";

interface SuspectBadgeProps {
  /** A library mod's id, for a mod card. */
  modId?: string;
  /** A workshop project's absolute path, for a project card. */
  projectPath?: string;
  /** A disabled mod answers the question itself, so it carries no badge. */
  enabled?: boolean;
}

/**
 * `Suspected`, on the card of a mod or a project the newest undismissed
 * incident names. A click opens the Games tab on that incident.
 *
 * The badge is a question about the last game, and it goes when the user
 * dismisses the incident, disables the mod, or a newer game runs clean.
 */
export function SuspectBadge({ modId, projectPath, enabled = true }: SuspectBadgeProps) {
  const { latest } = useLatestIncident();
  const answeredId = useIncidentLineStore((s) => s.answeredIncidentId);
  const navigate = useNavigate();

  if (!enabled || !latest || latest.id === answeredId) return null;

  const named = latest.suspects.some(
    (suspect) =>
      (modId !== undefined && suspect.modId === modId) ||
      (projectPath !== undefined && suspect.projectPath === projectPath),
  );
  if (!named) return null;

  const tooltipContent = (
    <div className="max-w-[240px] space-y-1">
      <p className="font-semibold text-surface-100">{latest.verdict.title}</p>
      <p className="text-xs text-surface-200">
        Named in the last game that went wrong. Click to review.
      </p>
    </div>
  );

  return (
    <Tooltip content={tooltipContent}>
      <button
        type="button"
        data-ui="SuspectBadge"
        onClick={(event) => {
          event.stopPropagation();
          navigate({ to: "/diagnostics", search: { tab: "games", incident: latest.id } });
        }}
        aria-label={`Suspected in "${latest.verdict.title}", click to review`}
        className="inline-flex h-6 cursor-pointer items-center gap-1 rounded bg-warning/15 px-2 py-0.5 text-xs leading-tight font-medium text-warning-text ring-1 ring-warning/30 transition-colors ring-inset hover:bg-warning/25"
      >
        <WarningIcon className="h-3 w-3" weight="bold" />
        Suspected
      </button>
    </Tooltip>
  );
}

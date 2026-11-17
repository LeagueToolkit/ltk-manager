import { WarningCircleIcon } from "@phosphor-icons/react";

import { Badge, Tooltip } from "@/components";
import { m } from "@/i18n";

import { useShownAdvisories } from "../api";
import { advisoriesAbout, advisoryText } from "../utils/advisories";

interface AdvisoryBadgeProps {
  /** The id of a library mod, for a mod card. */
  modId?: string;
  /** The absolute path of a workshop project, for a project card. */
  projectPath?: string;
  /** A disabled mod is not in the overlay, so its card shows no badge. */
  enabled?: boolean;
}

/**
 * The advisory badge on the card of a mod or a project that an advisory of the last build or
 * of the newest game is about. The tooltip holds the sentence of each advisory.
 *
 * Per "Advisories" in docs/ux/SUPPORT_REPORTS.md. The badge has the shape of the suspect
 * badge. A muted advisory shows no badge.
 */
export function AdvisoryBadge({ modId, projectPath, enabled = true }: AdvisoryBadgeProps) {
  const about = advisoriesAbout(useShownAdvisories(), { modId, projectPath });

  if (!enabled || about.length === 0) return null;

  const sentences = [...new Set(about.map((advisory) => advisoryText(advisory.code)))];
  const tooltipContent = (
    <div className="max-w-[240px] space-y-1">
      {sentences.map((sentence) => (
        <p key={sentence} className="text-xs text-surface-200">
          {sentence}
        </p>
      ))}
    </div>
  );

  return (
    <Tooltip content={tooltipContent}>
      <Badge
        size="lg"
        tone="warning"
        data-ui="AdvisoryBadge"
        icon={<WarningCircleIcon weight="bold" className="size-4" />}
        aria-label={m.diagnostics_advisories_count_label({ count: about.length })}
      />
    </Tooltip>
  );
}

import { BellSlashIcon, WarningCircleIcon } from "@phosphor-icons/react";

import { Button, IconButton, Popover, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { InstalledMod, ShownAdvisory } from "@/lib/tauri";
import {
  advisoriesLabel,
  advisoryOffersRebuild,
  advisoryText,
  subjectName,
  useMuteAdvisory,
  useShownAdvisories,
} from "@/modules/diagnostics";
import { useInstalledMods } from "@/modules/library";
import { useRebuildOverlayAction } from "@/modules/patcher";

/**
 * The advisories of the last build and of the newest game, as a cell in the status bar.
 *
 * Per "Advisories" in docs/ux/SUPPORT_REPORTS.md. The cell states how many mods the build
 * left out, and its popover lists each advisory. The cell stays until the next build or game
 * replaces the advisories, whichever line the session draws beside it. A muted advisory is
 * not counted and not listed.
 */
export function AdvisoryStatusItem() {
  const advisories = useShownAdvisories();
  const { data: mods = [] } = useInstalledMods();
  const rebuild = useRebuildOverlayAction();

  if (advisories.length === 0) return null;

  const offersRebuild = advisories.some((advisory) => advisoryOffersRebuild(advisory.code));

  return (
    <Popover.Root>
      <Popover.Trigger
        render={
          <Button
            variant="tonal"
            data-ui="AdvisoryStatusItem"
            className="mr-1.5 h-6 shrink-0 gap-1 self-center rounded-sm border border-warning/35 bg-warning/15 px-2 text-row text-warning-text tabular-nums hover:bg-warning/25 active:bg-warning/35"
          >
            <WarningCircleIcon className="size-4 shrink-0" weight="bold" />
            {advisoriesLabel(advisories)}
          </Button>
        }
      />
      <Popover.Content side="top" align="end" className="w-96 p-0">
        <Popover.Title className="px-3 pt-3 pb-1">{m.diagnostics_advisories_title()}</Popover.Title>
        <ul className="max-h-80 divide-y divide-surface-700/50 overflow-y-auto">
          {advisories.map((advisory) => (
            <AdvisoryRow key={rowKey(advisory)} advisory={advisory} mods={mods} />
          ))}
        </ul>
        {offersRebuild && (
          <div className="flex justify-end border-t border-surface-700/50 px-3 py-2">
            <Button size="sm" onClick={rebuild.run} loading={rebuild.pending}>
              {rebuild.label}
            </Button>
          </div>
        )}
      </Popover.Content>
    </Popover.Root>
  );
}

interface AdvisoryRowProps {
  advisory: ShownAdvisory;
  mods: readonly InstalledMod[];
}

/**
 * One advisory: what it is about, the sentence of its code and the code of the patcher.
 *
 * An advisory of the integrity tier shows the code of the patcher and no reason. An advisory
 * about a mod offers the mute.
 */
function AdvisoryRow({ advisory, mods }: AdvisoryRowProps) {
  const mute = useMuteAdvisory();
  const { code, subject, patcherCode } = advisory;

  return (
    <li data-ui="AdvisoryStatusItem:row" data-code={code} className="flex items-start gap-2 p-3">
      <div className="min-w-0 flex-1">
        {subject && (
          <p className="truncate text-sm font-medium text-surface-100 select-text">
            {subjectName(subject, mods)}
          </p>
        )}
        <p className="text-sm text-surface-300 select-text">{advisoryText(code)}</p>
        {patcherCode && (
          <p className="font-mono text-xs text-surface-400 select-text">{patcherCode}</p>
        )}
      </div>
      {subject?.kind === "mod" && (
        <Tooltip content={m.diagnostics_advisory_mute_action()}>
          <IconButton
            icon={<BellSlashIcon />}
            size="row"
            aria-label={m.diagnostics_advisory_mute_action()}
            onClick={() => mute.mutate({ code, modId: subject.id })}
          />
        </Tooltip>
      )}
    </li>
  );
}

/** Returns a key that is unique in the list. The backend keeps one advisory for each code and subject of a source. */
function rowKey({ code, subject, source }: ShownAdvisory): string {
  return JSON.stringify([source, code, subject]);
}

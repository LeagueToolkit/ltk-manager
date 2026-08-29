import {
  CaretUpIcon,
  PlugsIcon,
  StackIcon,
  WarningCircleIcon,
  WrenchIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect } from "react";
import { twMerge } from "tailwind-merge";

import {
  Button,
  ButtonGroup,
  IconButton,
  Menu,
  Progress,
  ShockedPoroDuotoneIcon,
  WolfIcon,
} from "@/components";
import { type ModHealthVerdict, type ModRepairProgress } from "@/lib/tauri";
import { useModHealthDrawerStore } from "@/stores";

import {
  type RepairRun,
  useBrokenMods,
  useCancelModHealthRun,
  useInstalledMods,
  useRepairMod,
  useRepairMods,
  useRepairTargets,
} from "../api";
import { HEADLINE, type SweepTone, toneOf } from "./modHealthNotice";

interface ModHealthSweepPanelProps {
  onClose: () => void;
}

/**
 * What the sweep found: a header, a row per mod, and the press that repairs them.
 *
 * Per "The status bar item and the drawer" in docs/ux/MOD_HEALTH.md. The shell
 * around it belongs to the caller, so the centred dialog and the sheet draw one
 * finding rather than two that drift apart.
 *
 * It owns the feature's only `useRepairMods`, whose progress listener has to be
 * mounted once, so exactly one shell may be mounted at a time. A row repairs
 * through `useRepairMod` instead, which listens to nothing and so can be held
 * once per row.
 */
export function ModHealthSweepPanel({ onClose }: ModHealthSweepPanelProps) {
  const { repairable, unrepairable } = useBrokenMods();
  const repair = useRepairMods();
  const { enabled } = useRepairTargets();
  const requested = useModHealthDrawerStore((s) => s.repairRequested);
  const takeRequest = useModHealthDrawerStore((s) => s.takeRepairRequest);

  /* The launch guard's "Repair first" opens the panel and asks for the run in
     one press, and the run is this component's to start. */
  useEffect(() => {
    if (!requested || repair.isRepairing) return;
    takeRequest();
    if (enabled.length > 0) repair.repair(enabled.map((verdict) => verdict.modId));
  }, [requested, enabled, repair, takeRequest]);

  const tone = toneOf(repairable.length);
  const fixable = repairable.length > 0;

  return (
    <>
      {/* The rim is the shell's, so a section draws only what divides it from
          the next one. */}
      <header
        className={`relative flex shrink-0 items-start gap-2.5 px-3 py-2.5 select-none ${tone.wash}`}
      >
        <PanelMark fixable={fixable} tone={tone} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium text-surface-100">{HEADLINE}</h2>
          <p className="text-xs text-surface-300">
            <Recommendation repairable={repairable.length} unrepairable={unrepairable.length} />
          </p>
        </div>
        <IconButton
          variant="ghost"
          size="sm"
          compact
          icon={<XIcon className="h-4 w-4" weight="bold" />}
          onClick={onClose}
          aria-label="Close"
        />
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-px ${tone.rule}`}
        />
      </header>

      <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto py-2 select-none">
        {repairable.map((verdict) => (
          <VerdictRow key={verdict.modId} verdict={verdict} />
        ))}
        {unrepairable.map((verdict) => (
          <VerdictRow key={verdict.modId} verdict={verdict} />
        ))}
      </ul>

      <PanelActions run={repair} fixable={fixable} onClose={onClose} />
    </>
  );
}

/**
 * The glyph the header is read from, at twice the size of a control's icon.
 *
 * The wolf carries its own amber rather than `currentColor`, and that amber is
 * the warning tone's. The poro is line art in one colour, so it takes the danger
 * tone a library no repair can reach is announced in.
 */
function PanelMark({ fixable, tone }: { fixable: boolean; tone: SweepTone }) {
  if (fixable) return <WolfIcon className="h-10 w-10 shrink-0" />;

  return <ShockedPoroDuotoneIcon className={twMerge("h-10 w-10 shrink-0", tone.chip)} />;
}

/**
 * The panel's last section: the way out, the repair beside it, or the run.
 *
 * The run is held by the panel rather than here, because the hook behind it
 * carries the progress subscription and has to be mounted exactly once.
 */
function PanelActions({
  run,
  fixable,
  onClose,
}: {
  run: RepairRun;
  fixable: boolean;
  onClose: () => void;
}) {
  if (run.progress) return <RepairProgress progress={run.progress} />;

  /* No repair reaches any of them, so the dismissal is the whole of what the
     footer has to offer and takes the confirm seat itself. */
  if (!fixable) {
    return (
      <PanelFoot>
        <Button size="sm" variant="filled" onClick={onClose}>
          Close
        </Button>
      </PanelFoot>
    );
  }

  return (
    <PanelFoot>
      <Button size="sm" variant="ghost" onClick={onClose}>
        Close
      </Button>
      <RepairPress run={run} />
    </PanelFoot>
  );
}

/**
 * The press that starts a repair, and the scope it runs over.
 *
 * Splits when some of the broken mods are switched off, per "Repair all" in
 * docs/ux/MOD_HEALTH.md. The press repairs what the next game will carry, and
 * the whole library is the deliberate second choice behind the caret.
 */
function RepairPress({ run }: { run: RepairRun }) {
  const { enabled, all } = useRepairTargets();

  const start = (verdicts: ModHealthVerdict[]) =>
    run.repair(verdicts.map((verdict) => verdict.modId));

  /* Nothing is switched off, so the two presses would do the same thing and a
     caret would only ask the reader to find that out. */
  if (enabled.length === all.length) {
    return (
      <Button size="sm" variant="filled" loading={run.isRepairing} onClick={() => start(all)}>
        <PlugsIcon className="h-4 w-4" weight="duotone" />
        Repair {plural(all.length, "mod")}
      </Button>
    );
  }

  /* Nothing broken is switched on, so there is no next-game work to lead with.
     Splitting here offers a dead press as the recommendation and hides the only
     run that does anything behind a caret. */
  if (enabled.length === 0) {
    return (
      <Button size="sm" variant="filled" loading={run.isRepairing} onClick={() => start(all)}>
        <StackIcon className="h-4 w-4" weight="duotone" />
        Repair all {all.length}
      </Button>
    );
  }

  return (
    <ButtonGroup>
      <Button size="sm" variant="filled" loading={run.isRepairing} onClick={() => start(enabled)}>
        <PlugsIcon className="h-4 w-4" weight="duotone" />
        Repair {plural(enabled.length, "enabled mod")}
      </Button>
      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton
              icon={<CaretUpIcon weight="bold" className="h-4 w-4" />}
              variant="filled"
              size="sm"
              aria-label="More repair options"
              className="w-auto px-2"
              disabled={run.isRepairing}
            />
          }
        />
        <Menu.Portal>
          <Menu.Positioner side="top" align="end">
            <Menu.Popup className="w-56">
              <Menu.Item
                icon={<StackIcon weight="duotone" className="h-4 w-4" />}
                onClick={() => start(all)}
              >
                Repair all {all.length}
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </ButtonGroup>
  );
}

/**
 * The band the panel is answered from, in a dialog's confirm seat.
 *
 * At the header's own padding rather than [`Dialog.Footer`]'s, so the presses
 * line up with the rows above them in a panel this dense.
 */
function PanelFoot({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 justify-end gap-2 border-t border-surface-600 px-3 py-2.5 select-none">
      {children}
    </div>
  );
}

/**
 * Where the running repair has got to, in the seat its own button was in.
 *
 * The panel names every mod the run is working through, so a toast over the top
 * of it would cover the list to report on it.
 */
function RepairProgress({ progress }: { progress: ModRepairProgress }) {
  const { data: mods = [] } = useInstalledMods();
  const cancel = useCancelModHealthRun();
  const names = progress.inFlight.map((id) => mods.find((mod) => mod.id === id)?.displayName ?? id);

  return (
    <div className="shrink-0 border-t border-accent-500/35 bg-accent-500/15 px-3 py-2.5 select-none">
      <Progress.Root value={progress.completed} max={progress.total}>
        <div className="mb-1.5 flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-xs font-medium text-surface-100">
            {repairingLabel(names)}
          </span>
          <span className="shrink-0 text-xs text-surface-300 tabular-nums">
            {progress.completed} / {progress.total}
          </span>
          {/* A mod already written stays written, so this stops the run rather
              than undoing it. What it did not reach keeps its own verdict. */}
          <IconButton
            variant="ghost"
            size="xs"
            compact
            icon={<XIcon className="h-3.5 w-3.5" weight="bold" />}
            onClick={() => cancel.mutate()}
            disabled={cancel.isPending}
            aria-label="Stop the repair"
            className="-my-1 h-5 w-5 shrink-0"
          />
        </div>
        <Progress.Track size="sm">
          <Progress.Indicator />
        </Progress.Track>
      </Progress.Root>
    </div>
  );
}

/**
 * What a run working on several mods at once calls itself.
 *
 * One name and a count of the rest, rather than a list: the row is one line
 * wide and three mod names do not fit in it. A run between mods names none.
 */
function repairingLabel(names: string[]) {
  const [first, ...rest] = names;
  if (!first) return "Repairing your mods";
  if (rest.length === 0) return `Repairing ${first}`;
  return `Repairing ${first} and ${rest.length} more`;
}

/**
 * The line under the title, which is what the reader is being asked to do.
 *
 * Three states, because "repair these" and "go and find newer ones" are different
 * errands and a list can be either or both. The title says what was found, so
 * none of these repeat it.
 */
function Recommendation({
  repairable,
  unrepairable,
}: {
  repairable: number;
  unrepairable: number;
}) {
  if (repairable === 0) {
    return <>None of them are auto-fixable, so look for updated versions</>;
  }

  if (unrepairable === 0) {
    return (
      <>
        All of them can be repaired automatically, so{" "}
        <strong className="font-medium text-surface-200">repairing is recommended</strong>
      </>
    );
  }

  return (
    <>
      <strong className="font-medium text-surface-200">Repairing is recommended</strong>, though
      some will need updated versions instead
    </>
  );
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function VerdictRow({ verdict }: { verdict: ModHealthVerdict }) {
  const { data: mods = [] } = useInstalledMods();
  const repair = useRepairMod();
  const name = mods.find((mod) => mod.id === verdict.modId)?.displayName ?? verdict.modId;
  const fixable = verdict.health === "repairable";

  return (
    <li className="group/row flex items-start gap-2.5 px-3 py-1.5 text-row hover:bg-surface-veil-soft">
      <RowIcon fixable={fixable} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium text-surface-100 select-text">{name}</span>
        <span className="text-meta text-surface-400">{outcome(verdict)}</span>
      </div>
      {fixable && (
        <Button
          variant="ghost"
          size="xs"
          compact
          loading={repair.isPending}
          onClick={() => repair.mutate(verdict.modId)}
          aria-label={`Repair ${name}`}
          className={twMerge(
            "shrink-0 self-center opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100",
            repair.isPending && "opacity-100",
          )}
        >
          <PlugsIcon className="h-4 w-4" weight="duotone" />
          Repair
        </Button>
      )}
    </li>
  );
}

/** Everything the two row glyphs share, so only the glyph and its hue differ. */
const ROW_ICON = "mt-0.5 h-5 w-5 shrink-0";

function RowIcon({ fixable }: { fixable: boolean }) {
  if (fixable) {
    return <WrenchIcon weight="duotone" className={`${ROW_ICON} text-warning-text`} />;
  }

  return <WarningCircleIcon weight="duotone" className={`${ROW_ICON} text-danger-text`} />;
}

/** What this row's mod is owed, in the one line under its name. */
function outcome(verdict: ModHealthVerdict): string {
  const { fatals, errors, warnings, infos } = verdict.counts;
  const total = fatals + errors + warnings + infos;
  if (verdict.health === "repairable") return plural(total, "problem");
  return `${plural(total, "unfixable problem")} :(`;
}

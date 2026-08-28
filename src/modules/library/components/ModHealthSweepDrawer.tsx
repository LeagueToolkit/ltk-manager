import {
  CaretUpIcon,
  PlugsIcon,
  StackIcon,
  WarningCircleIcon,
  WrenchIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";
import { twMerge } from "tailwind-merge";

import { Button, ButtonGroup, Dialog, IconButton, Menu, Progress, WolfIcon } from "@/components";
import { type ModHealthVerdict, type ModRepairProgress } from "@/lib/tauri";
import { useModHealthDrawerStore } from "@/stores";

import {
  type RepairRun,
  useBrokenMods,
  useInstalledMods,
  useRepairMod,
  useRepairMods,
  useRepairTargets,
} from "../api";
import { HEADLINE, type SweepTone, toneOf } from "./modHealthNotice";

interface ModHealthSweepDrawerProps {
  open: boolean;
  onClose: () => void;
}

const MIN_WIDTH = 280;
/** What the sheet leaves of the library it covers. */
const GRID_KEPT = 320;
/** How far one arrow key moves the edge. */
const KEY_STEP = 16;

/**
 * Which mods the sweep found, in a panel over the right of the library.
 *
 * Per "The status bar item and the drawer" in docs/ux/MOD_HEALTH.md. It owns the
 * feature's only `useRepairMods`, whose progress listener has to be mounted once.
 * A row repairs through `useRepairMod` instead, which listens to nothing and so
 * can be held once per row.
 *
 * It is a sheet over a dimmed page rather than a panel floating inside it: a
 * list this long is read rather than glanced at, and the grid behind it was
 * competing for the same attention.
 */
export function ModHealthSweepDrawer({ open, onClose }: ModHealthSweepDrawerProps) {
  const { repairable, unrepairable } = useBrokenMods();
  const repair = useRepairMods();
  const { enabled } = useRepairTargets();
  const requested = useModHealthDrawerStore((s) => s.repairRequested);
  const takeRequest = useModHealthDrawerStore((s) => s.takeRepairRequest);
  const width = useModHealthDrawerStore((s) => s.width);
  const setWidth = useModHealthDrawerStore((s) => s.setWidth);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  /* The launch guard's "Repair first" opens the drawer and asks for the run in
     one press, and the run is this component's to start. */
  useEffect(() => {
    if (!requested || repair.isRepairing) return;
    takeRequest();
    if (enabled.length > 0) repair.repair(enabled.map((verdict) => verdict.modId));
  }, [requested, enabled, repair, takeRequest]);

  function resize(next: number) {
    const ceiling = Math.max(MIN_WIDTH, window.innerWidth - GRID_KEPT);
    setWidth(Math.round(Math.max(MIN_WIDTH, Math.min(next, ceiling))));
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drag.current) return;
    resize(drag.current.startWidth - (event.clientX - drag.current.startX));
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleKeys(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    resize(width + (event.key === "ArrowLeft" ? KEY_STEP : -KEY_STEP));
  }

  const tone = toneOf(repairable.length);
  const fixable = repairable.length > 0;

  /* The list is the last section when nothing can be repaired, so it closes the
     panel off in place of the button that is not there. */
  const listFoot = fixable ? "" : "rounded-b-xl border-b";

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop />
        {/* Focus starts on the panel, not on its first tab stop. That stop is the
            resize handle, which would open the drawer with a lit bar down its
            edge and nothing saying why. */}
        <Dialog.Sheet
          ref={panel}
          side="right"
          initialFocus={panel}
          data-ui="ModHealthSweepDrawer"
          aria-label="What the check found"
          style={{ width }}
          className="inset-y-3 right-3 overflow-hidden rounded-xl"
        >
          {/* The panel draws no edge of its own. Each section carries the whole
              of one, so the rim changes colour down the drawer and the line
              between two sections belongs to one of them rather than to both. */}
          <header
            className={`flex shrink-0 items-start gap-2.5 rounded-t-xl border px-3 py-2.5 select-none ${tone.edge} ${tone.wash}`}
          >
            <DrawerMark fixable={fixable} tone={tone} />
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
          </header>

          <ul
            className={`flex min-h-0 flex-1 flex-col overflow-y-auto border-x border-surface-600 py-2 select-none ${listFoot}`}
          >
            {repairable.map((verdict) => (
              <VerdictRow key={verdict.modId} verdict={verdict} />
            ))}
            {unrepairable.map((verdict) => (
              <VerdictRow key={verdict.modId} verdict={verdict} />
            ))}
          </ul>

          {fixable && <RepairSection run={repair} />}

          {/* Last, so the tab order is the list and its presses before the one
              control that only changes the shape of the panel. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the drawer"
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onKeyDown={handleKeys}
            className="group/handle absolute inset-y-6 left-0 z-10 w-1.5 cursor-col-resize outline-none"
          >
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors group-hover/handle:bg-accent-500/60 group-focus-visible/handle:bg-accent-500"
            />
          </div>
        </Dialog.Sheet>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * The glyph the header is read from, at twice the size of a control's icon.
 *
 * The wolf carries its own amber rather than `currentColor`, and that amber is
 * the warning tone's. Nothing in the mark set is red, so a library no repair can
 * reach keeps a phosphor glyph that can take the danger tone.
 */
function DrawerMark({ fixable, tone }: { fixable: boolean; tone: SweepTone }) {
  if (fixable) return <WolfIcon className="h-10 w-10 shrink-0" />;

  return (
    <WarningCircleIcon className={twMerge("h-10 w-10 shrink-0", tone.chip)} weight="duotone" />
  );
}

/**
 * The drawer's last section: the press that starts a repair, or the repair.
 *
 * The run is held by the drawer rather than here, because the hook behind it
 * carries the progress subscription and has to be mounted exactly once.
 *
 * Splits when some of the broken mods are switched off, per "Repair all" in
 * docs/ux/MOD_HEALTH.md. The press repairs what the next game will carry, and
 * the whole library is the deliberate second choice behind the caret.
 */
function RepairSection({ run }: { run: RepairRun }) {
  const { enabled, all } = useRepairTargets();

  if (run.progress) return <RepairProgress progress={run.progress} />;

  const start = (verdicts: ModHealthVerdict[]) =>
    run.repair(verdicts.map((verdict) => verdict.modId));

  /* Nothing is switched off, so the two presses would do the same thing and a
     caret would only ask the reader to find that out. */
  if (enabled.length === all.length) {
    return (
      <Button
        compact
        variant="duotone"
        className="w-full rounded-t-none rounded-b-xl font-bold"
        loading={run.isRepairing}
        onClick={() => start(all)}
      >
        <PlugsIcon className="h-5 w-5 text-lg" weight="duotone" />
        Repair {plural(all.length, "mod")}
      </Button>
    );
  }

  return (
    <ButtonGroup className="w-full">
      <Button
        compact
        variant="duotone"
        className="flex-1 rounded-t-none rounded-bl-xl font-bold"
        loading={run.isRepairing}
        disabled={enabled.length === 0}
        onClick={() => start(enabled)}
      >
        <PlugsIcon className="h-5 w-5 text-lg" weight="duotone" />
        Repair {plural(enabled.length, "enabled mod")}
      </Button>
      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton
              icon={<CaretUpIcon weight="bold" className="h-4 w-4" />}
              variant="duotone"
              compact
              aria-label="More repair options"
              className="w-auto rounded-t-none rounded-br-xl px-2"
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
 * Where the running repair has got to, in the seat its own button was in.
 *
 * The drawer names every mod the run is working through, so a toast over the top
 * of it would cover the list to report on it.
 */
function RepairProgress({ progress }: { progress: ModRepairProgress }) {
  const { data: mods = [] } = useInstalledMods();
  const names = progress.inFlight.map((id) => mods.find((mod) => mod.id === id)?.displayName ?? id);

  return (
    <div className="shrink-0 rounded-b-xl border border-accent-500/35 bg-accent-500/15 px-3 py-2 select-none">
      <Progress.Root value={progress.completed} max={progress.total}>
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="truncate text-xs font-medium text-surface-100">
            {repairingLabel(names)}
          </span>
          <span className="shrink-0 text-xs text-surface-300 tabular-nums">
            {progress.completed} / {progress.total}
          </span>
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

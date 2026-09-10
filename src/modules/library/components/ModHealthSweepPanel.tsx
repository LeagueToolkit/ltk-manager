import {
  CaretDownIcon,
  CaretUpIcon,
  PackageIcon,
  PlugsIcon,
  StackIcon,
  XIcon,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { match } from "ts-pattern";

import {
  Button,
  ButtonGroup,
  Code,
  IconButton,
  Menu,
  Progress,
  SeverityGlyph,
  SeverityTally,
  ShockedPoroDuotoneIcon,
  Tooltip,
  WolfIcon,
  worstOf,
} from "@/components";
import { m, Marked } from "@/i18n";
import {
  type ModHealthVerdict,
  type ModRepairProgress,
  type ProblemSeverity,
  type RuleBrief,
} from "@/lib/tauri";
import { useModHealthDrawerStore } from "@/stores";
import { twMerge } from "@/utils";

import {
  type RepairRun,
  useCancelModHealthRun,
  useHealthVerdicts,
  useInstalledMods,
  useModHealthVerdicts,
  useRepairMod,
  useRepairMods,
} from "../api";
import {
  alarmOf,
  alarmOver,
  HEADLINE,
  NO_PROBLEMS,
  type SweepAlarm,
  type SweepTone,
  toneOf,
} from "./modHealthNotice";

interface ModHealthSweepPanelProps {
  onClose: () => void;
}

/**
 * What the sweep found: a header, the verdicts as two groups, and the press
 * that repairs them.
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
  const all = useHealthVerdicts({ health: "broken" });
  const repairable = useHealthVerdicts({ health: "repairable" });
  const unrepairable = useHealthVerdicts({ health: "unrepairable" });
  const repair = useRepairMods();
  const enabled = useHealthVerdicts({ health: "repairable", enabled: true });
  const requested = useModHealthDrawerStore((s) => s.repairRequested);
  const takeRequest = useModHealthDrawerStore((s) => s.takeRepairRequest);
  const focusModId = useModHealthDrawerStore((s) => s.focusModId);
  const informational = useHealthVerdicts({ health: "informational" });
  const { data: verdicts } = useModHealthVerdicts();

  /* A press about one mod is answered about that mod, so its row joins a list
     the library-wide surfaces would have left it out of. An info-only mod is
     already under the fold, which the press opens. */
  const rows = useMemo(() => {
    const focused = focusModId ? verdicts?.[focusModId] : undefined;
    const listed = [...all, ...informational];
    if (!focused || listed.some((verdict) => verdict.modId === focused.modId)) return all;
    return [...all, focused];
  }, [all, informational, focusModId, verdicts]);

  /* The launch guard's "Repair first" opens the panel and asks for the run in
     one press, and the run is this component's to start. */
  useEffect(() => {
    if (!requested || repair.isRepairing) return;
    takeRequest();
    if (enabled.length > 0) repair.repair(enabled.map((verdict) => verdict.modId));
  }, [requested, enabled, repair, takeRequest]);

  const alarm = alarmOver(all);
  const tone = toneOf(alarm);
  const fixable = repairable.length > 0;
  const headline = all.length > 0 ? HEADLINE : NO_PROBLEMS;

  return (
    <>
      {/* The rim is the shell's, so a section draws only what divides it from
          the next one. */}
      <header
        className={`relative flex shrink-0 items-start gap-2.5 px-3 py-2.5 select-none ${tone.wash}`}
      >
        <PanelMark alarm={alarm} tone={tone} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium text-surface-100">{headline}</h2>
          <p className="text-xs text-surface-300">
            <Recommendation repairable={repairable} unrepairable={unrepairable} />
          </p>
        </div>
        <IconButton
          variant="ghost"
          size="sm"
          compact
          icon={<XIcon className="h-4 w-4" weight="bold" />}
          onClick={onClose}
          aria-label={m.common_close_action()}
        />
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-px ${tone.rule}`}
        />
      </header>

      {/* One mod per row, as the Problems panel lists one file per row -
          DS-REPORT-PANEL. What a row is owed is its own severities, so it is
          marked on the row rather than said by a heading over a class of them. */}
      <div className="mx-2 my-2 min-h-0 flex-1 overflow-y-auto rounded-xl border border-surface-700 bg-surface-950/30 scrollbar-md">
        <VerdictRows verdicts={rows} />
      </div>

      <PanelActions run={repair} fixable={fixable} onClose={onClose} />
    </>
  );
}

/**
 * The glyph the header is read from, at twice the size of a control's icon.
 *
 * The wolf carries its own amber rather than `currentColor`, and that amber is
 * the warning tone's. The poro is line art in one colour, so it takes whichever
 * hue the rung is announced in - red for a library that has to be replaced, grey
 * for one that no repair reaches and nothing stops loading.
 */
function PanelMark({ alarm, tone }: { alarm: SweepAlarm; tone: SweepTone }) {
  if (alarm === "repairable") return <WolfIcon className="h-10 w-10 shrink-0" />;

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
          {m.common_close_action()}
        </Button>
      </PanelFoot>
    );
  }

  return (
    <PanelFoot>
      <Button size="sm" variant="ghost" onClick={onClose}>
        {m.common_close_action()}
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
  const all = useHealthVerdicts({ health: "repairable" });
  const enabled = useHealthVerdicts({ health: "repairable", enabled: true });

  const start = (verdicts: ModHealthVerdict[]) =>
    run.repair(verdicts.map((verdict) => verdict.modId));

  /* Nothing is switched off, so the two presses would do the same thing and a
     caret would only ask the reader to find that out. */
  if (enabled.length === all.length) {
    return (
      <Button size="sm" variant="filled" loading={run.isRepairing} onClick={() => start(all)}>
        <PlugsIcon className="h-4 w-4" weight="duotone" />
        {m.library_health_repair_action({ count: all.length })}
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
        {m.library_health_repair_all_action({ count: all.length })}
      </Button>
    );
  }

  return (
    <ButtonGroup>
      <Button size="sm" variant="filled" loading={run.isRepairing} onClick={() => start(enabled)}>
        <PlugsIcon className="h-4 w-4" weight="duotone" />
        {m.library_health_repair_enabled_action({ count: enabled.length })}
      </Button>
      <Menu.Root>
        <Menu.Trigger
          render={
            <IconButton
              icon={<CaretUpIcon weight="bold" className="h-4 w-4" />}
              variant="filled"
              size="sm"
              aria-label={m.library_health_repair_options_label()}
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
                {m.library_health_repair_all_action({ count: all.length })}
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
 * line up with the rows above them in a panel this dense. No rule and no top
 * padding of its own: the inset panel's margin is already the separation.
 */
function PanelFoot({ children }: { children: ReactNode }) {
  return (
    <div className="flex shrink-0 justify-end gap-2 px-3 pt-0 pb-2.5 select-none">{children}</div>
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
            aria-label={m.library_health_repair_stop_label()}
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
  if (!first) return m.library_health_repairing_label();
  if (rest.length === 0) return m.library_health_repairing_one_label({ name: first });
  return m.library_health_repairing_more_label({ name: first, count: rest.length });
}

/**
 * The line under the title, which is what the reader is being asked to do.
 *
 * "Repair these", "go and find newer ones" and "leave them alone" are three
 * different errands and a list can be any two of them, so the line answers both
 * halves. The title says what was found, so none of these repeat it.
 *
 * Only a mod the game refuses is sent after an updated version. A mod that loads
 * with a fault is one most people should keep and play, and telling that reader
 * to go looking is what the flat red header used to do to all of them.
 */
function Recommendation({
  repairable,
  unrepairable,
}: {
  repairable: ModHealthVerdict[];
  unrepairable: ModHealthVerdict[];
}) {
  return match({
    repairable: repairable.length,
    unrepairable: unrepairable.length,
    replaceable: alarmOver(unrepairable) === "broken",
  })
    .with({ repairable: 0, unrepairable: 0 }, () => (
      <>{m.library_health_informational_only_description()}</>
    ))
    .with({ repairable: 0, replaceable: true }, () => <>{m.library_health_replace_description()}</>)
    .with({ repairable: 0 }, () => <>{m.library_health_no_repair_description()}</>)
    .with({ unrepairable: 0 }, () => (
      <Recommended text={m.library_health_all_repairable_description()} />
    ))
    .with({ replaceable: true }, () => (
      <Recommended text={m.library_health_some_replaceable_description()} />
    ))
    .otherwise(() => <Recommended text={m.library_health_mixed_description()} />);
}

/** The recommendation, with whichever clause the sentence marks as its errand. */
function Recommended({ text }: { text: string }) {
  return (
    <Marked text={text}>
      {(clause) => <strong className="font-medium text-surface-200">{clause}</strong>}
    </Marked>
  );
}

/**
 * Every unhealthy mod, worst first.
 *
 * The list is flat because the two verdicts were never a ranking: a mod one
 * repair reaches and six hundred findings do not was filed above a mod with a
 * single fatal nothing can reach. Severity is what a reader is triaging by, so
 * it is what orders the rows, and the footer's own targets still lead.
 */
function VerdictRows({ verdicts }: { verdicts: ModHealthVerdict[] }) {
  const { data: mods = [] } = useInstalledMods();
  const informational = useHealthVerdicts({ health: "informational" });
  const showing = useModHealthDrawerStore((s) => s.showInformational);
  const enabled = new Set(mods.filter((mod) => mod.enabled).map((mod) => mod.id));

  const order = (rows: ModHealthVerdict[]) =>
    [...rows].sort((a, b) => {
      const lead = Number(enabled.has(b.modId)) - Number(enabled.has(a.modId));
      if (lead !== 0) return lead;
      const worst = RANK[worstOf(a.counts)] - RANK[worstOf(b.counts)];
      if (worst !== 0) return worst;
      return totalOf(b) - totalOf(a);
    });

  return (
    <ul className="flex flex-col py-1 select-none">
      {order(verdicts).map((verdict) => (
        <VerdictRow key={verdict.modId} verdict={verdict} />
      ))}
      {informational.length > 0 && <InformationalFold count={informational.length} />}
      {showing &&
        order(informational).map((verdict) => <VerdictRow key={verdict.modId} verdict={verdict} />)}
    </ul>
  );
}

/**
 * The line the mods holding nothing worse than an `Info` fold away behind.
 *
 * A line rather than a row: what is below it is not what the panel is reporting,
 * and a reader triaging the list above should be able to see where that list
 * ends. It sits last because severity is what orders the rows either way, and
 * nothing under it outranks anything over it.
 */
function InformationalFold({ count }: { count: number }) {
  const showing = useModHealthDrawerStore((s) => s.showInformational);
  const toggle = useModHealthDrawerStore((s) => s.toggleInformational);

  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={showing}
        className="flex w-full items-center gap-1.5 rounded-sm px-3 py-1.5 text-meta text-surface-400 hover:bg-surface-veil-soft focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-none focus-visible:ring-inset"
      >
        <SeverityGlyph severity="info" />
        <span>{m.library_health_informational_toggle_label()}</span>
        <span className="tabular-nums">{count}</span>
        <CaretDownIcon
          weight="bold"
          className={twMerge("h-3 w-3 shrink-0 transition-transform", showing && "rotate-180")}
        />
        <span aria-hidden="true" className="ml-1 h-px flex-1 bg-surface-600" />
      </button>
    </li>
  );
}

/** Where each severity sits when rows are ordered by the worst thing in them. */
const RANK: Record<ProblemSeverity, number> = { fatal: 0, error: 1, warning: 2, info: 3 };

/**
 * One mod's row: the mark, the name as a disclosure, and what is wrong with it.
 *
 * The severities take the seat the total count had, because a reader triaging a
 * list is asking how bad rather than how many, and the Repair press takes that
 * seat back on hover.
 */
function VerdictRow({ verdict }: { verdict: ModHealthVerdict }) {
  const { data: mods = [] } = useInstalledMods();
  const repair = useRepairMod();
  const focused = useModHealthDrawerStore((s) => s.focusModId) === verdict.modId;
  const [open, setOpen] = useState(focused);
  const row = useRef<HTMLLIElement>(null);
  const mod = mods.find((candidate) => candidate.id === verdict.modId);
  const name = mod?.displayName ?? verdict.modId;
  const alarm = alarmOf(verdict);
  const fixable = alarm === "repairable";
  /* A verdict recorded before briefs existed has nothing to unfold until its
     next check, and its row stays plain text. */
  const rules = verdict.rules ?? [];

  /* Centred rather than merely in view: a row the reader was sent to has to be
     found without reading the list to check. */
  useEffect(() => {
    if (!focused) return;
    row.current?.scrollIntoView({ block: "center" });
  }, [focused]);

  return (
    <li ref={row} className="text-row">
      <div className="group/row relative flex items-center gap-2 px-3 py-1.5 hover:bg-surface-veil-soft">
        <RowMark enabled={mod?.enabled ?? false} />
        {rules.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-accent-500 focus-visible:outline-none focus-visible:ring-inset"
          >
            <span className="min-w-0 truncate font-medium text-surface-100">{name}</span>
            <CaretDownIcon
              weight="bold"
              className={twMerge(
                "h-3 w-3 shrink-0 text-surface-500 transition-transform",
                open && "rotate-180",
              )}
            />
          </button>
        )}
        {rules.length === 0 && (
          <span className="min-w-0 flex-1 truncate font-medium text-surface-100 select-text">
            {name}
          </span>
        )}
        <span
          className={twMerge(
            "shrink-0 transition-opacity group-hover/row:opacity-0 group-has-[:focus-visible]/row:opacity-0",
            fixable && repair.isPending && "opacity-0",
          )}
        >
          <SeverityTally counts={verdict.counts} />
        </span>
        {fixable && (
          <Button
            variant="ghost"
            size="xs"
            compact
            loading={repair.isPending}
            onClick={() => repair.mutate(verdict.modId)}
            aria-label={m.library_health_repair_mod_label({ name })}
            className={twMerge(
              "absolute top-1/2 right-3 -translate-y-1/2 opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100",
              repair.isPending && "opacity-100",
            )}
          >
            <PlugsIcon className="h-4 w-4" weight="duotone" />
            {m.library_health_repair_one_action()}
          </Button>
        )}
        {/* The seat the press would be in. A reader asks why a row has none only
            at the moment they reach for it, so the sentence the group header
            used to hold over every such row is answered here instead. */}
        {verdict.health !== "healthy" && alarm !== "repairable" && (
          <span className="absolute top-1/2 right-3 -translate-y-1/2 text-meta whitespace-nowrap text-surface-500 opacity-0 transition-opacity group-hover/row:opacity-100 group-has-[:focus-visible]/row:opacity-100">
            {NO_PRESS[alarm]()}
          </span>
        )}
      </div>
      {open && <RuleList verdict={verdict} />}
    </li>
  );
}

/**
 * What a row with no press says in the seat the press would have taken.
 *
 * Only the mod the game refuses is sent after a replacement. The other one is
 * being told what the press would not have done, and nothing more. A row with
 * nothing wrong in it says neither, since it is missing no press.
 */
const NO_PRESS: Record<Exclude<SweepAlarm, "repairable">, () => string> = {
  broken: m.library_health_needs_update_label,
  flagged: m.library_health_not_fixable_label,
};

/** The row's package mark: the accent for a mod the next game carries, dim otherwise. */
function RowMark({ enabled }: { enabled: boolean }) {
  if (!enabled) {
    return <PackageIcon weight="duotone" className="h-4 w-4 shrink-0 text-surface-600" />;
  }

  return (
    <Tooltip content={m.library_health_enabled_label()}>
      <span className="flex shrink-0" aria-label={m.library_health_enabled_label()}>
        <PackageIcon weight="duotone" className="h-4 w-4 text-accent-400" />
      </span>
    </Tooltip>
  );
}

/**
 * The rules behind a row's count, for the reader who folds it open.
 *
 * Each rule says its cause in one sentence. Titles and sentences, never a site
 * or a property path - that is the modder's half, and it lives in the Problems
 * panel.
 */
function RuleList({ verdict }: { verdict: ModHealthVerdict }) {
  const fixable = verdict.health === "repairable";

  return (
    <ul className="flex flex-col gap-1.5 pt-0.5 pb-2 pl-9">
      {(verdict.rules ?? []).map((brief) => (
        <li key={brief.rule} className="flex flex-col gap-0.5 pr-3 text-meta">
          <div className="flex items-center gap-1.5 text-surface-400">
            <SeverityGlyph severity={brief.severity} />
            <span className="min-w-0 truncate">{brief.title}</span>
            <span className="shrink-0 tabular-nums">({brief.count})</span>
            <RuleReach brief={brief} offered={fixable} />
            <Code className="ml-auto select-text">{brief.rule}</Code>
          </div>
          {(brief.mismatches ?? []).length > 0 ? (
            /* The type pairs are the actual problem, so where the rule
               reports them they stand in for the rule's own sentence. */
            (brief.mismatches ?? []).map((mismatch) => (
              <p key={`${mismatch.expected}-${mismatch.found}`} className="text-surface-500">
                <Marked
                  text={m.library_health_type_mismatch_description({
                    expected: mismatch.expected,
                    found: mismatch.found,
                  })}
                >
                  {(value) => <Code>{value}</Code>}
                </Marked>
              </p>
            ))
          ) : (
            <p className="text-surface-500">{brief.description}</p>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * What the press will not reach on this line, and why.
 *
 * Only the exception is marked, and only inside a mod the press is offered for:
 * a library no repair reaches at all is the header's one sentence rather than
 * twenty rows of it.
 *
 * The count beside this stays a count. A rule reporting the same state on two
 * mods is told apart by these words rather than by a tint, because the line
 * already spends colour on severity and a reader cannot be asked to read one
 * hue as two things.
 *
 * The why-not is this phrase's tooltip, per "A rule line says its cause once"
 * in docs/ux/MOD_HEALTH.md.
 */
function RuleReach({ brief, offered }: { brief: RuleBrief; offered: boolean }) {
  const missed = brief.count - brief.fixable;
  if (!offered || missed === 0) return null;

  const phrase = (
    <span className="shrink-0 text-surface-500">
      {missed === brief.count
        ? m.library_health_rule_not_fixable_label()
        : m.library_health_rule_partly_fixable_label({ count: missed })}
    </span>
  );

  if (brief.unfixable == null) return phrase;
  return <Tooltip content={brief.unfixable}>{phrase}</Tooltip>;
}

function totalOf(verdict: ModHealthVerdict): number {
  const { fatals, errors, warnings, infos } = verdict.counts;
  return fatals + errors + warnings + infos;
}

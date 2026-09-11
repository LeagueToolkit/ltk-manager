import { CaretRightIcon } from "@phosphor-icons/react";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { twMerge } from "tailwind-merge";

import { AlertBox, Button, Code, Switch } from "@/components";
import { m, Marked } from "@/i18n";
import type { BinDocumentId, BinRow, DeclaredKind } from "@/lib/tauri";
import { useInspectorDefaults, useSetPreviewDisplay } from "@/stores";

import { fieldHash, rowKey } from "./binRows";
import { ChancePin } from "./ChancePin";
import { AlsoCheck, FieldRow } from "./ClassCells";
import { CurveChainContext, useCurveDock } from "./curveTarget";
import { emitterChain, emitterRows, fieldChain } from "./emitterCards";
import { useEmitters } from "./emitterChoice";
import {
  type DefaultField,
  type EmitterGroup,
  GROUP_TITLE,
  type GroupedRows,
  type InspectorGroup,
  inspectorGroups,
  unauthoredFields,
} from "./emitterGroups";
import {
  type ChildChoice,
  type EmitterCardData,
  SECTION_FOLDED,
  SECTION_SHOWN,
} from "./emitterTypes";
import { FieldCard } from "./FieldCard";
import { groupInView } from "./inspectorScroll";
import { shapeTag } from "./kindTag";
import {
  drawnAtBirth,
  type DrawSummary,
  drawSummary,
  randomDraw,
  rerollsEveryFrame,
} from "./randomDraw";
import { shapeText, summaryText } from "./randomText";
import { RowDocumentContext, type RowFold, RowFoldContext } from "./rowFold";
import { nameColumn } from "./textCut";
import { useClassSchema } from "./useClassSchema";
import { useLinkOpen } from "./useLinkTargets";
import { useValueMarks } from "./useValueMarks";
import { type ValueFamily, valueFamily } from "./valueRows";

/** The name column, fitted to the longest name the inspector draws through `--name-width`. */
const NAME_COLUMN = "w-(--name-width)";

/** The share of a row past which the name column cuts its names. */
const NAME_CAP = "40%";

/** What the column holds beside a name, in pixels. */
const NAME_EXTRA = 8;

/**
 * The inspector in a box of its own, which is what a stack draws under the strip.
 *
 * The host gives it its height, and a stack caps it so no emitter owns the page. Defaults
 * rides the tab row here, where a shell's pane strip carries it.
 */
export function EmitterPanel({ className }: { className?: string }) {
  return (
    /* DS-GROUND, DS-RADIUS */
    <EmitterFields
      className={twMerge(
        "overflow-hidden rounded-md border border-surface-700/50 bg-surface-900",
        className,
      )}
      actions={<InspectorDefaults />}
    />
  );
}

/** How far past the pane a section is read, so a scroll meets keys already answered. */
const SECTION_MARGIN = "200px 0px";

interface EmitterFieldsProps {
  className?: string;
  /** Drawn at the tab row's right end, for a host whose own strip carries none. */
  actions?: ReactNode;
}

/**
 * The emitter's groups as sections that fold, under a tab row of All and each group.
 *
 * "The inspector" in docs/ux/BIN_EDITOR.md. A pane of the shell is already a box, so the
 * panel inside it draws no surface of its own.
 */
export function EmitterFields({ className, actions }: EmitterFieldsProps) {
  const { card, child, open, target, jumpRequest, reportInView, openRows, toggleRow } =
    useEmitters();
  const on = useInspectorDefaults();
  const owner = cardClass(card);
  const { data } = useClassSchema(on ? owner : null);

  /* The tabs name every group the emitter sets, whichever of them is drawn. */
  const all = useMemo(() => {
    const held = target === "system" ? NO_GROUPED : (card?.groups ?? NO_GROUPED);
    if (!on || data == null) return inspectorGroups(held, NO_DEFAULTS);
    const authored = new Set(held.flatMap((each) => each.rows).map((row) => fieldHash(row.path)));
    return inspectorGroups(held, unauthoredFields(data.fields, authored));
  }, [target, card, on, data]);
  const focus = target === "group" ? (open?.group ?? null) : null;
  const groups = useMemo(
    () => (focus === null ? all : all.filter((each) => each.group === focus)),
    [all, focus],
  );
  const column = useMemo(
    () =>
      ({
        "--name-width": nameColumn(
          all.flatMap((each) => [
            ...each.rows.map((row) => row.name),
            ...each.defaults.map((field) => field.name),
          ]),
          NAME_EXTRA,
          NAME_CAP,
        ),
      }) as CSSProperties,
    [all],
  );
  /* Held by the path under the emitter, so a shape opened on one emitter is open on the next. */
  const fold = useMemo<RowFold | null>(() => {
    if (card === undefined) return null;
    const under = (row: BinRow) => row.path.slice(card.row.path.length);
    return { isOpen: (row) => openRows.has(under(row)), toggle: (row) => toggleRow(under(row)) };
  }, [card, openRows, toggleRow]);

  const scroller = useRef<HTMLDivElement>(null);
  const roots = useRef(new Map<EmitterGroup, HTMLElement>());
  const register = useCallback((group: EmitterGroup, element: HTMLElement | null) => {
    if (element === null) roots.current.delete(group);
    else roots.current.set(group, element);
  }, []);
  const jump = useCallback((group: EmitterGroup) => {
    roots.current.get(group)?.scrollIntoView?.({ block: "start" });
  }, []);

  /* An aim lands on its group's top, and aiming the same group twice lands there again. */
  const aimed = open?.group ?? null;
  const cardKey = card?.key;
  useEffect(() => {
    if (aimed !== null && cardKey !== undefined) jump(aimed);
  }, [aimed, cardKey, jumpRequest, jump]);

  const measureInView = useCallback(() => {
    const pane = scroller.current;
    if (pane === null || cardKey === undefined) return;
    const box = pane.getBoundingClientRect();
    const sections = groups.flatMap((each) => {
      const element = roots.current.get(each.group);
      if (element === undefined) return [];
      const { top, bottom } = element.getBoundingClientRect();
      return [{ group: each.group, top, bottom }];
    });
    const atEnd = pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 1;
    reportInView(
      cardKey,
      groupInView(sections, { top: box.top, bottom: box.bottom, atEnd }, aimed),
    );
  }, [groups, cardKey, aimed, reportInView]);

  /* After the jump above, so an aim that scrolls at once is measured where it landed. A
     fold moves every section under it without a scroll, which the observer catches. */
  useEffect(() => {
    measureInView();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measureInView());
    for (const element of roots.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [measureInView]);

  return (
    <div data-ui="EmitterPanel" className={twMerge("flex min-h-0 flex-col", className)}>
      {child !== null && <ChildBanner child={child} />}
      <GroupTabs groups={all} actions={actions} />
      {/* DS-SCROLLBAR */}
      <div
        ref={scroller}
        data-ui="EmitterPanel:body"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-1.5 scrollbar-md"
        style={column}
        onScroll={measureInView}
      >
        <ChildChecks>
          <CurveChainContext value={card === undefined ? "" : emitterChain(card)}>
            <RowFoldContext value={fold}>
              {focus === null && card !== undefined && target !== "system" && (
                <RandomSection card={card} />
              )}
              {groups.map((each) => (
                <GroupSection
                  key={each.group}
                  held={each}
                  owner={owner}
                  scroller={scroller}
                  register={register}
                />
              ))}
            </RowFoldContext>
          </CurveChainContext>
        </ChildChecks>
      </div>
    </div>
  );
}

const NO_DEFAULTS: readonly DefaultField[] = [];
const NO_GROUPED: readonly GroupedRows[] = [];

/** The child system a lane's emitter belongs to, and the way to that system's own tab. */
function ChildBanner({ child }: { child: ChildChoice }) {
  const { wantOpen } = useLinkOpen();
  const { entry } = child.system;

  return (
    <div className="shrink-0 px-1.5 pt-1.5 font-sans">
      <AlertBox
        variant="neutral"
        data-ui="EmitterPanel:child-banner"
        title={
          <span className="flex min-w-0 items-center gap-1">
            <span className="min-w-0 truncate">{child.emitter.name}</span>
            <span className="shrink-0 text-surface-500">[{child.emitter.listIndex}]</span>
          </span>
        }
        actions={
          <Button
            variant="ghost"
            size="xs"
            disabled={entry === null}
            onClick={() => entry !== null && wantOpen(entry, "default")}
          >
            {m.workshop_bin_inspector_open_system_action()}
          </Button>
        }
      >
        <Marked
          text={m.workshop_bin_inspector_child_description({
            name: child.system.name ?? entry ?? "",
          })}
        >
          {(clause) => <Code>{clause}</Code>}
        </Marked>
      </AlertBox>
    </div>
  );
}

/** The link checks of a child lane's rows, which the view's own checks never reach. */
function ChildChecks({ children }: { children: ReactNode }) {
  const { card, child } = useEmitters();
  const document = use(RowDocumentContext);
  const group = useMemo(
    () =>
      child === null || card === undefined ? null : { key: card.key, rows: emitterRows(card) },
    [child, card],
  );

  if (document === null || group === null) return children;
  return (
    <AlsoCheck document={document} group={group}>
      {children}
    </AlsoCheck>
  );
}

/** The class an emitter's fields are read on, which its own element row carries. */
function cardClass(card: EmitterCardData | undefined): string | null {
  if (card?.row.value.type !== "struct") return null;
  return card.row.value.classHash;
}

/** The tabs pinned to the pane's top: All, then one per group, each drawing what it names. */
function GroupTabs({
  groups,
  actions,
}: {
  groups: readonly InspectorGroup[];
  actions?: ReactNode;
}) {
  const { open, target, aim, chooseGroup, card } = useEmitters();
  const focus = target === "group" ? (open?.group ?? null) : null;

  if (groups.length === 0 && actions === undefined) return null;
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-surface-700/50 px-1.5 py-1">
      <nav
        data-ui="EmitterPanel:tabs"
        aria-label={m.workshop_bin_inspector_groups_label()}
        className="flex min-w-0 flex-1 flex-wrap items-center gap-1 font-sans text-meta"
      >
        <GroupTab on={focus === null} onClick={() => aim("emitter")}>
          {m.workshop_bin_inspector_all_label()}
        </GroupTab>
        {groups.map((each) => (
          <GroupTab
            key={each.group}
            on={focus === each.group}
            onClick={() => {
              if (card !== undefined) chooseGroup({ key: card.key, group: each.group });
            }}
          >
            {GROUP_TITLE[each.group]()}
          </GroupTab>
        ))}
      </nav>
      {actions}
    </div>
  );
}

function GroupTab({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-current={on ? "location" : undefined}
      /* DS-RADIUS, DS-VEIL */
      className={twMerge(
        "cursor-pointer rounded-sm px-1.5 py-0.5",
        on
          ? "bg-accent-500/15 text-accent-300"
          : "text-surface-400 hover:bg-surface-veil hover:text-surface-200",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface GroupSectionProps {
  held: InspectorGroup;
  owner: string | null;
  scroller: RefObject<HTMLDivElement | null>;
  register: (group: EmitterGroup, element: HTMLElement | null) => void;
}

/** One group as a section that folds, reading its curves while it is on screen. */
function GroupSection({ held, owner, scroller, register }: GroupSectionProps) {
  const { report } = useEmitters();
  const [open, setOpen] = useState(true);
  const root = useRef<HTMLElement | null>(null);
  const { group } = held;

  useEffect(() => {
    if (!open) {
      report(group, SECTION_FOLDED);
      return;
    }

    /* Reported before the observer answers, so a host that has none draws its curves and
       a section just unfolded does not wait on a frame for them. */
    report(group, SECTION_SHOWN);
    const element = root.current;
    if (element === null || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => report(group, { drawn: true, seen: entry?.isIntersecting ?? true }),
      { root: scroller.current, rootMargin: SECTION_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [group, open, report, scroller]);

  return (
    <section
      data-ui="EmitterPanel:group"
      ref={(element) => {
        root.current = element;
        register(group, element);
      }}
      className="flex scroll-mt-1 flex-col gap-0.5"
    >
      <button
        type="button"
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-1 px-1 pt-1 text-left font-sans text-xs font-medium tracking-wide text-surface-400 uppercase hover:text-surface-200"
        onClick={() => setOpen((shown) => !shown)}
      >
        <CaretRightIcon weight="bold" className={twMerge("h-3 w-3", open && "rotate-90")} />
        {GROUP_TITLE[group]()}
      </button>
      {open &&
        held.rows.map((row) => (
          <FieldRow key={rowKey(row)} row={row} width={NAME_COLUMN} owner={owner} />
        ))}
      {open &&
        held.defaults.map((field) => (
          <DefaultRow key={field.hash} field={field} width={NAME_COLUMN} owner={owner} />
        ))}
    </section>
  );
}

/**
 * Every field of the emitter a table randomizes, under the one roll they share.
 *
 * "The inspector" in docs/ux/BIN_EDITOR.md. Drawn above the groups and only where something
 * is random, and a row aims the dock's graph.
 */
function RandomSection({ card }: { card: EmitterCardData }) {
  const document = use(RowDocumentContext);
  if (document === null) return null;
  return <RandomFields document={document} card={card} />;
}

function RandomFields({ document, card }: { document: BinDocumentId; card: EmitterCardData }) {
  const { aim } = useCurveDock();
  const [open, setOpen] = useState(true);
  /* Birth fields alone, so the section reads what it draws and a folded group's others stay unread. */
  const rows = useMemo(
    () =>
      emitterRows(card).filter((row) => valueFamily(row.value) !== null && drawnAtBirth(row.name)),
    [card],
  );
  const marks = useValueMarks(document, rows, "curves");
  const random = useMemo(
    () =>
      rows.flatMap((row) => {
        const mark = marks.get(rowKey(row));
        const draw = randomDraw(mark);
        const summary = draw === null ? null : drawSummary(draw);
        return mark === undefined || summary === null
          ? []
          : [{ row, family: mark.family, summary }];
      }),
    [rows, marks],
  );

  if (random.length === 0) return null;
  return (
    <section data-ui="EmitterPanel:random" className="flex flex-col gap-0.5">
      <div className="flex min-w-0 items-center gap-2 px-1 pt-1">
        <button
          type="button"
          aria-expanded={open}
          className="flex shrink-0 cursor-pointer items-center gap-1 text-left font-sans text-xs font-medium tracking-wide text-surface-400 uppercase hover:text-surface-200"
          onClick={() => setOpen((shown) => !shown)}
        >
          <CaretRightIcon weight="bold" className={twMerge("h-3 w-3", open && "rotate-90")} />
          {m.workshop_bin_inspector_random_title()}
        </button>
        <span className="min-w-0 truncate font-sans text-meta text-surface-500 select-none">
          {m.workshop_bin_inspector_random_hint()}
        </span>
        <ChancePin className="ml-auto" />
      </div>
      {open &&
        random.map(({ row, family, summary }) => (
          <RandomRow
            key={rowKey(row)}
            row={row}
            family={family}
            summary={summary}
            onAim={() => aim({ row, chain: fieldChain(card, row), tab: "graph" })}
          />
        ))}
    </section>
  );
}

interface RandomRowProps {
  row: BinRow;
  family: ValueFamily;
  summary: DrawSummary;
  onAim: () => void;
}

/** One randomized field: its name, what it draws, and the shape of the draw. */
function RandomRow({ row, family, summary, onAim }: RandomRowProps) {
  const flickers = summary.kind !== "broken" && rerollsEveryFrame(fieldHash(row.path));

  return (
    <button
      type="button"
      data-row-key={rowKey(row)}
      /* DS-VEIL, DS-RADIUS */
      className="flex min-h-6 cursor-pointer items-center gap-2 rounded-sm px-1.5 text-left hover:bg-surface-veil-soft"
      onClick={onAim}
    >
      <span className={twMerge("min-w-0 shrink-0 truncate text-surface-200", NAME_COLUMN)}>
        {row.name}
      </span>
      <span
        className={twMerge(
          "min-w-0 truncate text-surface-100 tabular-nums",
          summary.kind === "broken" && "text-danger-text",
        )}
      >
        {summaryText(summary, family, false)}
      </span>
      <span
        /* DS-TEXT */
        className={twMerge(
          "shrink-0 font-sans text-meta text-surface-400",
          flickers && "text-warning-text",
        )}
      >
        {sectionShape(summary, flickers)}
      </span>
    </button>
  );
}

/** The word after a randomized field's range, which a count or a broken set has none of. */
function sectionShape(summary: DrawSummary, flickers: boolean): string {
  if (flickers) return m.workshop_bin_random_flicker_label();
  if (summary.kind === "one") return shapeText(summary.draw);
  if (summary.kind === "linked") return m.workshop_bin_random_linked_label();
  return "";
}

/**
 * A field the class declares and the emitter leaves alone, dimmed and without a value.
 *
 * "Defaults" in docs/ux/BIN_EDITOR.md. The schema carries the type and no default, so
 * the row draws what the field would hold rather than what it is worth.
 */
function DefaultRow({
  field,
  width,
  owner,
}: {
  field: DefaultField;
  width: string;
  owner: string | null;
}) {
  const declared: DeclaredKind | null =
    field.declared === null ? null : { shape: field.declared, mismatch: false };

  return (
    /* DS-VEIL, DS-RADIUS */
    <div className="flex min-h-6 items-center gap-2 rounded-sm px-1.5 opacity-60 hover:bg-surface-veil-soft">
      <span className={twMerge("flex min-w-0 shrink-0", width)}>
        <FieldCard
          classHash={owner}
          fieldHash={field.hash}
          name={field.name}
          unnamed={field.name === field.hash}
          declared={declared}
          triggerClassName="text-surface-500"
          cut
        />
      </span>
      {declared !== null && (
        /* DS-CODE-CHIP */
        <Code className="shrink-0 text-surface-500">{shapeTag(declared.shape)}</Code>
      )}
    </div>
  );
}

/** Whether the inspector lists the fields the emitter leaves at their default. */
export function InspectorDefaults() {
  const on = useInspectorDefaults();
  const setDisplay = useSetPreviewDisplay();
  const label = m.workshop_bin_inspector_defaults_label();

  return (
    <span className="flex shrink-0 items-center gap-1.5 font-sans text-meta text-surface-400 select-none">
      {label}
      <Switch
        aria-label={label}
        checked={on}
        onCheckedChange={(checked: boolean) => setDisplay({ inspectorDefaults: checked })}
      />
    </span>
  );
}

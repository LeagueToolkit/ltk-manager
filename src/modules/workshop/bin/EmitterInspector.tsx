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
import type { BinRow, DeclaredKind } from "@/lib/tauri";
import { useInspectorDefaults, useSetPreviewDisplay } from "@/stores";

import { fieldHash, rowKey } from "./binRows";
import { AlsoCheck, FieldRow } from "./ClassCells";
import { CurveChainContext } from "./curveTarget";
import { emitterChain, emitterRows } from "./emitterCards";
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
import { shapeTag } from "./kindTag";
import { type RailMark, railMark } from "./rollRail";
import { RowDocumentContext, type RowFold, RowFoldContext } from "./rowFold";
import { nameColumn } from "./textCut";
import { useClassSchema } from "./useClassSchema";
import { useLinkOpen } from "./useLinkTargets";
import { ValueMarksContext } from "./useValueMarks";

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
  /** Drawn in the header row, for a host whose own strip carries none. */
  actions?: ReactNode;
}

/**
 * The emitter's groups as sections that fold, each under a header that sticks to the top.
 *
 * "The inspector" in docs/ux/BIN_EDITOR.md. A pane of the shell is already a box, so the
 * panel inside it draws no surface of its own.
 */
export function EmitterFields({ className, actions }: EmitterFieldsProps) {
  const { card, child, open, target, jumpRequest, openRows, toggleRow } = useEmitters();
  const on = useInspectorDefaults();
  const owner = cardClass(card);
  const { data } = useClassSchema(on ? owner : null);

  const groups = useMemo(() => {
    const held = target === "system" ? NO_GROUPED : (card?.groups ?? NO_GROUPED);
    if (!on || data == null) return inspectorGroups(held, NO_DEFAULTS);
    const authored = new Set(held.flatMap((each) => each.rows).map((row) => fieldHash(row.path)));
    return inspectorGroups(held, unauthoredFields(data.fields, authored));
  }, [target, card, on, data]);
  const column = useMemo(
    () =>
      ({
        "--name-width": nameColumn(
          groups.flatMap((each) => [
            ...each.rows.map((row) => row.name),
            ...each.defaults.map((field) => field.name),
          ]),
          NAME_EXTRA,
          NAME_CAP,
        ),
      }) as CSSProperties,
    [groups],
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
  /* An aim lands on its group's top, and aiming the same group twice lands there again. */
  const aimed = open?.group ?? null;
  const cardKey = card?.key;
  useEffect(() => {
    if (aimed === null || cardKey === undefined) return;
    roots.current.get(aimed)?.scrollIntoView?.({ block: "start" });
  }, [aimed, cardKey, jumpRequest]);

  return (
    <div data-ui="EmitterPanel" className={twMerge("flex min-h-0 flex-col", className)}>
      {child !== null && <ChildBanner child={child} />}
      <PanelHeader actions={actions} />
      {/* DS-SCROLLBAR. The left padding is the roll rail's gutter, outside every row. */}
      <div
        ref={scroller}
        data-ui="EmitterPanel:body"
        className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto py-1.5 pr-1.5 pl-3.5 scrollbar-md"
        style={column}
      >
        <ChildChecks>
          <CurveChainContext value={card === undefined ? "" : emitterChain(card)}>
            <RowFoldContext value={fold}>
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

/**
 * The row over the groups, which a host carrying the actions on a strip of its own draws none of.
 *
 * Held by whether the host gave it anything rather than by the run, so taking or dropping a
 * chance pin never adds a row and shifts the reader's scroll under them.
 */
function PanelHeader({ actions }: { actions?: ReactNode }) {
  if (actions === undefined) return null;

  return (
    <div className="flex shrink-0 items-center justify-end gap-3 border-b border-surface-700/50 px-1.5 py-1">
      {actions}
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

  /* Every row's mark at once, so a segment knows whether the row under it carries the same
     one and can close the gap the rows are laid out with. */
  const marks = use(ValueMarksContext);
  const rails = held.rows.map((row) => railMark(row, marks.get(rowKey(row))));

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
        /* DS-GROUND: opaque, since the rows scroll under it rather than past it. */
        className="sticky top-0 z-10 -ml-2 flex cursor-pointer items-center gap-1 bg-surface-900 py-1 pr-1 pl-3 text-left font-sans text-xs font-medium tracking-wide text-surface-400 uppercase hover:text-surface-200"
        onClick={() => setOpen((shown) => !shown)}
      >
        <CaretRightIcon weight="bold" className={twMerge("h-3 w-3", open && "rotate-90")} />
        {GROUP_TITLE[group]()}
      </button>
      {open &&
        held.rows.map((row, at) => (
          <FieldRow
            key={rowKey(row)}
            row={row}
            width={NAME_COLUMN}
            owner={owner}
            rail={
              <RollRail
                mark={rails[at] ?? null}
                joins={rails[at] !== null && rails[at + 1] === rails[at]}
              />
            }
          />
        ))}
      {open &&
        held.defaults.map((field) => (
          <DefaultRow key={field.hash} field={field} width={NAME_COLUMN} owner={owner} />
        ))}
    </section>
  );
}

/**
 * The gutter mark of a row the rail reaches, and nothing for every other row.
 *
 * "The roll rail says when a value is rolled" in docs/ux/BIN_EDITOR.md. `joins` reaches the
 * segment into the gap the rows are laid out with, so a run reads as one bar and a break is
 * a row the rail does not reach rather than the space between any two rows.
 */
function RollRail({ mark, joins }: { mark: RailMark | null; joins: boolean }) {
  if (mark === null) return null;

  return (
    <span
      role="img"
      aria-label={
        mark === "flicker"
          ? m.workshop_bin_inspector_flicker_label()
          : m.workshop_bin_inspector_roll_label()
      }
      /* DS-TOKEN, DS-RADIUS */
      className={twMerge(
        "absolute top-0 -left-2 w-0.5 rounded-full",
        joins ? "-bottom-0.5" : "bottom-0",
        mark === "flicker" ? "bg-warning/60" : "bg-accent-500/50",
      )}
    />
  );
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

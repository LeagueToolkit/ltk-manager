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

import { AlertBox, Button, Code, OVERLINE, SearchField } from "@/components";
import { useReducedMotion } from "@/hooks";
import { m, Marked } from "@/i18n";
import type { BinRow, FieldSchema } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { AlsoCheck, FieldRow } from "../../../classes/components/ClassCells";
import { useClassSchema } from "../../../classes/hooks/useClassSchema";
import { FieldLabelsContext } from "../../../classes/state/fieldLabels";
import { CurveChainContext } from "../../../curves/state/curveTarget";
import { type RailMark, railMark } from "../../../curves/utils/rollRail";
import { useChangedOnlyView } from "../../../documents/hooks/useChanges";
import { useLinkOpen } from "../../../links/hooks/useLinkTargets";
import { LeafEditContext } from "../../../tree/hooks/useLeafEdit";
import { RowDocumentContext, type RowFold, RowFoldContext } from "../../../tree/state/rowFold";
import { fieldHash, rowKey } from "../../../tree/utils/binRows";
import { ValueMarksContext } from "../../../values/hooks/useValueMarks";
import { CHILD_SET } from "../../children/childModel";
import { childrenMatch, ChildrenSection } from "../../children/ChildrenSection";
import { useChildren } from "../../children/useChildren";
import { EmitterPreviewBox } from "../../drivers/components/EmitterPreviewBox";
import { EMBED_TONE, hueStyle } from "../../drivers/components/NodeFrame";
import { ValueRow } from "../../drivers/components/ValueRow";
import { useValueItems } from "../../drivers/hooks/useValueItems";
import { FORCE_COLLECTION } from "../../forces/forceModel";
import { ForcesSection, forceMatches } from "../../forces/ForcesSection";
import { useForces } from "../../forces/useForces";
import { useReadOnlyReason, useShownPaneCommands } from "../../hooks/usePaneOffers";
import { VfxRunContext } from "../../playback/state/run";
import { STENCIL_FIELD } from "../../stencil/stencilEdits";
import { StencilNotes } from "../../stencil/StencilNotes";
import { StencilMaskProperty, StencilModeProperty } from "../../stencil/StencilProperty";
import { TIMING } from "../../timeline/utils/timingEdits";
import { VFX_COMMAND, VFX_PANE } from "../../utils/vfxCommands";
import { useEmitters } from "../state/emitterChoice";
import { useDefinedOnly, useInspectorPreview } from "../state/inspectorView";
import { SHAPE_FIELD, SURFACE_FIELD } from "../utils/emissionSource";
import { emitterChain, emitterRows } from "../utils/emitterCards";
import {
  type DefaultField,
  defaultField,
  type EmitterGroup,
  GROUP_TITLE,
  type GroupedRows,
  type InspectorGroup,
  type InspectorProperty,
  inspectorGroups,
  inspectorProperties,
  unauthoredFields,
} from "../utils/emitterGroups";
import { emitterLabel, filterEmitterGroups } from "../utils/emitterLabels";
import {
  type ChildChoice,
  type EmitterCardData,
  type RowReveal,
  SECTION_FOLDED,
  SECTION_SHOWN,
} from "../utils/emitterTypes";
import { PRIMITIVE_FIELD } from "../utils/primitives";
import { rowHasDefault } from "../utils/propertyDefaults";
import { AddPropertyBox, useAddedJump } from "./AddPropertyBox";
import { DefaultProperty } from "./DefaultProperty";
import { EmissionNotes } from "./EmissionNotes";
import { FlipbookView } from "./FlipbookView";
import { InspectorActions } from "./InspectorActions";
import { PeriodProperty } from "./PeriodProperty";
import { PrimitiveProperty } from "./PrimitiveProperty";
import { RateReadout } from "./RateReadout";
import { ShapeProperty } from "./ShapeProperty";
import { SurfaceProperty } from "./SurfaceProperty";

/** The shared label column of the inspector's property tables. */
const NAME_COLUMN = "w-(--name-width)";
export const COLUMN_STYLE = {
  "--name-width": "clamp(7rem, 32%, 12rem)",
  "--readout-height": "1.25rem",
  "--readout-padding-x": "0.25rem",
  "--readout-step-width": "0.75rem",
  "--bin-scalar-width": "5rem",
  "--bin-component-width": "4rem",
} as CSSProperties;

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
  const { card, child, open, target, jumpRequest, openRows, toggleRow, revealed } = useEmitters();
  const owner = cardClass(card);
  const { data } = useClassSchema(owner);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const forces = useForces();
  const children = useChildren();
  const definedOnly = useDefinedOnly();
  const changedOnly = useChangedOnlyView();
  const preview = useInspectorPreview();
  const running = (use(VfxRunContext)?.system ?? null) !== null;
  const addable = use(LeafEditContext)?.addProperty !== undefined;
  const [adding, setAdding] = useState(false);

  const groups = useMemo(() => {
    const source = target === "system" ? NO_GROUPED : (card?.groups ?? NO_GROUPED);
    /* The Forces and Child particles sections draw these two, so no group repeats them. */
    const held = forces.visible
      ? source.map((group) => ({
          ...group,
          rows: group.rows.filter((row) => !OWN_SECTION.has(fieldHash(row.path))),
        }))
      : source;
    if (changedOnly !== null) {
      const changed = (row: BinRow) =>
        changedOnly.rows.has(rowKey(row)) || changedOnly.within.has(rowKey(row));
      const rows = held.map((group) => ({ ...group, rows: group.rows.filter(changed) }));
      return inspectorGroups(rows, NO_DEFAULTS);
    }
    if (data == null || definedOnly) {
      return inspectorGroups(held, NO_DEFAULTS);
    }

    const authored = new Set(held.flatMap((each) => each.rows).map((row) => fieldHash(row.path)));
    if (forces.visible) {
      authored.add(FORCE_COLLECTION);
      authored.add(CHILD_SET);
    }

    return inspectorGroups(held, unauthoredFields(data.fields, authored));
  }, [target, card, data, forces.visible, definedOnly, changedOnly]);
  const filtered = filterEmitterGroups(groups, search);
  const jumpTo = useAddedJump(groups);
  const holder = addable && target !== "system" ? card?.row : undefined;
  const readOnly = useReadOnlyReason();
  useShownPaneCommands(VFX_PANE.inspector, {
    [VFX_COMMAND.addProperty]: {
      run: holder === undefined ? null : () => setAdding(true),
      reason: readOnly ?? m.workshop_bin_menu_vfx_emitter_reason(),
    },
  });
  const hasMatches =
    filtered.some((group) => group.rows.length > 0 || group.defaults.length > 0) ||
    (forces.visible && forces.forces.some((force) => forceMatches(force, search))) ||
    (children.visible && children.set !== null && childrenMatch(children.set, search));
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
  useRowReveal(scroller, revealed, () =>
    aimed === null ? null : roots.current.get(aimed)?.firstElementChild,
  );

  return (
    <div data-ui="EmitterPanel" className={twMerge("flex min-h-0 flex-col", className)}>
      {child !== null && <ChildBanner child={child} />}
      <PanelHeader actions={actions} />
      {preview && running && child === null && target !== "system" && card !== undefined && (
        <EmitterPreviewBox
          simple={card.simple}
          listIndex={card.index}
          className="mx-auto mt-1.5 w-full max-w-72 shrink-0"
        />
      )}
      <div
        data-ui="EmitterFields:search"
        className="flex shrink-0 items-center gap-2 border-b border-surface-700/40 px-2 py-1.5"
      >
        <InspectorActions
          adding={holder === undefined ? null : adding}
          onAddingChange={setAdding}
        />
        {adding && holder !== undefined && (
          <AddPropertyBox holder={holder} onAdded={jumpTo} onClose={() => setAdding(false)} />
        )}
        {(!adding || holder === undefined) && (
          <SearchField
            value={search}
            onChange={setSearch}
            inputRef={searchRef}
            label={m.workshop_bin_inspector_search_label()}
            clearLabel={m.workshop_bin_inspector_clear_action()}
            onCommit={() =>
              scroller.current
                ?.querySelector<HTMLElement>("button:not(:disabled), input:not(:disabled)")
                ?.focus()
            }
          />
        )}
      </div>
      {/* DS-SCROLLBAR. The left padding is the roll rail's gutter, outside every row. */}
      <div
        ref={scroller}
        data-ui="EmitterPanel:body"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto py-0.5 pr-1.5 pl-3.5 scrollbar-md"
        style={COLUMN_STYLE}
      >
        <ChildChecks>
          <CurveChainContext value={card === undefined ? "" : emitterChain(card)}>
            <FieldLabelsContext value={emitterLabel}>
              <RowFoldContext value={fold}>
                {filtered.map((each) => (
                  <GroupSection
                    key={each.group}
                    held={each}
                    defaultExpanded={each.rows.some(
                      (row) => !rowHasDefault(row, data?.fields, forces.emitterNode),
                    )}
                    owner={owner}
                    scroller={scroller}
                    register={register}
                    searching={search.trim() !== ""}
                  />
                ))}
                <ForcesSection search={search} />
                <ChildrenSection search={search} />
                {search.trim() !== "" && !hasMatches && (
                  <p role="status" className="px-2 py-4 text-meta text-surface-400">
                    {m.workshop_bin_inspector_matches_empty()}
                  </p>
                )}
                {search.trim() === "" &&
                  changedOnly !== null &&
                  card !== undefined &&
                  target !== "system" &&
                  !hasMatches && (
                    <p role="status" className="px-2 py-4 text-meta text-surface-400">
                      {m.workshop_bin_inspector_changed_empty()}
                    </p>
                  )}
                {search.trim() === "" &&
                  changedOnly === null &&
                  definedOnly &&
                  card !== undefined &&
                  target !== "system" &&
                  !hasMatches && (
                    <p role="status" className="px-2 py-4 text-meta text-surface-400">
                      {m.workshop_bin_inspector_defined_empty()}
                    </p>
                  )}
              </RowFoldContext>
            </FieldLabelsContext>
          </CurveChainContext>
        </ChildChecks>
      </div>
    </div>
  );
}

/** How long after an ask a row that appears is still scrolled to, in milliseconds. */
const REVEAL_WINDOW = 1500;

/** How long a revealed row keeps its accent wash, in milliseconds. */
const REVEAL_FLASH = 1500;

/**
 * Scroll `scroller` to the first row of `revealed` that it draws, by the `data-row-key` or
 * `data-reveal-key` of the row, and flash it. A reveal of no row flashes `groupHeader`.
 *
 * The rows of an emitter that was just opened land after their read, so the search runs on
 * each render until a row is found or `REVEAL_WINDOW` has passed.
 */
function useRowReveal(
  scroller: RefObject<HTMLElement | null>,
  revealed: RowReveal | null,
  groupHeader: () => Element | null | undefined,
) {
  const answered = useRef(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const root = scroller.current;
    if (revealed === null || root === null || revealed.request === answered.current) return;
    if (performance.now() - revealed.at > REVEAL_WINDOW) return;

    const grouped = revealed.keys.length === 0;
    const row = grouped ? groupHeader() : revealedRow(root, revealed.keys);
    if (row === null || row === undefined) return;

    answered.current = revealed.request;
    /* A group is already at the top of the scroller, by the aim. */
    if (!grouped) row.scrollIntoView?.({ block: "center" });
    flash(row, reducedMotion);
  });
}

function revealedRow(root: HTMLElement, keys: readonly string[]): Element | null {
  for (const key of keys) {
    const escaped = CSS.escape(key);
    const row = root.querySelector(`[data-row-key="${escaped}"], [data-reveal-key="${escaped}"]`);
    if (row !== null) return row;
  }

  return null;
}

/** Wash `target` in the accent, then fade the wash out. With `still`, the wash ends unfaded. */
function flash(target: Element, still: boolean) {
  /* DS-TOKEN */
  const accent = getComputedStyle(target).getPropertyValue("--accent-500");
  const wash = `color-mix(in srgb, ${accent} 30%, transparent)`;

  target.animate?.(
    [
      { backgroundColor: wash, offset: 0 },
      { backgroundColor: wash, offset: 0.4 },
    ],
    { duration: REVEAL_FLASH, easing: still ? "steps(1, end)" : "linear" },
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

const OWN_SECTION: ReadonlySet<string> = new Set([FORCE_COLLECTION, CHILD_SET]);
const NO_DEFAULTS: readonly DefaultField[] = [];
const NO_GROUPED: readonly GroupedRows[] = [];

/** The child system a lane's emitter belongs to, and the way to that system's own tab. */
function ChildBanner({ child }: { child: ChildChoice }) {
  const { wantOpen } = useLinkOpen();
  const { entry } = child.system;

  return (
    <div className="shrink-0 px-1.5 pt-1.5 font-sans">
      <AlertBox
        tone="neutral"
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
            size="sm"
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
  defaultExpanded: boolean;
  searching: boolean;
  owner: string | null;
  scroller: RefObject<HTMLDivElement | null>;
  register: (group: EmitterGroup, element: HTMLElement | null) => void;
}

/** One group as a section that folds, reading its curves while it is on screen. */
function GroupSection({
  held,
  defaultExpanded,
  owner,
  scroller,
  register,
  searching,
}: GroupSectionProps) {
  const { report, card, open: aimed, jumpRequest } = useEmitters();
  const { data: schema } = useClassSchema(owner);
  const run = use(VfxRunContext);
  const running = (run?.system ?? null) !== null;
  const valueItems = useValueItems();
  const [fold, setFold] = useState<boolean | null>(null);
  const [navigation, setNavigation] = useState({ key: card?.key, request: jumpRequest });
  const root = useRef<HTMLElement | null>(null);
  const { group } = held;
  const title = GROUP_TITLE[group]();
  const properties = inspectorProperties(held);
  const visible = properties.length > 0;
  const hasPeriod = properties.some((property) => property.hash === TIMING.period);
  const requested =
    navigation.key === card?.key && navigation.request !== jumpRequest && aimed?.group === group;
  if (navigation.key !== card?.key || navigation.request !== jumpRequest) {
    setNavigation({ key: card?.key, request: jumpRequest });
    if (requested) {
      setFold(true);
    }
  }

  const expanded = requested || (fold ?? defaultExpanded);
  const open = visible && (searching || expanded);

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
  const rails = properties.map((property) => {
    if ("field" in property) {
      return null;
    }

    return railMark(property.row, marks.get(rowKey(property.row)));
  });

  if (!visible) {
    return null;
  }

  return (
    <section
      data-ui="EmitterPanel:group"
      ref={(element) => {
        root.current = element;
        register(group, element);
      }}
      className="flex scroll-mt-1 flex-col border-t border-surface-700/40 first:border-t-0"
    >
      <button
        type="button"
        aria-expanded={open}
        disabled={searching}
        /* DS-GROUND: opaque, since the rows scroll under it rather than past it. */
        className={twMerge(
          OVERLINE,
          "sticky top-0 z-10 -ml-2 flex min-h-6 cursor-pointer items-center gap-1 bg-surface-900 pr-1 pl-3 text-left font-sans hover:text-surface-200",
        )}
        onClick={() => setFold(!expanded)}
      >
        <CaretRightIcon weight="bold" className={twMerge("size-3", open && "rotate-90")} />
        {title}
      </button>
      {open && !searching && group === "emission" && <RateReadout />}
      {open && !searching && (group === "emission" || group === "source") && (
        <EmissionNotes group={group} />
      )}
      {open && !searching && group === "stencil" && <StencilNotes />}
      {open && !searching && group === "texture" && <FlipbookView />}
      {open &&
        properties.map((property, at) => {
          const key = `${card?.key ?? owner}:${property.hash}`;
          if (property.hash === TIMING.period && card !== undefined) {
            return (
              <PeriodProperty
                key={key}
                period={property}
                active={properties.find((each) => each.hash === TIMING.timeActiveDuringPeriod)}
                emitter={card.row}
                owner={owner}
                fields={schema?.fields}
                width={NAME_COLUMN}
              />
            );
          }

          /* Drawn under Repeats, beside its period. */
          if (property.hash === TIMING.timeActiveDuringPeriod && card !== undefined && hasPeriod) {
            return null;
          }

          if (property.hash === PRIMITIVE_FIELD && card !== undefined) {
            return (
              <PrimitiveProperty
                key={key}
                field={schemaField(property, schema?.fields)}
                holder={card.row}
                authored={"row" in property ? property.row : undefined}
                width={NAME_COLUMN}
                owner={owner}
              />
            );
          }

          if (property.hash === SURFACE_FIELD && card !== undefined) {
            return (
              <SurfaceProperty
                key={key}
                field={schemaField(property, schema?.fields)}
                holder={card.row}
                authored={"row" in property ? property.row : undefined}
                width={NAME_COLUMN}
                owner={owner}
              />
            );
          }

          if (property.hash === SHAPE_FIELD && card !== undefined) {
            return (
              <ShapeProperty
                key={key}
                field={schemaField(property, schema?.fields)}
                holder={card.row}
                authored={"row" in property ? property.row : undefined}
                width={NAME_COLUMN}
                owner={owner}
              />
            );
          }

          if (property.hash === STENCIL_FIELD.mode && card !== undefined) {
            return (
              <StencilModeProperty
                key={key}
                field={schemaField(property, schema?.fields)}
                emitterRow={card.row}
                authored={"row" in property ? property.row : undefined}
                width={NAME_COLUMN}
                owner={owner}
              />
            );
          }

          if (property.hash === STENCIL_FIELD.ref && card !== undefined && running) {
            return (
              <StencilMaskProperty
                key={key}
                field={schemaField(property, schema?.fields)}
                emitterRow={card.row}
                authored={"row" in property ? property.row : undefined}
                width={NAME_COLUMN}
                owner={owner}
              />
            );
          }

          if ("field" in property) {
            if (card === undefined) {
              return null;
            }

            return (
              <DefaultProperty
                key={key}
                field={property.field}
                holder={card.row}
                width={NAME_COLUMN}
                owner={owner}
              />
            );
          }

          const { row } = property;
          const rail = (
            <RollRail
              mark={rails[at] ?? null}
              joins={rails[at] !== null && rails[at + 1] === rails[at]}
            />
          );
          const definition = schema?.fields.find((field) => field.hash === property.hash);
          if (
            row.value.type === "optional" &&
            row.value.itemKind === "f32" &&
            definition?.declared?.kind === "option" &&
            definition.declared.value === "f32" &&
            !row.declared?.mismatch &&
            card !== undefined
          ) {
            return (
              <DefaultProperty
                key={key}
                field={{ ...definition, name: definition.name ?? row.name }}
                holder={card.row}
                authored={row}
                rail={rail}
                width={NAME_COLUMN}
                owner={owner}
              />
            );
          }

          /* A child system's rows are another object's, which the run's graph does not hold. */
          const item = row.entry === run?.entry ? valueItems.get(row.path) : undefined;
          if (item !== undefined) {
            return (
              <div key={key} className={EMBED_TONE} style={hueStyle(item)}>
                <ValueRow
                  item={item}
                  row={row}
                  label={emitterLabel(fieldHash(row.path), row.name) ?? row.name}
                  owner={owner}
                  width={NAME_COLUMN}
                  rail={rail}
                />
              </div>
            );
          }

          return (
            <FieldRow
              key={key}
              row={row}
              label={emitterLabel(fieldHash(row.path), row.name)}
              tableLayout
              width={NAME_COLUMN}
              owner={owner}
              rail={rail}
            />
          );
        })}
    </section>
  );
}

/** The schema's reading of a property, and its bare name where the schema has none. */
function schemaField(
  property: InspectorProperty,
  fields: readonly FieldSchema[] | undefined,
): DefaultField {
  if ("field" in property) {
    return property.field;
  }

  const declared = fields?.find((field) => field.hash === property.hash);
  if (declared !== undefined) {
    return defaultField(declared);
  }

  return { hash: property.hash, name: property.row.name, declared: null };
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

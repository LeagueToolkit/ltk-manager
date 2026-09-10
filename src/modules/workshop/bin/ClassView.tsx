import { CaretRightIcon } from "@phosphor-icons/react";
import {
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import { ContextMenu } from "@/components";
import { useResizeObserver } from "@/hooks";
import { m } from "@/i18n";
import type { AssetRef, BinDocumentId, BinRow } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { BinContextMenu } from "./BinContextMenu";
import { nameHash } from "./binHash";
import { rowKey, type RowLine } from "./binRows";
import {
  elementsOf,
  FieldRow,
  fieldsIn,
  type LayoutPages,
  None,
  SectionTree,
  type ViewContext,
  type WidgetProps,
} from "./ClassCells";
import {
  type ClassLayout,
  frameOf,
  type LayoutFrame,
  levelRequests,
  type PlacedSection,
  placeRows,
  readsOwnMarks,
  type SectionWidget,
} from "./classLayouts";
import { CurveSurface } from "./CurveSurface";
import { PanesMenu, type ShellPaneContent, ShellPaneTree } from "./ShellPaneTree";
import { EffectTable, IconRow, MeshCard, OverrideRows } from "./SkinSections";
import { useBinRead } from "./useBinRead";
import {
  LinkAssetContext,
  LinkOpenContext,
  LinkTargetsContext,
  type RowGroup,
  useCheckLinkTargets,
  useWarmLinkOpen,
} from "./useLinkTargets";
import { useValueMarks, ValueMarksContext } from "./useValueMarks";
import {
  EmitterChoiceContext,
  EmitterFields,
  EmitterModes,
  Emitters,
  INSPECTOR_NAME,
  ShellCrumb,
  useEmitterChoice,
  useEmitters,
} from "./VfxSections";

/**
 * The width a strip and an inspector both need, under which a shell falls to the stack.
 *
 * "The shell" in docs/ux/BIN_EDITOR.md. The object pane is about 1150px with both
 * sidebars open, so the fallback is for a narrow window rather than for the usual one.
 */
const SHELL_WIDTH = 900;

const NO_PAGES: LayoutPages = new Map();

interface ClassViewProps {
  /** The open's id, which every read carries. */
  document: BinDocumentId;
  /** What the document was read from, which the layer side of a `file` link looks in. */
  asset: AssetRef;
  /** The object's properties at depth zero, which the open already answered. */
  roots: readonly BinRow[];
  /** The class the roots are properties of, which the layout was keyed on. */
  classHash: string;
  layout: ClassLayout;
  /** The name of the object an entry hash addresses, for the path a cell copies. */
  objectName: (entry: string) => string;
  /** The backend holds no document with this id. The caller reopens it. */
  onNotOpen: () => void;
  /** Switch the tab to Properties and reveal the cell's row there. */
  onShowInProperties: (key: string) => void;
  /** The frame it settled on, which a host drawing a curve of its own has to know. */
  onFrame?: (frame: LayoutFrame) => void;
}

/**
 * One object drawn as its class's layout, beside the tree. "Class views" in
 * docs/ux/BIN_EDITOR.md.
 *
 * Every cell is a path and a value, the pair a row carries, so the layout holds no
 * state of its own and its menu is the row's.
 */
export function ClassView({
  document,
  asset,
  roots,
  classHash,
  layout,
  objectName,
  onNotOpen,
  onShowInProperties,
  onFrame,
}: ClassViewProps) {
  const placed = useMemo(() => placeRows(roots, layout), [roots, layout]);
  const pages = useLayoutRead(document, placed);

  const [wide, setWide] = useState(false);
  const measure = useResizeObserver<HTMLDivElement>((element) =>
    setWide(element.offsetWidth >= SHELL_WIDTH),
  );
  const frame: LayoutFrame = frameOf(layout) === "shell" && wide ? "shell" : "stack";
  useEffect(() => onFrame?.(frame), [onFrame, frame]);

  const view = useMemo<ViewContext>(
    () => ({ document, asset, classHash, objectName, onNotOpen, frame }),
    [document, asset, classHash, objectName, onNotOpen, frame],
  );

  /* The roots and everything the read answered, each checked as one group. A tree
     section runs its own checks, because it is a tree. */
  const groups = useMemo<RowGroup[]>(
    () => [
      { key: "", rows: roots },
      ...[...pages].map(([key, page]) => ({ key, rows: page.rows })),
    ],
    [roots, pages],
  );
  const linkTargets = useCheckLinkTargets(document, groups);
  const linkOpen = useWarmLinkOpen(linkTargets);

  /* The strip is held here rather than in its own section, because a shell draws its two
     halves in two columns and a fall back to the stack must not lose the reader's place. */
  const emitters = useEmitterChoice(placed, pages, frame);
  const held = useMemo(() => cellRows(placed, pages), [placed, pages]);
  const viewMarks = useValueMarks(document, held.marks);
  const emitterMarks = useValueMarks(document, emitters.marked, emitters.read);
  const marks = useMemo(() => new Map([...viewMarks, ...emitterMarks]), [viewMarks, emitterMarks]);

  const system = useMemo(() => crumbName(objectName(roots[0]?.entry ?? "")), [objectName, roots]);
  const [menuLine, setMenuLine] = useState<RowLine | null>(null);
  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-row-key]");
    const row = cell?.dataset.rowKey === undefined ? undefined : held.menu.get(cell.dataset.rowKey);
    setMenuLine(row === undefined ? null : cellLine(row, classHash));
  }

  return (
    <LinkAssetContext value={asset}>
      <LinkTargetsContext value={linkTargets}>
        <LinkOpenContext value={linkOpen}>
          <ValueMarksContext value={marks}>
            <EmitterChoiceContext value={emitters}>
              <ContextMenu.Root>
                <ContextMenu.Trigger
                  ref={measure}
                  data-ui="ClassView"
                  className="flex min-h-0 flex-1 flex-col select-none"
                  onContextMenu={handleContextMenu}
                >
                  {frame === "stack" && <Stack placed={placed} pages={pages} view={view} />}
                  {frame === "shell" && (
                    <Shell placed={placed} pages={pages} view={view} system={system} />
                  )}
                </ContextMenu.Trigger>

                <BinContextMenu
                  line={menuLine}
                  objectName={objectName}
                  onShowInProperties={onShowInProperties}
                />
              </ContextMenu.Root>
            </EmitterChoiceContext>
          </ValueMarksContext>
        </LinkOpenContext>
      </LinkTargetsContext>
    </LinkAssetContext>
  );
}

interface FrameProps {
  placed: readonly PlacedSection[];
  pages: LayoutPages;
  view: ViewContext;
}

interface ShellProps extends FrameProps {
  /** What the crumb's first segment carries, which is the object without its path. */
  system: string;
}

/** Every section down one scrolling column, which is the frame a layout draws in by default. */
function Stack({ placed, pages, view }: FrameProps) {
  return (
    <div
      data-ui="ClassView:stack"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 scrollbar-md"
    >
      <Sections placed={placed} pages={pages} view={view} />
    </div>
  );
}

/**
 * The panes under a breadcrumb, which is the frame a tuned class draws in (ADR-0031).
 *
 * Where each pane sits and how much room it takes is the project's own tree, so this
 * builds the four of them and hands them over without arranging any of it (ADR-0034).
 */
function Shell({ placed, pages, view, system }: ShellProps) {
  const emitters = useMemo(() => placed.find((each) => each.widget === "emitters"), [placed]);
  const others = useMemo(() => placed.filter((each) => each.widget !== "emitters"), [placed]);

  const content = useMemo<ShellPaneContent>(
    () => ({
      emitters: {
        body: <EmittersPane section={emitters} pages={pages} view={view} />,
        actions: <EmitterModes />,
      },
      curve: {
        body: (
          <div className="flex min-h-0 flex-1 flex-col p-1.5">
            <CurveSurface document={view.document} named={false} />
          </div>
        ),
      },
      inspector: { body: <InspectorPane placed={others} pages={pages} view={view} /> },
      preview: { body: <PreviewPane /> },
    }),
    [emitters, others, pages, view],
  );

  return (
    <div data-ui="ClassView:shell" className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <ShellCrumb system={system} />
        <PanesMenu className="ml-auto" />
      </div>
      <ShellPaneTree content={content} />
    </div>
  );
}

/** Every emitter of the system, in whichever reading the strip's own control picked. */
function EmittersPane({
  section,
  pages,
  view,
}: { section: PlacedSection | undefined } & Omit<FrameProps, "placed">) {
  if (section === undefined) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col p-1.5 font-mono text-mono-row">
      <Emitters section={section} pages={pages} view={view} />
    </div>
  );
}

/** Whatever the crumb is aimed at: the system's own sections, or one emitter's fields. */
function InspectorPane({ placed, pages, view }: FrameProps) {
  const { target } = useEmitters();

  if (target !== "system") {
    return (
      <EmitterFields
        className="min-h-0 flex-1 font-mono text-mono-row"
        nameWidth={INSPECTOR_NAME}
      />
    );
  }

  return (
    /* DS-SCROLLBAR */
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 scrollbar-md">
      <Sections placed={placed} pages={pages} view={view} />
    </div>
  );
}

/** The room a particle renderer will take, which is the slot a skin holds for its mesh. */
function PreviewPane() {
  return (
    <span
      data-ui="ClassView:preview"
      role="img"
      aria-label={m.workshop_bin_preview_pane_label()}
      className="flex min-h-0 flex-1 items-center justify-center px-2 text-center text-meta text-surface-400"
    >
      {m.workshop_bin_preview_pane_empty()}
    </span>
  );
}

/** The object's own name, which is the last segment of the path a declaration is keyed on. */
function crumbName(name: string): string {
  return name.split("/").pop() ?? name;
}

/** Every placed section, in the order the layout named them. */
function Sections({ placed, pages, view }: FrameProps) {
  return placed.map((section, at) => (
    <Section key={at} section={section} pages={pages} view={view} />
  ));
}

/**
 * The levels a layout's widgets read, through the projected read.
 *
 * "What a layout reads" in docs/ux/BIN_EDITOR.md. The depth-zero rows arrive with the
 * open, so a material costs the containers and then their elements, two calls. A level
 * asks out of what the levels above it answered, and a tree section reads nothing until
 * a reader expands it.
 */
function useLayoutRead(document: BinDocumentId, placed: readonly PlacedSection[]): LayoutPages {
  const first = useBinRead(
    document,
    useMemo(() => levelRequests(placed, NO_PAGES, 0), [placed]),
  );
  const second = useBinRead(
    document,
    useMemo(() => levelRequests(placed, first, 1), [placed, first]),
  );
  const above = useMemo(() => joined(first, second), [first, second]);
  const third = useBinRead(
    document,
    useMemo(() => levelRequests(placed, above, 2), [placed, above]),
  );
  return useMemo(() => joined(above, third), [above, third]);
}

/** Two levels' answers as one map, which is how a level reads what the ones above it got. */
function joined(above: LayoutPages, level: LayoutPages): LayoutPages {
  if (level.size === 0) return above;
  return new Map([...above, ...level]);
}

interface SectionProps {
  section: PlacedSection;
  pages: LayoutPages;
  view: ViewContext;
}

/** One section: its header, and the fields it placed. */
function Section({ section, pages, view }: SectionProps) {
  const [open, setOpen] = useState(true);
  const title = section.title();

  return (
    <section data-ui="ClassView:section" className="flex flex-col gap-1">
      <button
        type="button"
        className="flex cursor-pointer items-center gap-1 text-left text-surface-400 hover:text-surface-200"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        <CaretRightIcon weight="bold" className={twMerge("h-3 w-3", open && "rotate-90")} />
        <span className="text-xs font-medium tracking-wide uppercase">{title}</span>
      </button>
      {open && section.rows.length === 0 && (
        <span className="pl-3 text-meta text-surface-400">
          {m.workshop_bin_section_none_empty()}
        </span>
      )}
      {open && section.rows.length > 0 && (
        <div className="pl-3 font-mono text-mono-row">
          <SectionBody section={section} pages={pages} view={view} title={title} />
        </div>
      )}
    </section>
  );
}

/** What each widget draws for the section that names it. */
const WIDGETS: Record<Exclude<SectionWidget, "tree">, (props: WidgetProps) => ReactNode> = {
  rows: ElementRows,
  fields: NamedFields,
  icons: IconRow,
  mesh: MeshCard,
  "override-rows": OverrideRows,
  "effect-table": EffectTable,
  emitters: Emitters,
};

function SectionBody({ section, pages, view, title }: SectionProps & { title: string }) {
  if (section.widget === "tree") {
    return (
      <SectionTree
        view={view}
        roots={section.rows}
        rootOwner={view.classHash}
        label={title}
        initialExpanded={section.other ? undefined : section.rows.map(rowKey)}
      />
    );
  }

  if (section.widget === undefined) {
    return (
      <div className="flex flex-col">
        {section.rows.map((row) => (
          <FieldRow key={rowKey(row)} row={row} />
        ))}
      </div>
    );
  }

  const Widget = WIDGETS[section.widget];
  return <Widget section={section} pages={pages} view={view} />;
}

/** The fields the section names under the one row it placed, each on a line of its own. */
function NamedFields({ section, pages }: WidgetProps) {
  const byField = fieldsIn(elementsOf(section.rows, pages));
  const drawn = section.under
    .map((name) => byField(nameHash(name)))
    .filter((row): row is BinRow => row !== undefined);

  if (drawn.length === 0) return <None />;
  return (
    <div className="flex flex-col">
      {drawn.map((row) => (
        <FieldRow key={rowKey(row)} row={row} />
      ))}
    </div>
  );
}

/** One row per element of the containers the section placed, as the tree draws them. */
function ElementRows({ section, pages, view }: WidgetProps) {
  return (
    <SectionTree
      view={view}
      roots={elementsOf(section.rows, pages)}
      rootOwner={null}
      label={section.title()}
    />
  );
}

/** What the view holds a row for: the menu it aims, and the marks it reads. */
interface ViewRows {
  /** Every row a cell was drawn for, by key, which is what the menu is aimed at. */
  readonly menu: ReadonlyMap<string, BinRow>;
  /** The rows the view reads a value mark for, which a widget of its own is left out of. */
  readonly marks: readonly BinRow[];
}

/** Every row the layout drew a cell for, and which of them the view marks itself. */
function cellRows(placed: readonly PlacedSection[], pages: LayoutPages): ViewRows {
  const menu = new Map<string, BinRow>();
  const marks: BinRow[] = [];

  for (const section of placed) {
    if (section.widget === "tree") continue;
    const own = readsOwnMarks(section.widget);
    for (const row of walk(section.rows, pages)) {
      menu.set(rowKey(row), row);
      if (!own) marks.push(row);
    }
  }
  return { menu, marks };
}

/** `rows` and everything the read answered under them, however deep it went. */
function walk(rows: readonly BinRow[], pages: LayoutPages): BinRow[] {
  const out: BinRow[] = [];
  for (const row of rows) {
    out.push(row);
    const page = pages.get(rowKey(row));
    if (page) out.push(...walk(page.rows, pages));
  }
  return out;
}

/** A cell as the row menu reads one. Its depth and its expansion are the tree's, not a cell's. */
function cellLine(row: BinRow, classHash: string): RowLine {
  return {
    kind: "row",
    key: rowKey(row),
    row,
    depth: 0,
    expanded: false,
    loading: false,
    owner: row.node === "property" ? classHash : null,
  };
}

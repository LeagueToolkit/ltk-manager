import { type ReactNode, useMemo } from "react";

import type { BinDocumentId } from "@/lib/tauri";
import { leafHolding } from "@/modules/editor";

import { useShellLayout, useShellMaximizedLeaf } from "../state";
import type { LayoutPages, ViewContext } from "./ClassCells";
import type { PlacedSection } from "./classLayouts";
import { Sections } from "./ClassSections";
import { CurveSurface } from "./CurveSurface";
import { useEmitters } from "./emitterChoice";
import { EmitterFields, InspectorDefaults } from "./EmitterInspector";
import { ShellCrumb } from "./ShellCrumb";
import { ShellHeaderPortal, useShellHeaderHeld } from "./shellHeader";
import type { ShellKind, ShellPaneId } from "./shellPanes";
import { PanesMenu, type ShellPaneContent, ShellPaneTree } from "./ShellPaneTree";
import { SkinPreview } from "./skin/SkinPreview";
import { PreviewPane, RunKeys, TimelinePane, VfxRunProvider } from "./vfx";
import { EmitterModes, Emitters } from "./VfxSections";

export interface FrameProps {
  placed: readonly PlacedSection[];
  pages: LayoutPages;
  view: ViewContext;
}

interface ShellProps extends FrameProps {
  /** What the crumb's first segment carries, which is the object without its path. */
  system: string;
  /** The object's class is one the renderer draws. */
  drawable: boolean;
}

/** The run above whichever frame draws it, and no run at all over a class no renderer draws. */
export function RunHost({
  drawable,
  document,
  entry,
  children,
}: {
  drawable: boolean;
  document: BinDocumentId;
  entry: string;
  children: ReactNode;
}) {
  if (!drawable) return children;
  return (
    <VfxRunProvider document={document} entry={entry}>
      <RunKeys>{children}</RunKeys>
    </VfxRunProvider>
  );
}

/**
 * Every section down one scrolling column, which is the frame a layout draws in by default.
 *
 * `hero` stands above the sections, which is where a shell's preview goes when the pane is
 * too narrow for the shell.
 */
export function Stack({ placed, pages, view, hero }: FrameProps & { hero?: ReactNode }) {
  return (
    <div
      data-ui="ClassView:stack"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 scrollbar-md"
    >
      {hero}
      <Sections placed={placed} pages={pages} view={view} />
    </div>
  );
}

/** The box above the stack's sections that a shell pane would give a preview. */
function Hero({ children }: { children: ReactNode }) {
  return (
    <div
      data-ui="ClassView:hero"
      /* DS-GROUND */
      className="flex h-[min(60vh,32rem)] shrink-0 flex-col overflow-hidden rounded-md border border-surface-700/50 bg-surface-900"
    >
      {children}
    </div>
  );
}

/** The skin drawn above the stack's sections. */
export function SkinHero({ view, entry }: { view: ViewContext; entry: string | null }) {
  return (
    <Hero>
      <SkinPreview document={view.document} asset={view.asset} entry={entry} />
    </Hero>
  );
}

/** The run drawn above the stack's sections, over the mini transport a stack gives it. */
export function VfxHero({ drawable }: { drawable: boolean }) {
  return (
    <Hero>
      <PreviewPane drawable={drawable} transport="mini" />
    </Hero>
  );
}

interface SkinShellProps extends FrameProps {
  /** The skin object, which the preview reads its model from. */
  entry: string | null;
}

/** The skin's panes: the character, and its sections beside it (ADR-0036). */
export function SkinShell({ placed, pages, view, entry }: SkinShellProps) {
  const content = useMemo<ShellPaneContent<"skin">>(
    () => ({
      preview: {
        body: <SkinPreview document={view.document} asset={view.asset} entry={entry} />,
      },
      inspector: {
        body: <SectionColumn placed={placed} pages={pages} view={view} />,
      },
    }),
    [placed, pages, view, entry],
  );

  return (
    <div data-ui="ClassView:shell" className="flex min-h-0 flex-1 flex-col gap-2">
      <ShellHeader kind="skin" />
      <ShellPaneTree kind="skin" content={content} />
    </div>
  );
}

/**
 * The crumb and the Panes menu, in the tab's header row where it offers the slots, and on
 * a row of the shell's own where it does not.
 *
 * "One row holds the object tab's header and the crumb", "The shell" in
 * docs/ux/BIN_EDITOR.md.
 */
function ShellHeader({ kind, crumb }: { kind: ShellKind; crumb?: ReactNode }) {
  const held = useShellHeaderHeld();

  if (held) {
    return (
      <>
        <ShellHeaderPortal slot="crumb">{crumb}</ShellHeaderPortal>
        <ShellHeaderPortal slot="panes">
          <PanesMenu kind={kind} />
        </ShellHeaderPortal>
      </>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {crumb}
      <PanesMenu kind={kind} className="ml-auto" />
    </div>
  );
}

/**
 * The panes under a breadcrumb, which is the frame a tuned class draws in (ADR-0031).
 *
 * Where each pane sits and how much room it takes is the project's own tree, so this
 * builds the five of them and hands them over without arranging any of it (ADR-0034).
 */
export function VfxShell({ placed, pages, view, system, drawable }: ShellProps) {
  const emitters = useMemo(() => placed.find((each) => each.widget === "emitters"), [placed]);
  const others = useMemo(() => placed.filter((each) => each.widget !== "emitters"), [placed]);
  const timelineShown = useShellPaneShown("timeline");

  const content = useMemo<ShellPaneContent<"vfx">>(
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
      inspector: {
        body: <InspectorPane placed={others} pages={pages} view={view} />,
        actions: <InspectorDefaults />,
      },
      preview: {
        body: <PreviewPane drawable={drawable} transport={timelineShown ? "none" : "mini"} />,
      },
      timeline: { body: <TimelinePane drawable={drawable} /> },
    }),
    [emitters, others, pages, view, drawable, timelineShown],
  );

  return (
    <div data-ui="ClassView:shell" className="flex min-h-0 flex-1 flex-col gap-2">
      <ShellHeader kind="vfx" crumb={<ShellCrumb system={system} />} />
      <ShellPaneTree kind="vfx" content={content} />
    </div>
  );
}

/**
 * The particle shell draws `pane` where a reader sees it: the front tab of its panel, and
 * that panel not behind a maximized one.
 *
 * What the preview's mini transport is keyed on, per "The timeline" in docs/ux/BIN_EDITOR.md.
 */
function useShellPaneShown(pane: ShellPaneId): boolean {
  const tree = useShellLayout("vfx");
  const maximized = useShellMaximizedLeaf("vfx");
  const leaf = leafHolding(tree, pane);
  if (leaf === null || leaf.activeTab !== pane) return false;
  return maximized === null || maximized === leaf.id;
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
    return <EmitterFields className="min-h-0 flex-1 font-mono text-mono-row" />;
  }

  return <SectionColumn placed={placed} pages={pages} view={view} />;
}

/** Every placed section down a pane of its own, which scrolls apart from the panes beside it. */
function SectionColumn({ placed, pages, view }: FrameProps) {
  return (
    /* DS-SCROLLBAR */
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 scrollbar-md">
      <Sections placed={placed} pages={pages} view={view} />
    </div>
  );
}

/** The object's own name, which is the last segment of the path a declaration is keyed on. */
export function crumbName(name: string): string {
  return name.split("/").pop() ?? name;
}

import { type ReactNode, lazy, Suspense, useMemo, useState } from "react";

import { RetainedContent } from "@/components";
import type { BinDocumentId } from "@/lib/tauri";
import { leafHolding } from "@/modules/editor";

import { useShellLayout, useShellMaximizedLeaf } from "../../../state";
import { ChanceReadout } from "../../curves/components/ChancePin";
import { CurveSurface } from "../../curves/components/CurveSurface";
import { MapOutliner } from "../../map/components/MapOutliner";
import { MapPreview } from "../../map/components/MapPreview";
import { MaterialPane } from "../../material/components/MaterialPane";
import { MaterialPreview } from "../../material/components/MaterialPreview";
import { ShellCrumb } from "../../shell/components/ShellCrumb";
import {
  PanesMenu,
  type ShellPaneContent,
  ShellPaneTree,
} from "../../shell/components/ShellPaneTree";
import { ShellHeaderPortal, useShellHeaderHeld } from "../../shell/state/shellHeader";
import type { ShellKind, ShellPaneId } from "../../shell/utils/shellPanes";
import { ClipsHost } from "../../skin/components/ClipsSection";
import { ClipTabs } from "../../skin/components/ClipTable";
import { SkinPreview } from "../../skin/components/SkinPreview";
import { SpellsPane } from "../../spells/components/SpellsPane";
import type { AbilityRecipe } from "../../spells/utils/abilityRecipe";
import { PreviewPane, RunKeys, TimelinePane, VfxRunProvider } from "../../vfx";
import { EmitterFields } from "../../vfx/inspector/components/EmitterInspector";
import { EmitterModes, Emitters } from "../../vfx/inspector/components/VfxSections";
import { useEmitters } from "../../vfx/inspector/state/emitterChoice";
import type { PlacedSection } from "../utils/classLayouts";
import type { LayoutPages, ViewContext } from "./ClassCells";
import { Sections } from "./ClassSections";

const AbilityPreview = lazy(() => import("../../spells/components/AbilityPreview"));

export interface FrameProps {
  placed: readonly PlacedSection[];
  pages: LayoutPages;
  view: ViewContext;
}

interface ShellFrameProps extends FrameProps {
  /** Where the preview pane shows the view's one preview. */
  preview: ReactNode;
}

interface ShellProps extends ShellFrameProps {
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
export function Hero({ children }: { children: ReactNode }) {
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

interface FramePreviewProps {
  kind: ShellKind;
  view: ViewContext;
  /** The object the skin, map or material preview draws. */
  entry: string | null;
  /** The object's class is one the renderer draws. */
  drawable: boolean;
}

/**
 * What a shell's preview pane or the stack's hero draws, rendered once whichever frame
 * shows it.
 */
export function FramePreview({ kind, view, entry, drawable }: FramePreviewProps) {
  if (kind === "map") return <MapPreview document={view.document} />;
  if (kind === "material") {
    return (
      <MaterialPreview
        document={view.document}
        asset={view.asset}
        entry={entry}
        onNotOpen={view.onNotOpen}
      />
    );
  }
  if (kind === "skin") {
    return (
      <SkinPreview
        document={view.document}
        asset={view.asset}
        entry={entry}
        onNotOpen={view.onNotOpen}
      />
    );
  }
  return <VfxPreview drawable={drawable} frame={view.frame} />;
}

/** The run, over the mini transport unless the shell shows the timeline beside it. */
function VfxPreview({ drawable, frame }: { drawable: boolean; frame: ViewContext["frame"] }) {
  const timelineShown = useShellPaneShown("timeline");
  const transport = frame === "shell" && timelineShown ? "none" : "mini";
  return <PreviewPane drawable={drawable} transport={transport} />;
}

interface SkinShellProps extends ShellFrameProps {
  /** The skin object, which the preview reads its model from. */
  entry: string | null;
}

/**
 * The skin's panes: the character, its clips, and its sections beside them (ADR-0036).
 *
 * "The clips pane" in docs/ux/BIN_EDITOR.md. The Clips section is the pane's own, so
 * the inspector column leaves it out.
 */
export function SkinShell({ placed, pages, view, entry, preview }: SkinShellProps) {
  const tree = useShellLayout("skin");
  const [previewOwner, setPreviewOwner] = useState<"skin" | "spell">("skin");
  const [ability, setAbility] = useState<{
    entry: string | null;
    document: BinDocumentId;
    recipe: AbilityRecipe;
  } | null>(null);
  const activeAbility =
    ability?.entry === entry && ability.document === view.document ? ability.recipe : null;
  const showSpell =
    activeAbility !== null &&
    previewOwner === "spell" &&
    leafHolding(tree, "spells")?.activeTab === "spells";
  const others = useMemo(() => placed.filter((each) => each.widget !== "clips"), [placed]);
  const content = useMemo<ShellPaneContent<"skin">>(
    () => ({
      preview: {
        body: (
          <>
            <RetainedContent active={!showSpell} defer className="flex min-h-0 flex-1 flex-col">
              {preview}
            </RetainedContent>
            {activeAbility !== null && entry !== null && (
              <RetainedContent active={showSpell} defer className="flex min-h-0 flex-1 flex-col">
                <Suspense fallback={null}>
                  <AbilityPreview
                    source={{ document: view.document, asset: view.asset, entry }}
                    recipe={activeAbility}
                  />
                </Suspense>
              </RetainedContent>
            )}
          </>
        ),
      },
      spells: {
        onFocus: () => setPreviewOwner("spell"),
        body: (
          <SpellsPane
            objectPath={entry === null ? null : view.objectName(entry)}
            skin={entry === null ? undefined : { document: view.document, entry }}
            abilitySource={
              entry === null ? undefined : { document: view.document, asset: view.asset, entry }
            }
            onAbilityPreview={(recipe) => {
              setAbility(recipe === null ? null : { document: view.document, entry, recipe });
              if (recipe !== null) setPreviewOwner("spell");
            }}
          />
        ),
      },
      clips: {
        onFocus: () => setPreviewOwner("skin"),
        body: (
          <>
            <div
              data-ui="SkinShell:clips-toolbar"
              className="shrink-0 border-b border-surface-700/50 px-2 py-1.5 select-none"
            >
              <ClipTabs />
            </div>
            {entry !== null && (
              <ClipsHost view={view} entry={entry} className="flex min-h-0 flex-1 flex-col" />
            )}
          </>
        ),
      },
      material: {
        onFocus: () => setPreviewOwner("skin"),
        body: <MaterialPane view={view} entry={entry} />,
      },
      inspector: {
        onFocus: () => setPreviewOwner("skin"),
        body: <SectionColumn placed={others} pages={pages} view={view} />,
      },
    }),
    [others, pages, view, entry, activeAbility, showSpell, preview],
  );

  return (
    <div data-ui="ClassView:shell" className="flex min-h-0 flex-1 flex-col gap-2">
      <ShellHeader
        kind="skin"
        crumb={entry !== null && <ObjectPath path={view.objectName(entry)} />}
      />
      <ShellPaneTree kind="skin" content={content} />
    </div>
  );
}

interface MapShellProps extends ShellFrameProps {
  /** The `Map`, `MapSkin` or `MapContainer` object, which the preview draws a map from. */
  entry: string | null;
}

/**
 * The panes of a map class: the drawn map, its chunk graph, and the sections of the object.
 *
 * The preview and the outliner share the `MapSceneHost` the view mounts above them.
 */
export function MapShell({ placed, pages, view, entry, preview }: MapShellProps) {
  const content = useMemo<ShellPaneContent<"map">>(
    () => ({
      preview: { body: preview },
      outliner: { body: <MapOutliner /> },
      inspector: { body: <SectionColumn placed={placed} pages={pages} view={view} /> },
    }),
    [placed, pages, view, preview],
  );

  return (
    <div data-ui="ClassView:shell" className="flex min-h-0 flex-1 flex-col gap-2">
      <ShellHeader
        kind="map"
        crumb={entry !== null && <ObjectPath path={view.objectName(entry)} />}
      />
      <ShellPaneTree kind="map" content={content} />
    </div>
  );
}

interface MaterialShellProps extends ShellFrameProps {
  /** The `StaticMaterialDef` object the header names. */
  entry: string | null;
}

/**
 * The panes of a material: the material drawn on its character or a preview shape, and the
 * sections of the object (ADR-0047).
 */
export function MaterialShell({ placed, pages, view, entry, preview }: MaterialShellProps) {
  const content = useMemo<ShellPaneContent<"material">>(
    () => ({
      preview: { body: preview },
      inspector: { body: <SectionColumn placed={placed} pages={pages} view={view} /> },
    }),
    [placed, pages, view, preview],
  );

  return (
    <div data-ui="ClassView:shell" className="flex min-h-0 flex-1 flex-col gap-2">
      <ShellHeader
        kind="material"
        crumb={entry !== null && <ObjectPath path={view.objectName(entry)} />}
      />
      <ShellPaneTree kind="material" content={content} />
    </div>
  );
}

/** The object's own path on the header row, beside the class that only types it. */
function ObjectPath({ path }: { path: string }) {
  return (
    <span
      data-ui="ClassView:object-path"
      className="min-w-0 truncate px-1 font-mono text-meta text-code text-surface-200 select-text"
    >
      {path}
    </span>
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
export function VfxShell({ placed, pages, view, system, drawable, preview }: ShellProps) {
  const emitters = useMemo(() => placed.find((each) => each.widget === "emitters"), [placed]);
  const others = useMemo(() => placed.filter((each) => each.widget !== "emitters"), [placed]);

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
        actions: <ChanceReadout />,
      },
      preview: { body: preview },
      timeline: { body: <TimelinePane drawable={drawable} /> },
    }),
    [emitters, others, pages, view, drawable, preview],
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

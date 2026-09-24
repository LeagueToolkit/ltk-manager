import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from "react";

import { ContextMenu } from "@/components";
import { useResizeObserver } from "@/hooks";
import type { AssetRef, BinDocumentId, BinRow } from "@/lib/tauri";
import { HostedContent, PortalSlot, usePortalHosts } from "@/modules/editor";

import { useCurveFollow } from "../../curves/utils/curveFollow";
import { DeclaredRowsContext, useDeclaredRows } from "../../documents/hooks/useDeclared";
import {
  LinkAssetContext,
  LinkOpenContext,
  LinkTargetsContext,
  ObjectNameContext,
  type RowGroup,
  useCheckLinkTargets,
  useWarmLinkOpen,
} from "../../links/hooks/useLinkTargets";
import { preloadMapViewport } from "../../map/components/MapPreview";
import { MapSceneHost, type MapSceneSource } from "../../map/state/mapScene";
import { preloadMaterialViewport } from "../../material/components/MaterialPreview";
import { nameHash } from "../../shared/utils/binHash";
import { preloadSkinViewport } from "../../skin/components/SkinPreview";
import { SkinChoiceContext, useSkinChoice } from "../../skin/state/skinChoice";
import { BinContextMenu } from "../../tree/components/BinContextMenu";
import { useInvalidateBinReads } from "../../tree/hooks/useBinEdit";
import { LeafEditContext, type Reopen, useLeafEdit } from "../../tree/hooks/useLeafEdit";
import { RowDocumentContext } from "../../tree/state/rowFold";
import { createRowRegistry, RowRegistryContext } from "../../tree/state/rowRegistry";
import { rowKey, type RowLine } from "../../tree/utils/binRows";
import { useValueMarks, ValueMarksContext } from "../../values/hooks/useValueMarks";
import { preloadVfxViewport } from "../../vfx";
import {
  EmitterChoiceContext,
  useEmitterChoice,
  useEmitterMarks,
} from "../../vfx/inspector/state/emitterChoice";
import { emitterRows } from "../../vfx/inspector/utils/emitterCards";
import { cellLine, cellRows, useLayoutRead } from "../hooks/useLayoutRead";
import { type ClassLayout, frameOf, type LayoutFrame, placeRows } from "../utils/classLayouts";
import type { ViewContext } from "./ClassCells";
import {
  crumbName,
  FramePreview,
  Hero,
  MapShell,
  MaterialShell,
  RunHost,
  SkinShell,
  Stack,
  VfxShell,
} from "./ClassFrames";

/**
 * The width a strip and an inspector both need, under which a shell falls to the stack.
 *
 * "The shell" in docs/ux/BIN_EDITOR.md. The object pane is about 1150px with both
 * sidebars open, so the fallback is for a narrow window rather than for the usual one.
 */
const SHELL_WIDTH = 900;

/** The one class the preview pane draws, which is the renderer's whole subject. */
const VFX_SYSTEM = nameHash("VfxSystemDefinitionData");

interface ClassViewProps {
  /** The open's id, which every read carries. */
  document: BinDocumentId;
  /** What the document was read from, which the layer side of a `file` link looks in. */
  asset: AssetRef;
  editable?: boolean;
  /** The object's properties at depth zero, which the open already answered. */
  roots: readonly BinRow[];
  /** The class the roots are properties of, which the layout was keyed on. */
  classHash: string;
  layout: ClassLayout;
  /** The name of the object an entry hash addresses, for the path a cell copies. */
  objectName: (entry: string) => string;
  /** The backend holds no document with this id. The caller reopens it. */
  onNotOpen: Reopen;
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
  editable = false,
  roots,
  classHash,
  layout,
  objectName,
  onNotOpen,
  onShowInProperties,
  onFrame,
}: ClassViewProps) {
  const invalidate = useInvalidateBinReads();
  const edits = useLeafEdit(document, asset, invalidate, onNotOpen);
  const declared = useDeclaredRows(document, editable);
  const placed = useMemo(() => placeRows(roots, layout), [roots, layout]);
  const pages = useLayoutRead(document, placed);

  /* Null until the pane has been measured, so a preview mounts once in the frame it
     stays in rather than in the stack for the render before the observer answers. */
  const [wide, setWide] = useState<boolean | null>(null);
  const measure = useResizeObserver<HTMLDivElement>((element) => {
    const width = element.offsetWidth;
    /* A later zero is a pane with no size rather than a narrow one, and must not pull a
       settled frame back to the stack. The first measurement still settles it, so a pane
       that never reports a width draws the stack. */
    setWide((settled) => (width > 0 || settled === null ? width >= SHELL_WIDTH : settled));
  });
  const frame: LayoutFrame | null =
    wide === null ? null : frameOf(layout) === "shell" && wide ? "shell" : "stack";
  useEffect(() => {
    if (frame !== null) onFrame?.(frame);
  }, [onFrame, frame]);

  /* Warmed beside the read, so the chunk three sits in is on its way before the skin answers. */
  const skin = layout.shell === "skin";
  useEffect(() => {
    if (skin) preloadSkinViewport();
  }, [skin]);
  const map = layout.shell === "map";
  const mapEntry = roots[0]?.entry ?? null;
  const mapSource = useMemo<MapSceneSource>(
    () => ({ kind: "object", document, entry: mapEntry }),
    [document, mapEntry],
  );
  useEffect(() => {
    if (map) preloadMapViewport();
  }, [map]);
  const material = layout.shell === "material";
  useEffect(() => {
    if (!material) return;
    preloadMaterialViewport();
    preloadSkinViewport();
  }, [material]);

  /* The run is held above both frames (ADR-0037), so a change of frame mounts the preview
     in another place and loses neither the clock nor the seed. */
  const entry = roots[0]?.entry ?? "";
  const drawable = layout.shell === "vfx" && classHash === VFX_SYSTEM;
  useEffect(() => {
    if (drawable) preloadVfxViewport();
  }, [drawable]);

  /* Held here for the reason the strip is: a change of frame mounts the preview in
     another place, and must not lose the clip, the transport or the time. */
  const skinChoice = useSkinChoice();

  /* The stack stands in until the pane is measured. Neither frame is drawn then, so
     what this carries is what the first drawn one will. */
  const shown: LayoutFrame = frame ?? "stack";
  const view = useMemo<ViewContext>(
    () => ({ document, asset, classHash, entry, objectName, onNotOpen, frame: shown }),
    [document, asset, classHash, entry, objectName, onNotOpen, shown],
  );

  /* One preview for both frames, which the hero or the shell's pane adopts, so crossing
     SHELL_WIDTH moves the canvas rather than remounting it. */
  const previewHost = usePortalHosts()("preview");
  /* Memoized, because each shell keys its pane content on it. */
  const previewSlot = useMemo(() => <PortalSlot host={previewHost} />, [previewHost]);

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
  const emitters = useEmitterChoice(document, placed, pages, shown);
  useCurveFollow(emitters.card);
  const held = useMemo(() => cellRows(placed, pages), [placed, pages]);
  const childRows = useMemo(
    () =>
      new Map(
        emitters.child === null || emitters.card === undefined
          ? []
          : emitterRows(emitters.card).map((row) => [rowKey(row), row] as const),
      ),
    [emitters.child, emitters.card],
  );
  const viewMarks = useValueMarks(document, held.marks);
  const emitterMarks = useEmitterMarks(document, emitters);
  const marks = useMemo(() => new Map([...viewMarks, ...emitterMarks]), [viewMarks, emitterMarks]);

  const system = useMemo(() => crumbName(objectName(roots[0]?.entry ?? "")), [objectName, roots]);
  /* The rows a struct opened in place drew, which the view's own read never answered. */
  const [nested] = useState(createRowRegistry);
  const [menuLine, setMenuLine] = useState<RowLine | null>(null);
  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-row-key]");
    const key = cell?.dataset.rowKey;
    const row =
      key === undefined
        ? undefined
        : (held.menu.get(key) ?? childRows.get(key) ?? nested.find(key));
    setMenuLine(row === undefined ? null : cellLine(row, classHash));
  }

  return (
    <DeclaredRowsContext value={declared}>
      <LeafEditContext value={editable ? edits : null}>
        <LinkAssetContext value={asset}>
          <ObjectNameContext value={objectName}>
            <LinkTargetsContext value={linkTargets}>
              <LinkOpenContext value={linkOpen}>
                <ValueMarksContext value={marks}>
                  <RowDocumentContext value={document}>
                    <RowRegistryContext value={nested.registry}>
                      <EmitterChoiceContext value={emitters}>
                        <SkinChoiceContext value={skinChoice}>
                          <RunHost drawable={drawable} document={document} entry={entry}>
                            <MapSceneHost enabled={map} near={asset} source={mapSource}>
                              <ContextMenu.Root>
                                <ContextMenu.Trigger
                                  ref={measure}
                                  data-ui="ClassView"
                                  className="flex min-h-0 flex-1 flex-col select-none"
                                  onContextMenu={handleContextMenu}
                                >
                                  {frame === "stack" && (
                                    <Stack
                                      placed={placed}
                                      pages={pages}
                                      view={view}
                                      hero={
                                        layout.shell !== undefined && <Hero>{previewSlot}</Hero>
                                      }
                                    />
                                  )}
                                  {frame === "shell" && layout.shell === "vfx" && (
                                    <VfxShell
                                      placed={placed}
                                      pages={pages}
                                      view={view}
                                      system={system}
                                      drawable={drawable}
                                      preview={previewSlot}
                                    />
                                  )}
                                  {frame === "shell" && map && (
                                    <MapShell
                                      placed={placed}
                                      pages={pages}
                                      view={view}
                                      entry={roots[0]?.entry ?? null}
                                      preview={previewSlot}
                                    />
                                  )}
                                  {frame === "shell" && skin && (
                                    <SkinShell
                                      placed={placed}
                                      pages={pages}
                                      view={view}
                                      entry={roots[0]?.entry ?? null}
                                      preview={previewSlot}
                                    />
                                  )}
                                  {frame === "shell" && material && (
                                    <MaterialShell
                                      placed={placed}
                                      pages={pages}
                                      view={view}
                                      entry={roots[0]?.entry ?? null}
                                      preview={previewSlot}
                                    />
                                  )}
                                  {layout.shell !== undefined && (
                                    <HostedContent host={previewHost}>
                                      <FramePreview
                                        kind={layout.shell}
                                        view={view}
                                        entry={roots[0]?.entry ?? null}
                                        drawable={drawable}
                                      />
                                    </HostedContent>
                                  )}
                                </ContextMenu.Trigger>

                                {/* Properties is this object's tree, which holds no child system's row. */}
                                <BinContextMenu
                                  line={menuLine}
                                  objectName={objectName}
                                  onShowInProperties={
                                    menuLine?.row.entry === entry ? onShowInProperties : undefined
                                  }
                                />
                              </ContextMenu.Root>
                            </MapSceneHost>
                          </RunHost>
                        </SkinChoiceContext>
                      </EmitterChoiceContext>
                    </RowRegistryContext>
                  </RowDocumentContext>
                </ValueMarksContext>
              </LinkOpenContext>
            </LinkTargetsContext>
          </ObjectNameContext>
        </LinkAssetContext>
      </LeafEditContext>
    </DeclaredRowsContext>
  );
}

import { type MouseEvent as ReactMouseEvent, useEffect, useMemo, useState } from "react";

import { ContextMenu } from "@/components";
import { useResizeObserver } from "@/hooks";
import type { AssetRef, BinDocumentId, BinRow } from "@/lib/tauri";

import { BinContextMenu } from "./BinContextMenu";
import { nameHash } from "./binHash";
import { rowKey, type RowLine } from "./binRows";
import type { ViewContext } from "./ClassCells";
import { crumbName, RunHost, SkinHero, SkinShell, Stack, VfxHero, VfxShell } from "./ClassFrames";
import { type ClassLayout, frameOf, type LayoutFrame, placeRows } from "./classLayouts";
import { useCurveFollow } from "./curveFollow";
import { emitterRows } from "./emitterCards";
import { EmitterChoiceContext, useEmitterChoice, useEmitterMarks } from "./emitterChoice";
import { RowDocumentContext } from "./rowFold";
import { createRowRegistry, RowRegistryContext } from "./rowRegistry";
import { SkinChoiceContext, useSkinChoice } from "./skin/skinChoice";
import { preloadSkinViewport } from "./skin/SkinPreview";
import { cellLine, cellRows, useLayoutRead } from "./useLayoutRead";
import {
  LinkAssetContext,
  LinkOpenContext,
  LinkTargetsContext,
  type RowGroup,
  useCheckLinkTargets,
  useWarmLinkOpen,
} from "./useLinkTargets";
import { useValueMarks, ValueMarksContext } from "./useValueMarks";
import { preloadVfxViewport } from "./vfx";

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

  /* Warmed beside the read, so the chunk three sits in is on its way before the skin answers. */
  const skin = layout.shell === "skin";
  useEffect(() => {
    if (skin) preloadSkinViewport();
  }, [skin]);

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
  const emitters = useEmitterChoice(document, placed, pages, frame);
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
    <LinkAssetContext value={asset}>
      <LinkTargetsContext value={linkTargets}>
        <LinkOpenContext value={linkOpen}>
          <ValueMarksContext value={marks}>
            <RowDocumentContext value={document}>
              <RowRegistryContext value={nested.registry}>
                <EmitterChoiceContext value={emitters}>
                  <SkinChoiceContext value={skinChoice}>
                    <RunHost drawable={drawable} document={document} entry={entry}>
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
                                <>
                                  {skin && <SkinHero view={view} entry={roots[0]?.entry ?? null} />}
                                  {layout.shell === "vfx" && <VfxHero drawable={drawable} />}
                                </>
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
                            />
                          )}
                          {frame === "shell" && skin && (
                            <SkinShell
                              placed={placed}
                              pages={pages}
                              view={view}
                              entry={roots[0]?.entry ?? null}
                            />
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
                    </RunHost>
                  </SkinChoiceContext>
                </EmitterChoiceContext>
              </RowRegistryContext>
            </RowDocumentContext>
          </ValueMarksContext>
        </LinkOpenContext>
      </LinkTargetsContext>
    </LinkAssetContext>
  );
}

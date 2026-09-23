import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { use, useMemo, useState } from "react";

import { Button, HexshadeIcon, Menu } from "@/components";
import { m } from "@/i18n";
import type { BinRow, SkinModel } from "@/lib/tauri";
import { usePreviewShaders, useSetPreviewDisplay } from "@/stores";

import { AlsoCheck, type ViewContext } from "../../classes/components/ClassCells";
import { Sections } from "../../classes/components/ClassSections";
import { useLayoutRead } from "../../classes/hooks/useLayoutRead";
import { materialLayout, placeRows } from "../../classes/utils/classLayouts";
import { useBinRead } from "../../documents/hooks/useBinRead";
import { nameHash } from "../../shared/utils/binHash";
import { skinQueries } from "../../skin/api/skinQueries";
import { SkinChoiceContext } from "../../skin/state/skinChoice";
import { objectKey, PAGE_SIZE } from "../../tree/utils/binRows";
import { Notice } from "../../vfx/preview/components/Notice";

const STATIC_MATERIAL = nameHash("StaticMaterialDef");

/** One material a skin draws with, as the pane's picker lists it. */
export interface SkinMaterial {
  readonly hash: string;
  /** The material's path, or its hash where no table names it. */
  readonly name: string;
}

/** Every material `skin` draws with and the file declares, the body's first. */
export function skinMaterials(skin: SkinModel): SkinMaterial[] {
  const seen = new Map<string, SkinMaterial>();
  for (const material of [skin.material, ...skin.overrides.map((each) => each.material)]) {
    if (material === null || material.missing || seen.has(material.hash)) continue;
    seen.set(material.hash, { hash: material.hash, name: material.name ?? material.hash });
  }
  return [...seen.values()];
}

/** The material `submesh` draws with: its override's, else the skin's own. */
export function submeshMaterial(skin: SkinModel, submesh: string): string | null {
  const wanted = submesh.toLowerCase();
  const override = skin.overrides.find((each) => each.submesh.toLowerCase() === wanted);
  const material = override?.material ?? skin.material;
  if (material === null || material.missing) return null;
  return material.hash;
}

export interface MaterialPaneProps {
  view: ViewContext;
  /** The skin object, whose materials the pane lists. */
  entry: string | null;
}

/**
 * One material of the skin as editable tables, beside the character it draws.
 *
 * "The material pane" in docs/ux/BIN_EDITOR.md. The material follows the submesh picked
 * on the character, and the picker overrides it until the next pick. The edits go through
 * the view's own leaf edits, so the character redraws once one lands.
 */
export function MaterialPane({ view, entry }: MaterialPaneProps) {
  const skin = useQuery({
    ...skinQueries.skin(view.document, entry ?? ""),
    enabled: entry !== null,
  });
  const choice = use(SkinChoiceContext);
  const [chosen, setChosen] = useState<{ hash: string; picks: number } | null>(null);

  const materials = useMemo(
    () => (skin.data === undefined ? [] : skinMaterials(skin.data)),
    [skin.data],
  );
  const picks = choice?.picks ?? 0;
  const picked =
    skin.data !== undefined && choice?.submesh != null
      ? submeshMaterial(skin.data, choice.submesh)
      : null;
  const current =
    (chosen !== null && chosen.picks === picks ? chosen.hash : null) ??
    picked ??
    chosen?.hash ??
    materials[0]?.hash ??
    null;

  if (skin.data === undefined) {
    return <Notice text={m.workshop_bin_mesh_preview_loading_label()} />;
  }
  if (materials.length === 0 || current === null) {
    return <Notice text={m.workshop_bin_material_pane_empty()} />;
  }

  return (
    <div data-ui="MaterialPane" className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-surface-700/50 px-2 py-1.5 select-none">
        <MaterialPicker
          materials={materials}
          current={current}
          onPick={(hash) => setChosen({ hash, picks })}
        />
        <ShadersHint />
      </div>
      <MaterialSections key={current} view={view} entry={current} />
    </div>
  );
}

/** The sections of the material `entry`, read out of the view's own document. */
function MaterialSections({ view, entry }: { view: ViewContext; entry: string }) {
  const root = objectKey(entry);
  const read = useBinRead(view.document, [{ key: root, rows: PAGE_SIZE }]);
  const roots = read.get(root)?.rows;
  const placed = useMemo(() => placeRows(roots ?? [], materialLayout), [roots]);
  const pages = useLayoutRead(view.document, placed);
  const own = useMemo<ViewContext>(
    () => ({ ...view, classHash: STATIC_MATERIAL, entry, frame: "stack" }),
    [view, entry],
  );
  const group = useMemo(
    () => ({
      key: root,
      rows: [...(roots ?? []), ...[...pages.values()].flatMap((page): BinRow[] => page.rows)],
    }),
    [root, roots, pages],
  );

  if (roots === undefined) {
    return <Notice text={m.workshop_bin_material_preview_loading_label()} />;
  }
  if (roots.length === 0) {
    return <Notice text={m.workshop_bin_material_pane_elsewhere_empty()} />;
  }

  return (
    <AlsoCheck document={view.document} group={group}>
      {/* DS-SCROLLBAR */}
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 scrollbar-md">
        <Sections placed={placed} pages={pages} view={own} />
      </div>
    </AlsoCheck>
  );
}

function MaterialPicker({
  materials,
  current,
  onPick,
}: {
  materials: readonly SkinMaterial[];
  current: string;
  onPick: (hash: string) => void;
}) {
  const shown = materials.find((each) => each.hash === current);

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="xs"
            compact
            className="min-w-0"
            aria-label={m.workshop_bin_material_pane_pick_label()}
            right={<CaretDownIcon weight="bold" className="h-3 w-3" />}
          >
            <span className="truncate font-mono text-code">
              {lastSegment(shown?.name ?? current)}
            </span>
          </Button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner align="start">
          <Menu.Popup data-ui="MaterialPane:materials" className="max-w-md">
            {materials.map((material) => (
              <Menu.Item
                key={material.hash}
                icon={material.hash === current && <CheckIcon weight="bold" className="h-4 w-4" />}
                onClick={() => onPick(material.hash)}
              >
                <span className="truncate font-mono text-code">{lastSegment(material.name)}</span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** A way to turn Hexshade on, since an edit shows on the character only under it. */
function ShadersHint() {
  const shaders = usePreviewShaders();
  const setDisplay = useSetPreviewDisplay();
  if (shaders) return null;

  return (
    <Button
      variant="ghost"
      size="xs"
      compact
      className="ml-auto"
      left={<HexshadeIcon className="h-4 w-4" />}
      onClick={() => setDisplay({ previewShaders: true })}
    >
      {m.workshop_bin_material_pane_shaders_action()}
    </Button>
  );
}

function lastSegment(path: string): string {
  return path.split("/").pop() ?? path;
}

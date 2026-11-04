import { CaretDownIcon, CopyIcon, TrashIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo } from "react";

import { Button, Checkbox, IconButton, Menu, Switch } from "@/components";
import { m } from "@/i18n";
import type { MapGeometryMesh } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { mapQueries } from "../api/mapQueries";
import { useGeometryMeshes } from "../hooks/useGeometryMeshes";
import { useMeshActions } from "../hooks/useMeshActions";
import { useMapScene } from "../state/mapScene";
import { meshTransformEdit, movableMeshes } from "../utils/meshSelection";
import { movesToLead } from "../utils/placeableSpace";
import { ChoicePicker } from "./ChoicePicker";
import { TransformFields } from "./TransformFields";

/** How many visibility layers a mesh's mask holds, one bit each. */
const LAYER_COUNT = 8;

/** The quality levels a mesh's quality mask holds, lowest first, one bit each. */
const QUALITIES: readonly (() => string)[] = [
  m.workshop_bin_map_mesh_quality_very_low_label,
  m.workshop_bin_map_mesh_quality_low_label,
  m.workshop_bin_map_mesh_quality_medium_label,
  m.workshop_bin_map_mesh_quality_high_label,
  m.workshop_bin_map_mesh_quality_very_high_label,
];

/** The value the controller menu holds for no controller. */
const NO_CONTROLLER = "";

/** The value the region picker holds for no region. */
const NO_REGION = "";

/**
 * The selected map meshes: their materials, visibility layers, controller, quality and
 * culling, with duplicate and delete. An edit applies to every selected mesh as one undo
 * step. Per "Meshes" in docs/ux/MAP_EDITOR.md.
 */
export function MeshInspector() {
  const { selection, meshes } = useGeometryMeshes();
  const { editGeometry, backdrop, materials, editable, tool, setTool } = useMapScene();
  const actions = useMeshActions(meshes.length);
  const defs = useQuery(mapQueries.materialDefs(materials)).data;
  const chunks = useQuery(mapQueries.outline(materials)).data;
  const materialChoices = useMemo(
    () => (defs ?? []).map((path) => ({ value: path, label: path })),
    [defs],
  );
  const regionChoices = useMemo(
    () => [
      { value: NO_REGION, label: m.workshop_bin_map_mesh_no_region_label() },
      ...(chunks ?? []).flatMap((chunk) =>
        chunk.items
          .filter((item) => item.class.includes("Region"))
          .map((item) => ({ value: item.key, label: item.name })),
      ),
    ],
    [chunks],
  );
  const lead = selection[0];
  if (lead === undefined) return null;

  const indices = selection.map((mesh) => mesh.index);
  const tools = editable ? { current: tool, pick: setTool } : undefined;
  const controllerName = (hash: string) =>
    backdrop.controllers.find((each) => each.hash === hash)?.name ?? hash;

  const setBit = (field: "visibility" | "quality", bit: number, on: boolean) => {
    const value = lead[field];
    const mask = on ? value | (1 << bit) : value & ~(1 << bit);
    void editGeometry({ kind: field, meshes: indices, mask });
  };

  return (
    <section data-ui="MeshInspector" className="flex flex-col gap-2">
      <header className="flex min-w-0 items-center gap-2 px-1">
        <span className="min-w-0 truncate text-row text-surface-100">
          {m.workshop_bin_map_mesh_title({ index: lead.index })}
        </span>
        <span className="text-meta text-surface-400">
          {m.workshop_bin_map_mesh_vertices_label({ count: lead.vertexCount })}
        </span>
        {selection.length > 1 && (
          <span className="shrink-0 text-meta text-surface-400">
            {m.workshop_bin_map_selection_count_label({
              count: selection.length,
            })}
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center">
          <IconButton
            icon={<CopyIcon />}
            onClick={() => void actions.duplicate(indices)}
            label={m.workshop_bin_map_duplicate_action()}
          />
          <IconButton
            icon={<TrashIcon />}
            onClick={() => void actions.remove(indices)}
            label={m.workshop_bin_map_delete_action()}
          />
        </span>
      </header>

      <MeshGroup>
        <TransformFields
          transform={lead.transform}
          disabled={lead.region !== null}
          tools={tools}
          onCommit={(next) => {
            const edit = meshTransformEdit(movesToLead(movableMeshes(selection), next));
            if (edit !== null) void editGeometry(edit);
          }}
        />
      </MeshGroup>

      <MeshGroup>
        <MeshField label={m.workshop_bin_map_mesh_materials_label()}>
          <div className="flex min-w-0 flex-col gap-1">
            {lead.materials.map((material, submesh) => (
              <div key={submesh} className="flex min-w-0 items-center gap-2">
                {lead.materials.length > 1 && (
                  <span className="w-4 shrink-0 text-meta text-surface-400 tabular-nums">
                    {submesh}
                  </span>
                )}
                <ChoicePicker
                  choices={materialChoices}
                  value={material}
                  label={m.workshop_bin_map_mesh_material_label({ submesh })}
                  empty={m.workshop_bin_map_mesh_material_empty()}
                  onPick={(picked) =>
                    void editGeometry({
                      kind: "material",
                      mesh: lead.index,
                      submesh,
                      material: picked,
                    })
                  }
                />
              </div>
            ))}
          </div>
        </MeshField>

        <MeshField label={m.workshop_bin_map_mesh_region_label()}>
          <ChoicePicker
            choices={regionChoices}
            value={lead.region ?? NO_REGION}
            label={m.workshop_bin_map_mesh_region_label()}
            empty={m.workshop_bin_map_mesh_region_empty()}
            onPick={(picked) =>
              void editGeometry({
                kind: "region",
                meshes: indices,
                region: picked === NO_REGION ? null : picked,
              })
            }
          />
          {lead.region !== null && (
            <span className="text-meta text-surface-400">
              {m.workshop_bin_map_mesh_region_hint()}
            </span>
          )}
        </MeshField>
      </MeshGroup>

      <MeshGroup>
        <MeshField label={m.workshop_bin_map_mesh_layers_label()}>
          <div
            className={twMerge(
              "grid gap-x-3 gap-y-1",
              backdrop.flagNames.size > 0 ? "grid-cols-2" : "grid-cols-4",
            )}
          >
            {Array.from({ length: LAYER_COUNT }, (_, bit) => (
              <Checkbox
                key={bit}
                size="sm"
                label={<LayerLabel bit={bit} name={backdrop.flagNames.get(bit)} />}
                checked={(lead.visibility & (1 << bit)) !== 0}
                onCheckedChange={(on) => setBit("visibility", bit, on)}
              />
            ))}
          </div>
        </MeshField>

        <MeshField label={m.workshop_bin_map_mesh_controller_label()}>
          <ControllerMenu
            mesh={lead}
            name={controllerName}
            onPick={(controller) => void actions.setController(indices, controller)}
          />
        </MeshField>

        <MeshField label={m.workshop_bin_map_mesh_quality_label()}>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {QUALITIES.map((label, bit) => (
              <Checkbox
                key={bit}
                size="sm"
                label={label()}
                checked={(lead.quality & (1 << bit)) !== 0}
                onCheckedChange={(on) => setBit("quality", bit, on)}
              />
            ))}
          </div>
        </MeshField>
      </MeshGroup>

      <MeshGroup>
        <MeshField label={m.workshop_bin_map_mesh_culling_label()} inline>
          <Switch
            checked={!lead.backfaceCullingDisabled}
            aria-label={m.workshop_bin_map_mesh_culling_label()}
            onCheckedChange={(on) =>
              void editGeometry({
                kind: "backfaceCulling",
                meshes: indices,
                disabled: !on,
              })
            }
          />
        </MeshField>
      </MeshGroup>
    </section>
  );
}

/** A run of related fields, set off from the run above it by a hairline. */
function MeshGroup({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-surface-700/40 px-1 pt-2">{children}</div>
  );
}

interface MeshFieldProps {
  readonly label: string;
  /** The control sits on the label's line, for a control as short as a switch. */
  readonly inline?: boolean;
  readonly children: ReactNode;
}

/** One property: its label in the inspector's label column and its control beside it. */
function MeshField({ label, inline = false, children }: MeshFieldProps) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-1">
      <span
        className={twMerge(
          "truncate pr-1 text-meta text-surface-400",
          inline ? "self-center" : "pt-1.5",
        )}
      >
        {label}
      </span>
      <div className="flex min-w-0 flex-col gap-1">{children}</div>
    </div>
  );
}

/** A visibility layer's bit, and the name the map's flag definitions give it. */
function LayerLabel({ bit, name }: { bit: number; name: string | undefined }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <span className="text-surface-400 tabular-nums">{bit}</span>
      {name !== undefined && <span className="truncate">{name}</span>}
    </span>
  );
}

interface ControllerMenuProps {
  readonly mesh: MapGeometryMesh;
  readonly name: (hash: string) => string;
  readonly onPick: (controller: string | null) => void;
}

/** The visibility controller of a mesh, named on a full-width trigger over a menu of the map's controllers. */
function ControllerMenu({ mesh, name, onPick }: ControllerMenuProps) {
  const { backdrop } = useMapScene();
  const shown =
    mesh.controller === null
      ? m.workshop_bin_map_mesh_no_controller_label()
      : name(mesh.controller);

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="outline"
            size="md"
            className="w-full justify-between font-normal"
            aria-label={m.workshop_bin_map_mesh_controller_label()}
            right={<CaretDownIcon weight="bold" className="size-3 text-surface-400" />}
          >
            <span className="min-w-0 truncate">{shown}</span>
          </Button>
        }
      />
      <Menu.Content className="max-h-96 w-64 overflow-y-auto scrollbar-md">
        <Menu.RadioGroup
          value={mesh.controller ?? NO_CONTROLLER}
          onValueChange={(value) => onPick(value === NO_CONTROLLER ? null : String(value))}
        >
          <Menu.RadioItem value={NO_CONTROLLER}>
            {m.workshop_bin_map_mesh_no_controller_label()}
          </Menu.RadioItem>
          {backdrop.controllers.map((controller) => (
            <Menu.RadioItem key={controller.hash} value={controller.hash}>
              {controller.name ?? controller.hash}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Content>
    </Menu.Root>
  );
}

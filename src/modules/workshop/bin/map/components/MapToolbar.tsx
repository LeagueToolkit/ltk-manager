import {
  CaretDownIcon,
  CubeFocusIcon,
  ExportIcon,
  EyeIcon,
  FilePlusIcon,
  FloppyDiskIcon,
  FrameCornersIcon,
  MagnetIcon,
} from "@phosphor-icons/react";
import { type RefObject, useRef } from "react";

import { Button, IconButton, Menu } from "@/components";
import { m } from "@/i18n";
import type { MapPath, MapVariant } from "@/lib/tauri";
import { CommandMenuItems } from "@/modules/editor";
import type { BackdropSource, CaptureFrame } from "@/modules/viewport";

import { usePaneCommands } from "../../menus/state/paneCommands";
import { BackgroundControl } from "../../shared/preview/BackgroundControl";
import { CameraMenu } from "../../shared/preview/CameraMenu";
import { CaptureButton } from "../../shared/preview/CaptureButton";
import { ViewModeMenu } from "../../shared/preview/ViewModeMenu";
import { ControlDivider, ViewportRail } from "../../shared/preview/ViewportControls";
import { useMapShowEntries } from "../hooks/useMapShowEntries";
import { useMeshExport } from "../hooks/useMeshFiles";
import { useMapScene } from "../state/mapScene";
import { MAP_PANE_COMMANDS } from "../utils/mapCommands";
import { MAP_KEYS } from "../utils/mapKeys";
import { MAP_TOOLS } from "../utils/mapTools";
import { variantLabel } from "../utils/mapVariants";
import { BoxSelectButton, type PlaceablePicking } from "./PlaceablePicking";
import { PlaceMenu } from "./PlaceMenu";
import { PostEffectsControl } from "./PostEffectsControl";
import { SunControl } from "./SunControl";

/** Presses the first button inside `box`, which is the trigger of the popover it holds. */
function pressTrigger(box: HTMLElement | null): void {
  box?.querySelector("button")?.click();
}

/**
 * The tool rail down the viewport's left edge: the tools of an editable map, one pressed at a
 * time, the box select, and the gizmo's axes and snap. A read-only map shows only the box select.
 * Per "Tools" in docs/ux/MAP_EDITOR.md.
 */
export function ToolRail({ picking }: { picking: PlaceablePicking }) {
  const { tool, setTool, space, setSpace, snap, setSnap, editable } = useMapScene();
  const local = space === "local";

  return (
    <ViewportRail side="left" data-ui="MapViewport:tools">
      {editable &&
        MAP_TOOLS.map(({ tool: each, icon: Glyph, label }) => (
          <IconButton
            key={each}
            pressed={tool === each}
            icon={<Glyph />}
            onClick={() => setTool(each)}
            label={label()}
          />
        ))}
      {editable && <ControlDivider side="left" />}
      <BoxSelectButton picking={picking} />
      {editable && (
        <>
          <ControlDivider side="left" />
          <IconButton
            pressed={local}
            icon={<CubeFocusIcon />}
            onClick={() => setSpace(local ? "world" : "local")}
            label={m.workshop_bin_map_tool_local_label({ key: MAP_KEYS.localAxes })}
          />
          <IconButton
            pressed={snap}
            icon={<MagnetIcon />}
            onClick={() => setSnap(!snap)}
            label={m.workshop_bin_map_tool_snap_label()}
          />
        </>
      )}
    </ViewportRail>
  );
}

export interface TopRailProps {
  readonly picking: PlaceablePicking;
  /** The backdrop whose sun and post effects a read-only map previews. */
  readonly source: BackdropSource | null;
  readonly variants: readonly MapVariant[];
  readonly chosen: MapVariant;
  readonly onPick: (map: MapPath) => void;
  /** Opens the file picker of the mesh import. */
  readonly onAddMesh: () => void;
  readonly onFrame: () => void;
  /** The capture function of the viewport under the rail. */
  readonly capture: RefObject<CaptureFrame | null>;
}

/**
 * The rail across the viewport's top edge: the current tool's options, the file actions and the
 * skin on the left, and what the viewport shows and how it looks on the right.
 */
export function TopRail({
  picking,
  source,
  variants,
  chosen,
  onPick,
  onAddMesh,
  onFrame,
  capture,
}: TopRailProps) {
  const { editable, tool, geometryDocument } = useMapScene();
  const exportMeshes = useMeshExport();
  const sun = useRef<HTMLSpanElement>(null);
  const postEffects = useRef<HTMLSpanElement>(null);

  usePaneCommands("map.rail", {
    [MAP_PANE_COMMANDS.sun]: { run: editable ? null : () => pressTrigger(sun.current) },
    [MAP_PANE_COMMANDS.postEffects]: {
      run: editable ? null : () => pressTrigger(postEffects.current),
    },
  });

  return (
    <ViewportRail side="top" data-ui="MapViewport:controls">
      {editable && tool === "place" && (
        <>
          <PlaceMenu />
          <ControlDivider />
        </>
      )}
      {editable && geometryDocument !== null && (
        <>
          <Button
            variant="ghost"
            size="xs"
            left={<FilePlusIcon weight="bold" />}
            onClick={onAddMesh}
          >
            {m.workshop_bin_map_import_short_label()}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            left={<ExportIcon weight="bold" />}
            onClick={() => void exportMeshes(null)}
            aria-label={m.workshop_bin_map_export_map_action()}
          >
            {m.workshop_bin_map_export_short_label()}
          </Button>
          <SaveGeometryButton dirty={geometryDocument.dirty} />
          <ControlDivider />
        </>
      )}
      {variants.length > 1 && <VariantMenu variants={variants} chosen={chosen} onPick={onPick} />}
      <span className="flex-1" />
      <ShowMenu picking={picking} />
      {/* An editable map edits its sun and post effects in the Lighting pane. */}
      {!editable && (
        <span ref={sun} className="contents">
          <SunControl source={source} />
        </span>
      )}
      {!editable && (
        <span ref={postEffects} className="contents">
          <PostEffectsControl source={source} />
        </span>
      )}
      <BackgroundControl />
      <ControlDivider />
      <ViewModeMenu />
      <CameraMenu />
      <Button variant="ghost" size="xs" left={<FrameCornersIcon weight="bold" />} onClick={onFrame}>
        {m.workshop_bin_map_frame_label()}
      </Button>
      <CaptureButton capture={capture} />
    </ViewportRail>
  );
}

/** What the viewport draws besides the map, as switches in one menu. */
function ShowMenu({ picking }: { picking: PlaceablePicking }) {
  const entries = useMapShowEntries(picking.shown, () => picking.setBoxing(false));

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="xs"
            left={<EyeIcon weight="bold" />}
            right={<CaretDownIcon weight="bold" className="size-3" />}
          >
            {m.workshop_bin_map_show_label()}
          </Button>
        }
      />
      <Menu.Content align="end" data-ui="MapShowMenu" className="w-52">
        <CommandMenuItems items={entries} />
      </Menu.Content>
    </Menu.Root>
  );
}

/** Writes the open `.mapgeo`, enabled while it holds unsaved changes. */
function SaveGeometryButton({ dirty }: { dirty: boolean }) {
  const { saveGeometry } = useMapScene();

  return (
    <Button
      variant="ghost"
      size="xs"
      left={<FloppyDiskIcon weight="bold" />}
      disabled={!dirty}
      onClick={() => void saveGeometry()}
      aria-label={m.workshop_bin_map_geometry_save_action()}
    >
      {m.workshop_bin_map_geometry_save_label()}
    </Button>
  );
}

interface VariantMenuProps {
  readonly variants: readonly MapVariant[];
  readonly chosen: MapVariant;
  readonly onPick: (map: MapPath) => void;
}

/** Which skin of a map the preview draws, named on a pill over a menu of them all. */
function VariantMenu({ variants, chosen, onPick }: VariantMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="xs"
            aria-label={m.workshop_bin_map_preview_skin_label()}
            right={<CaretDownIcon weight="bold" className="size-3" />}
          >
            {variantLabel(chosen)}
          </Button>
        }
      />
      {/* A map lists up to 37 skins, more than a menu shows without scrolling. */}
      <Menu.Content
        align="start"
        data-ui="MapSkinMenu"
        className="max-h-96 w-56 overflow-y-auto scrollbar-md"
      >
        <Menu.RadioGroup value={chosen.map} onValueChange={(map) => onPick(map as MapPath)}>
          {variants.map((variant) => (
            <Menu.RadioItem key={`${variant.skin}:${variant.map}`} value={variant.map}>
              {variantLabel(variant)}
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </Menu.Content>
    </Menu.Root>
  );
}

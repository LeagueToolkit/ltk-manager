import {
  CaretDownIcon,
  CubeFocusIcon,
  ExportIcon,
  EyeIcon,
  FilePlusIcon,
  FloppyDiskIcon,
  MagnetIcon,
  MagnetStraightIcon,
  RulerIcon,
} from "@phosphor-icons/react";
import { type RefObject, useRef } from "react";

import { Button, IconButton, Menu } from "@/components";
import { m } from "@/i18n";
import type { MapPath, MapVariant } from "@/lib/tauri";
import { CommandMenuItems } from "@/modules/editor";
import { shortcutOf } from "@/modules/keys";
import { type BackdropSource, type CaptureFrame, offeredViewMode } from "@/modules/viewport";
import { usePreviewNavGrid, usePreviewViewMode } from "@/stores";

import { usePaneCommands } from "../../menus/state/paneCommands";
import { BackgroundControl } from "../../shared/preview/BackgroundControl";
import { CameraMenu } from "../../shared/preview/CameraMenu";
import { CaptureButton } from "../../shared/preview/CaptureButton";
import { ViewModeMenu } from "../../shared/preview/ViewModeMenu";
import {
  ControlDivider,
  FitButton,
  RailSpacer,
  ViewportRail,
} from "../../shared/preview/ViewportControls";
import { useMapGuideEntries } from "../hooks/useMapGuideEntries";
import { useMapShowEntries } from "../hooks/useMapShowEntries";
import { useMeshExport } from "../hooks/useMeshFiles";
import type { NavGridView } from "../hooks/useNavGrid";
import { useMapScene } from "../state/mapScene";
import { MAP_PANE_COMMANDS } from "../utils/mapCommands";
import { MAP_KEYS } from "../utils/mapKeys";
import { MAP_TOOLS } from "../utils/mapTools";
import { variantLabel } from "../utils/mapVariants";
import { ConformanceControl } from "./ConformanceControl";
import { NavCutoffControl } from "./NavCutoffControl";
import { BoxSelectButton, type PlaceablePicking } from "./PlaceablePicking";
import { PlaceMenu } from "./PlaceMenu";
import { PostEffectsControl } from "./PostEffectsControl";
import { SunControl } from "./SunControl";

/** Presses the first button inside `box`, which is the trigger of the popover it holds. */
function pressTrigger(box: HTMLElement | null): void {
  box?.querySelector("button")?.click();
}

export interface ToolRailProps {
  readonly picking: PlaceablePicking;
  /** The navgrid that Guides snapping reads has arrived. */
  readonly navGridLoaded: boolean;
}

/**
 * The tool rail down the viewport's left edge: the tools of an editable map, one pressed at a
 * time, the box select, and the gizmo's axes, grid snap and Guides snap. A read-only map shows
 * only the box select. Per "Tools" in docs/ux/MAP_EDITOR.md.
 */
export function ToolRail({ picking, navGridLoaded }: ToolRailProps) {
  const { tool, setTool, space, setSpace, snap, setSnap, editable } = useMapScene();
  const { guideSnap, setGuideSnap } = useMapScene();
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
          <IconButton
            pressed={guideSnap && navGridLoaded}
            disabled={!navGridLoaded}
            icon={<MagnetStraightIcon />}
            onClick={() => setGuideSnap(!guideSnap)}
            label={m.workshop_bin_map_tool_guide_snap_label()}
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
  /** The navigation grid of the shown map state, which the Conformance control checks. */
  readonly navGrid: NavGridView | null;
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
  navGrid,
}: TopRailProps) {
  const { editable, tool, geometryDocument, backdrop } = useMapScene();
  const hasNavGrid = backdrop.navGrid !== null;
  const conformance = offeredViewMode(usePreviewViewMode(), hasNavGrid) === "conformance";
  const navShown = usePreviewNavGrid() && hasNavGrid;
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
      <RailSpacer />
      <ShowMenu picking={picking} />
      <GuidesMenu />
      {navShown && <NavCutoffControl />}
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
      <ViewModeMenu navGrid={hasNavGrid} />
      {conformance && <ConformanceControl source={source} navGrid={navGrid} />}
      <CameraMenu />
      <FitButton label={m.workshop_bin_menu_map_frame_map_action()} onFit={onFrame} />
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

/** The guides the viewport draws over the map, left out while the map has none. */
function GuidesMenu() {
  const entries = useMapGuideEntries();
  if (entries.length === 0) return null;

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="xs"
            left={<RulerIcon weight="bold" />}
            right={<CaretDownIcon weight="bold" className="size-3" />}
          >
            {m.workshop_bin_map_guides_label()}
          </Button>
        }
      />
      <Menu.Content align="end" data-ui="MapGuidesMenu" className="w-52">
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
      aria-label={m.workshop_bin_map_geometry_save_action({ key: shortcutOf("editor.save") })}
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

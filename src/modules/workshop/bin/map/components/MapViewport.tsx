import {
  CaretDownIcon,
  CastleTurretIcon,
  CloudSunIcon,
  FrameCornersIcon,
  SparkleIcon,
} from "@phosphor-icons/react";
import { useCallback, useMemo, useState } from "react";

import { Button, HexshadeIcon, IconButton, Menu, Tooltip } from "@/components";
import { m } from "@/i18n";
import type { AssetRef, BinDocumentId, MapPath, MapVariant } from "@/lib/tauri";
import {
  type Bounds,
  FitCamera,
  useBackdropFlags,
  useSceneColors,
  Viewport,
} from "@/modules/viewport";
import {
  usePreviewAmbientOcclusion,
  usePreviewAntiAliasing,
  usePreviewBackdropParticles,
  usePreviewBackdropSky,
  usePreviewBackdropStructures,
  usePreviewCamera,
  usePreviewPostEffects,
  usePreviewShaders,
  usePreviewSun,
  usePreviewViewMode,
  usePreviewWireOverlay,
  useSetPreviewDisplay,
} from "@/stores";

import { CameraMenu } from "../../vfx/preview/components/CameraMenu";
import { Notice } from "../../vfx/preview/components/Notice";
import { ViewModeMenu } from "../../vfx/preview/components/ViewModeMenu";
import { ViewToggle } from "../../vfx/preview/components/ViewToggle";
import { Passes } from "../../vfx/rendering/components/Passes";
import { passesOf } from "../../vfx/rendering/utils/passes";
import { useMapParticles } from "../hooks/useMapParticles";
import { useMapScene } from "../state/mapScene";
import { variantLabel } from "../utils/mapVariants";
import { BackdropLayerMenu } from "./BackdropLayerMenu";
import { MapCharacters } from "./MapCharacters";
import { MapFocus } from "./MapFocus";
import { MapParticles } from "./MapParticles";
import { PostEffectsControl } from "./PostEffectsControl";
import { SunControl } from "./SunControl";

/**
 * What a free camera frames of a map, around where the middle of the map stands.
 *
 * A lane across with room over it. A whole map is past what the free presets dolly out
 * to, and the match camera frames nothing, standing a distance of its own off the point.
 */
const MAP_FRAME: Bounds = { min: [-1500, 0, -1500], max: [1500, 600, 1500] };

export interface MapViewportProps {
  /**
   * An open document of the project whose layer answers the map's materials first, and
   * null for a scene opened off a file, which resolves through the map's own open bin.
   */
  readonly document: BinDocumentId | null;
}

/**
 * The map a `Map`, a `MapSkin` or a `MapContainer` draws, with what it plays and stands.
 *
 * A `Map` draws one of the skins it lists, which the reader picks between. Which one, and
 * what the outliner hid and sent the camera to, is the `MapSceneHost` above it.
 */
export default function MapViewport({ document }: MapViewportProps) {
  const { variants, failed, chosen, located, geometry, hasMaterials, materials } = useMapScene();
  const resolver = document ?? materials;

  if (failed) return <Notice text={m.workshop_bin_map_preview_failed_empty()} />;
  if (variants === undefined) return <Notice text={m.workshop_bin_map_preview_loading_label()} />;
  if (chosen === null) return <Notice text={m.workshop_bin_map_preview_missing_empty()} />;
  /* The materials read is keyed on the document it resolves through, so the scene waits
     for the one it will keep rather than reading them twice. */
  if (!located || (hasMaterials && resolver === null)) {
    return <Notice text={m.workshop_bin_map_preview_loading_label()} />;
  }
  if (geometry === null) return <Notice text={m.workshop_bin_map_preview_no_geometry_empty()} />;
  return <MapScene document={resolver} geometry={geometry} variants={variants} chosen={chosen} />;
}

interface MapSceneProps {
  readonly document: BinDocumentId | null;
  /** The chosen variant's `.mapgeo`, wherever the scene found it. */
  readonly geometry: AssetRef;
  readonly variants: readonly MapVariant[];
  readonly chosen: MapVariant;
}

function MapScene({ document, geometry, variants, chosen }: MapSceneProps) {
  const { near, pick, materials, hidden, focus } = useMapScene();
  const colors = useSceneColors();
  const shaders = usePreviewShaders();
  const source = useMemo(
    () => ({ map: chosen.map, document, geometry, shaders }),
    [chosen.map, document, geometry, shaders],
  );

  const camera = usePreviewCamera();
  const antiAliasing = usePreviewAntiAliasing();
  const viewMode = usePreviewViewMode();
  const wireOverlay = usePreviewWireOverlay();
  const particles = usePreviewBackdropParticles();
  const structures = usePreviewBackdropStructures();
  const sky = usePreviewBackdropSky();
  const sun = usePreviewSun();
  const postEffects = usePreviewPostEffects();
  const ambientOcclusion = usePreviewAmbientOcclusion();
  const setDisplay = useSetPreviewDisplay();
  const { layers, flags, setLayer } = useBackdropFlags(source);

  const [origin, setOrigin] = useState<readonly [number, number, number] | null>(null);
  const played = useMapParticles(particles ? materials : null, flags, hidden);
  const { warps, softens } = useMemo(() => passesOf(played.map((group) => group.system)), [played]);

  const [fitToken, setFitToken] = useState(0);
  const refit = useCallback(() => setFitToken((token) => token + 1), []);

  return (
    <>
      <div data-ui="MapViewport" className="relative min-h-0 flex-1">
        <Viewport
          antiAliasing={antiAliasing}
          renderer="shared"
          stage={false}
          textured={false}
          backdrop={source}
          backdropFlags={flags}
          backdropSky={sky}
          sun={sun}
          postEffects={postEffects}
          ambientOcclusion={ambientOcclusion}
          camera={camera}
          viewMode={viewMode}
          wireOverlay={wireOverlay}
          onCameraStand={(preset) => setDisplay({ previewCamera: preset })}
          onBackdropOrigin={setOrigin}
        >
          {origin !== null && <FitCamera bounds={MAP_FRAME} ground={origin} token={fitToken} />}
          <Passes warps={warps} softens={softens} />
          <MapParticles groups={played} />
          {structures && (
            <MapCharacters document={materials} near={near} flags={flags} hidden={hidden} />
          )}
          <MapFocus focus={focus} colors={colors} />
        </Viewport>
        {origin === null && (
          <div className="pointer-events-none absolute inset-0 flex">
            <Notice text={m.workshop_bin_map_preview_loading_label()} />
          </div>
        )}

        <div
          data-ui="MapViewport:controls"
          /* DS-GLASS, DS-RADIUS, DS-VEIL. The descendant selector outranks the size of each button. */
          className="absolute top-2 right-2 flex items-center gap-1 rounded-md border border-surface-veil bg-scrim p-0.5 shadow-md backdrop-blur-sm [&_button]:text-meta"
        >
          {variants.length > 1 && <VariantMenu variants={variants} chosen={chosen} onPick={pick} />}
          <ViewToggle
            label={m.workshop_bin_preview_backdrop_particles_label()}
            active={particles}
            icon={<SparkleIcon weight="bold" className="h-4 w-4" />}
            onClick={() => setDisplay({ previewBackdropParticles: !particles })}
          />
          <ViewToggle
            label={m.workshop_bin_preview_backdrop_structures_label()}
            active={structures}
            icon={<CastleTurretIcon weight="bold" className="h-4 w-4" />}
            onClick={() => setDisplay({ previewBackdropStructures: !structures })}
          />
          <ViewToggle
            label={m.workshop_bin_preview_backdrop_sky_label()}
            active={sky}
            icon={<CloudSunIcon weight="bold" className="h-4 w-4" />}
            onClick={() => setDisplay({ previewBackdropSky: !sky })}
          />
          <ViewToggle
            label={m.workshop_bin_preview_shaders_label()}
            active={shaders}
            icon={<HexshadeIcon className={shaders ? "h-4 w-4" : "h-4 w-4 grayscale"} />}
            onClick={() => setDisplay({ previewShaders: !shaders })}
          />
          <BackdropLayerMenu layers={layers} flags={flags} onLayerChange={setLayer} />
          <SunControl source={source} />
          <PostEffectsControl source={source} />
          <ViewModeMenu />
          <CameraMenu />
          <Tooltip content={m.workshop_bin_mesh_preview_fit_action()}>
            <IconButton
              variant="ghost"
              size="xs"
              compact
              aria-label={m.workshop_bin_mesh_preview_fit_action()}
              icon={<FrameCornersIcon weight="bold" className="h-4 w-4" />}
              onClick={refit}
            />
          </Tooltip>
        </div>
      </div>
    </>
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
            compact
            aria-label={m.workshop_bin_map_preview_skin_label()}
            right={<CaretDownIcon weight="bold" className="h-3 w-3" />}
          >
            {variantLabel(chosen)}
          </Button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner align="end">
          {/* A map lists up to 37 skins, more than a menu shows without scrolling. */}
          <Menu.Popup data-ui="MapSkinMenu" className="max-h-96 w-56 overflow-y-auto scrollbar-md">
            <Menu.RadioGroup value={chosen.map} onValueChange={(map) => onPick(map as MapPath)}>
              {variants.map((variant) => (
                <Menu.RadioItem key={`${variant.skin}:${variant.map}`} value={variant.map}>
                  {variantLabel(variant)}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

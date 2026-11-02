import { m } from "@/i18n";
import type { CommandMenuEntry } from "@/modules/editor";
import { type PreviewDisplay, usePreviewFlag, useSetPreviewDisplay } from "@/stores";

import { useMapScene } from "../state/mapScene";

/**
 * Returns what the viewport draws besides the map as switches, for the Show menu and the menu bar.
 *
 * `markersShown` is true while the markers draw, and `onHideMarkers` ends the box tool that also
 * draws them.
 */
export function useMapShowEntries(
  markersShown: boolean,
  onHideMarkers: () => void,
): CommandMenuEntry[] {
  const { setMarkers } = useMapScene();
  const particles = usePreviewFlag("previewBackdropParticles");
  const structures = usePreviewFlag("previewBackdropStructures");
  const sky = usePreviewFlag("previewBackdropSky");
  const shaders = usePreviewFlag("previewShaders");
  const events = usePreviewFlag("previewBackdropEvents");
  const regions = usePreviewFlag("previewMapRegions");
  const setDisplay = useSetPreviewDisplay();

  const check = (
    id: string,
    title: string,
    checked: boolean,
    next: Partial<PreviewDisplay>,
  ): CommandMenuEntry => ({
    kind: "check",
    id: `map.show.${id}`,
    title,
    checked,
    run: () => setDisplay(next),
  });

  return [
    check("particles", m.workshop_bin_preview_backdrop_particles_label(), particles, {
      previewBackdropParticles: !particles,
    }),
    check("structures", m.workshop_bin_preview_backdrop_structures_label(), structures, {
      previewBackdropStructures: !structures,
    }),
    check("sky", m.workshop_bin_preview_backdrop_sky_label(), sky, { previewBackdropSky: !sky }),
    check("shaders", m.workshop_bin_preview_shaders_label(), shaders, { previewShaders: !shaders }),
    check("events", m.workshop_bin_preview_backdrop_events_label(), particles && events, {
      previewBackdropParticles: true,
      previewBackdropEvents: !events,
    }),
    { kind: "separator" },
    check("regions", m.workshop_bin_map_regions_label(), regions, {
      previewMapRegions: !regions,
    }),
    {
      kind: "check",
      id: "map.show.markers",
      title: m.workshop_bin_map_markers_label(),
      checked: markersShown,
      run: () => {
        setMarkers(!markersShown);
        if (markersShown) onHideMarkers();
      },
    },
  ];
}

import { useMemo } from "react";

import { useSceneColors } from "@/modules/viewport";
import type { PreviewWireframe } from "@/stores";

import { AttachedMeshes } from "./AttachedMeshes";
import { Beams } from "./Beams";
import type { DrawnEmitter } from "./definitions";
import {
  drawsAsBeam,
  drawsAsMesh,
  drawsAsQuad,
  drawsAsTrail,
  drawsTheAttachment,
} from "./drawKind";
import type { Driver } from "./driver";
import { Meshes } from "./Meshes";
import type { Source } from "./particleRead";
import { Quads } from "./Quads";
import { Trails } from "./Trails";
import type { EmitterMeshes } from "./useVfxMeshes";
import { samplersOf, type VfxTextures } from "./useVfxTextures";
import { WireframeContext } from "./wire";

export interface VfxSystemProps {
  /** Every emitter of the system and its children, from `drawnEmitters`. */
  readonly drawn: readonly DrawnEmitter[];
  /** The simulation whose pools the emitters draw. */
  readonly driver: Driver;
  readonly textures: VfxTextures;
  readonly meshes: EmitterMeshes;
  /** An emitter the draw leaves out, such as every one but the emitter soloed. */
  readonly hiddenOf?: (definition: DrawnEmitter) => boolean;
  /** Whether the emitters draw shaded, as their edges, or their edges over the shading. */
  readonly wireframe?: PreviewWireframe;
}

/**
 * One particle system's emitters drawn from its driver's pools, inside any scene.
 *
 * The clock is the owner's, so the shell's run and a character wearing several systems
 * spend time on their drivers each in their own way (ADR-0037).
 */
export function VfxSystem({
  drawn,
  driver,
  textures,
  meshes,
  hiddenOf = noneHidden,
  wireframe = "off",
}: VfxSystemProps) {
  const rootSources = useMemo(() => [driver], [driver]);
  const sourcesOf = (definition: DrawnEmitter): readonly Source[] =>
    definition.path === "" ? rootSources : driver.sources(definition.path);
  const { wire: colour } = useSceneColors();
  const wire = useMemo(() => ({ mode: wireframe, colour }), [wireframe, colour]);

  return (
    <WireframeContext value={wire}>
      {drawn
        .filter((definition) => drawsAsQuad(definition.emitter))
        .map((definition) => (
          <Quads
            key={definition.key}
            emitter={definition.emitter}
            sources={sourcesOf(definition)}
            samplers={samplersOf(textures, definition)}
            rank={definition.rank}
            hidden={hiddenOf(definition)}
          />
        ))}
      {drawn
        .filter((definition) => drawsAsTrail(definition.emitter))
        .map((definition) => (
          <Trails
            key={definition.key}
            emitter={definition.emitter}
            sources={sourcesOf(definition)}
            samplers={samplersOf(textures, definition)}
            rank={definition.rank}
            hidden={hiddenOf(definition)}
          />
        ))}
      {drawn
        .filter((definition) => drawsAsBeam(definition.emitter))
        .map((definition) => (
          <Beams
            key={definition.key}
            emitter={definition.emitter}
            sources={sourcesOf(definition)}
            samplers={samplersOf(textures, definition)}
            rank={definition.rank}
            hidden={hiddenOf(definition)}
          />
        ))}
      {drawn
        .filter((definition) => drawsAsMesh(definition.emitter))
        .map((definition) => {
          const buffers = meshes.get(definition.key);
          if (buffers === undefined) return null;
          return (
            <Meshes
              key={definition.key}
              emitter={definition.emitter}
              sources={sourcesOf(definition)}
              buffers={buffers}
              samplers={samplersOf(textures, definition)}
              rank={definition.rank}
              hidden={hiddenOf(definition)}
            />
          );
        })}
      {drawn
        .filter((definition) => drawsTheAttachment(definition.emitter))
        .map((definition) => (
          <AttachedMeshes
            key={definition.key}
            emitter={definition.emitter}
            sources={sourcesOf(definition)}
            samplers={samplersOf(textures, definition)}
            rank={definition.rank}
            hidden={hiddenOf(definition)}
          />
        ))}
    </WireframeContext>
  );
}

function noneHidden(): boolean {
  return false;
}

import { Grid } from "@react-three/drei";
import { useLayoutEffect, useMemo, useRef } from "react";
import type { Mesh } from "three";

import type { SceneColors } from "./sceneColors";
import { useGroundTexture } from "./useGroundTexture";
import { CHAMPION_HEIGHT, GROUND_LEVEL, UNITS_PER_METRE } from "./world";

/** How far the ground reaches, which is what a champion-scale effect plays out over. */
const GROUND = CHAMPION_HEIGHT * 16;

/** One grid cell, a metre of engine units, so the ground reads at a known scale. */
const CELL = UNITS_PER_METRE;

/** A heavier line every five metres, which is what the eye counts cells against. */
const SECTION = CELL * 5;

/** The ground a hair below zero, so its own fill never fights the grid drawn on it. */
const GROUND_DROP = -0.5;

/**
 * How far the grid reads, which is enough to place a particle and no more.
 *
 * The stage is a reference the effect is read against, so the lines sit at the edge of
 * being made out and the particles are what the eye lands on. The share is mixed into
 * the line's colour, since the grid's shader owns its own alpha.
 */
const GRID_READ = 0.3;

/** How steeply the grid fades toward the ground's edge, so no corner is drawn. */
const GRID_FADE = 1.5;

/**
 * The ground and the grid the effect plays over.
 *
 * A plane at champion scale rather than a host model, per decision 2.7 of
 * docs/plans/vfx-particle-renderer.md. Its height is what `isFollowingTerrain` reads, so
 * a reader who hides it is hiding a reference rather than changing the simulation.
 */
export function Stage({
  colors,
  shown,
  textured,
}: {
  colors: SceneColors;
  shown: boolean;
  textured: boolean;
}) {
  const midlane = useGroundTexture();
  const ground = textured ? midlane : null;

  if (!shown) return null;

  return (
    <group>
      <mesh position={[0, GROUND_LEVEL + GROUND_DROP, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[GROUND, GROUND]} />
        {/* The token fill is what an install missing the map's kit piece draws.

            A material compiled with no map keeps that program when one arrives, because
            three recompiles on its own version rather than on the assignment, so the key
            builds a second material instead of leaving the ground on a flat fill. */}
        <meshBasicMaterial
          key={ground === null ? "flat" : "textured"}
          map={ground}
          color={ground === null ? colors.ground : LIT}
        />
      </mesh>

      <MetreGrid colors={colors} />
    </group>
  );
}

/** White, so a textured ground draws its own pixels rather than a tint of them. */
const LIT = 0xffffff;

/** A metre grid over the ground, fading out before the ground's edge. */
function MetreGrid({ colors }: { colors: SceneColors }) {
  const grid = useRef<Mesh>(null);
  const cell = useMemo(() => colors.ground.clone().lerp(colors.grid, GRID_READ), [colors]);
  const section = useMemo(() => colors.ground.clone().lerp(colors.gridMajor, GRID_READ), [colors]);

  /* Blended over whatever is under it and writing no depth, so a particle on the ground
     is never cut by a line it stands across. */
  useLayoutEffect(() => {
    const material = grid.current?.material;
    if (material !== undefined && !Array.isArray(material)) material.depthWrite = false;
  });

  return (
    <Grid
      ref={grid}
      args={[GROUND, GROUND]}
      cellSize={CELL}
      sectionSize={SECTION}
      cellColor={cell}
      sectionColor={section}
      fadeDistance={GROUND / 2}
      fadeStrength={GRID_FADE}
      fadeFrom={0}
    />
  );
}

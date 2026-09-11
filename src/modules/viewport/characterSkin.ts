import { createContext, use } from "react";
import type { BufferGeometry, Skeleton } from "three";

import type { MeshRange } from "./meshBuffer";

/** A posed character's skin, as a draw that shares it reads it. */
export interface CharacterSkin {
  readonly geometry: BufferGeometry;
  /** The skeleton the character poses every frame, whose bones stand in the scene's space. */
  readonly skeleton: Skeleton;
  /** Every submesh of the mesh, one geometry group each, in the geometry's order. */
  readonly ranges: readonly MeshRange[];
  /** The submeshes the character is drawn without, matched without regard to case. */
  readonly hidden: readonly string[];
}

/** The skin of the character a scene draws, and null in a scene drawing none. */
export const CharacterSkinContext = createContext<CharacterSkin | null>(null);

/** The skin of the character wearing whatever calls it, and null where no character does. */
export function useCharacterSkin(): CharacterSkin | null {
  return use(CharacterSkinContext);
}

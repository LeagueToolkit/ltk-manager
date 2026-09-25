import {
  CubeTexture,
  Data3DTexture,
  DataArrayTexture,
  DataTexture,
  NearestFilter,
  RedIntegerFormat,
  type Texture,
  UnsignedIntType,
} from "three";

import type { TextureDimension } from "@/lib/tauri";

/** An opaque mid-grey, drawn for a material texture nothing holds. */
export const GREY: readonly [number, number, number, number] = [128, 128, 128, 255];

const WHITE: readonly [number, number, number, number] = [255, 255, 255, 255];

/** Transparent black, which a remap ramp of alpha zero leaves colour alone. */
export const BLACK: readonly [number, number, number, number] = [0, 0, 0, 0];

const neutrals = new Map<string, Texture>();

/** One transparent black texel, bound where an asset has no mask texture. */
export function blackTexel(): Texture {
  return neutral("texture2d", BLACK);
}

/** One opaque white texel, the engine's texture for a slot a particle names nothing for. */
export function whiteTexel(): Texture {
  return neutral("texture2d", WHITE);
}

/** A cube of transparent black, which a reflection with no map reflects. */
export function blackCube(): Texture {
  return neutral("cube", BLACK);
}

/** One texel of `rgba` in the shape `dimension` samples, made once per shape and colour. */
export function neutral(
  dimension: TextureDimension,
  rgba: readonly [number, number, number, number],
): Texture {
  const key = `${dimension}:${rgba.join(",")}`;
  const found = neutrals.get(key);
  if (found !== undefined) return found;
  const made = texel(dimension, rgba);
  made.needsUpdate = true;
  neutrals.set(key, made);
  return made;
}

function texel(
  dimension: TextureDimension,
  rgba: readonly [number, number, number, number],
): Texture {
  const bytes = new Uint8Array(rgba);
  switch (dimension) {
    case "texture2dArray":
      return new DataArrayTexture(bytes, 1, 1, 1);
    case "cubeArray":
      return new DataArrayTexture(
        new Uint8Array([...rgba, ...rgba, ...rgba, ...rgba, ...rgba, ...rgba]),
        1,
        1,
        6,
      );
    case "texture3d":
      return new Data3DTexture(bytes, 1, 1, 1);
    case "cube": {
      const face = () => {
        const held = new DataTexture(bytes, 1, 1);
        held.needsUpdate = true;
        return held;
      };
      return new CubeTexture([face(), face(), face(), face(), face(), face()]);
    }
    case "buffer": {
      const held = new DataTexture(new Uint32Array([0]), 1, 1, RedIntegerFormat, UnsignedIntType);
      held.magFilter = NearestFilter;
      held.minFilter = NearestFilter;
      return held;
    }
    default:
      return new DataTexture(bytes, 1, 1);
  }
}

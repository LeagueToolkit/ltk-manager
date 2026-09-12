import { Texture } from "three";
import { describe, expect, it } from "vitest";

import type { NamedAsset } from "@/lib/tauri";

import type { DrawnEmitter } from "../definitions";
import type { EmitterModel } from "../model";
import {
  type EmitterSamplers,
  NO_SAMPLERS,
  samplersOf,
  UNNAMED_SAMPLERS,
  type VfxTextures,
} from "../useVfxTextures";

function loaded(entries: readonly (readonly [string, EmitterSamplers])[] = []): VfxTextures {
  return new Map(entries);
}

function drawn(key: string, texture: NamedAsset | null): DrawnEmitter {
  return { key, emitter: { texture } as EmitterModel } as DrawnEmitter;
}

const SPARK: NamedAsset = { path: "assets/spark.dds", asset: null };

describe("samplersOf", () => {
  it("binds the engine's 1x1 transparent black where the emitter names no texture", () => {
    /* `Ahri_Skin89_E_mis`'s `HeadButterfly1`, an `add` quad 450 units wide that carries
       only its children. */
    const held = samplersOf(loaded(), drawn("0", null));

    expect(held).toBe(UNNAMED_SAMPLERS);
    expect(held.base?.image).toMatchObject({ width: 1, height: 1, data: new Uint8Array(4) });
  });

  it("waits on a named texture until it arrives", () => {
    expect(samplersOf(loaded(), drawn("0", SPARK))).toBe(NO_SAMPLERS);
  });

  it("takes a named texture once it has arrived", () => {
    const own = new Texture();
    const bundle: EmitterSamplers = { ...NO_SAMPLERS, base: own };

    expect(samplersOf(loaded([["0", bundle]]), drawn("0", SPARK)).base).toBe(own);
  });
});

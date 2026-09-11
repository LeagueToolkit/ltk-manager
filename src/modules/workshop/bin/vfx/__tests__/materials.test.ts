import {
  AddEquation,
  BufferGeometry,
  Color,
  CubeTexture,
  CustomBlending,
  DstAlphaFactor,
  FrontSide,
  MaxEquation,
  MinEquation,
  NoBlending,
  OneFactor,
  OneMinusDstAlphaFactor,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
  SrcAlphaFactor,
  Texture,
  ZeroFactor,
} from "three";
import { describe, expect, it } from "vitest";

import { mirrorInto, standingInto } from "../basis";
import { blendState, drawState, fragmentTests, premultiplyInto, sortsBackToFront } from "../blend";
import { meshBuffers, MESHES_PER_EMITTER, quadBuffers } from "../buffers";
import {
  BLEND_MODE,
  type BlendMode,
  MISC_RENDER_FLAG,
  QUAD_TYPE,
  type QuadType,
  SIMPLE_ORIENTATION,
  UV_MODE,
  type UvMode,
} from "../enums";
import {
  attachedMaterial,
  meshMaterial,
  quadMaterial,
  type QuadOrientation,
  ribbonMaterial,
  wireMaterial,
} from "../materials";
import {
  type DistortionModel,
  type EmitterModel,
  type ErosionModel,
  type PaletteModel,
  plainUvLayer,
  type ReflectionModel,
} from "../model";
import { ARBITRARY_UV } from "../shaders/quad";
import { fadeOf } from "../softParticle";
import { colorDefines, type DepthOffset, layersOf, type QuadLayers } from "../uniforms";
import { geometryOf } from "../useVfxMeshes";
import type { EmitterSamplers } from "../useVfxTextures";

const EVERY_MODE = Object.values(BLEND_MODE) as BlendMode[];

/** A quad at no depth offset, facing the eye. */
const FLAT: DepthOffset = { bias: [0, 0], pushPull: 0 };
const BILLBOARD: QuadOrientation = {
  billboard: true,
  ray: false,
  plane: SIMPLE_ORIENTATION.camera,
  unitQuad: false,
  pivotUp: false,
};

describe("blendState", () => {
  it("gives every mode of the enum a state", () => {
    expect(EVERY_MODE).toHaveLength(9);
    for (const mode of EVERY_MODE) expect(blendState(mode)).toBeDefined();
  });

  it("writes no depth for a blended mode and writes it for the one that does not blend", () => {
    for (const mode of EVERY_MODE) {
      const expected = mode === BLEND_MODE.none;
      expect(blendState(mode).depthWrite).toBe(expected);
      expect(blendState(mode).transparent).toBe(!expected);
    }
  });

  it("leaves the blend off for NONE", () => {
    expect(blendState(BLEND_MODE.none).blending).toBe(NoBlending);
  });

  it("carries its own factors for every mode that blends", () => {
    for (const mode of EVERY_MODE) {
      if (mode === BLEND_MODE.none) continue;
      expect(blendState(mode).blending).toBe(CustomBlending);
    }
  });

  it("scales the colour by the alpha for ALPHA_ADD and takes it whole for ADD", () => {
    expect(blendState(BLEND_MODE.add).blendSrc).toBe(OneFactor);
    expect(blendState(BLEND_MODE.add).blendDst).toBe(OneFactor);
    expect(blendState(BLEND_MODE.alphaAdd).blendSrc).toBe(SrcAlphaFactor);
    expect(blendState(BLEND_MODE.alphaAdd).blendDst).toBe(OneFactor);
  });

  it("darkens for SUBTRACT and lays TARGET_ALPHA under what is already drawn", () => {
    const subtract = blendState(BLEND_MODE.subtract);
    expect([subtract.blendSrc, subtract.blendDst]).toEqual([ZeroFactor, OneMinusSrcColorFactor]);
    expect(subtract.blendEquation).toBe(AddEquation);

    const target = blendState(BLEND_MODE.targetAlpha);
    expect([target.blendSrc, target.blendDst]).toEqual([OneMinusDstAlphaFactor, DstAlphaFactor]);
    expect([target.blendSrcAlpha, target.blendDstAlpha]).toEqual([OneFactor, OneFactor]);
  });

  it("takes the equation the mode is named for", () => {
    expect(blendState(BLEND_MODE.min).blendEquation).toBe(MinEquation);
    expect(blendState(BLEND_MODE.max).blendEquation).toBe(MaxEquation);
    expect(blendState(BLEND_MODE.add).blendEquation).toBe(AddEquation);
  });

  it("falls back to the default for a mode outside the enum", () => {
    expect(blendState(99 as BlendMode)).toEqual(blendState(BLEND_MODE.add));
  });
});

describe("drawState", () => {
  it("takes the emitter's own blend mode where it draws colour", () => {
    for (const mode of EVERY_MODE) expect(drawState(mode, false)).toEqual(blendState(mode));
  });

  it("lays a distorting emitter back over the frame whatever mode it names", () => {
    for (const mode of EVERY_MODE) {
      const state = drawState(mode, true);
      expect(state.blending).toBe(CustomBlending);
      expect([state.blendSrc, state.blendDst]).toEqual([SrcAlphaFactor, OneMinusSrcAlphaFactor]);
      expect(state.blendEquation).toBe(AddEquation);
      expect(state.depthWrite).toBe(false);
    }
  });
});

describe("premultiplyInto", () => {
  const emitterOf = (blendMode: BlendMode, distortion: DistortionModel | null = null) =>
    ({ blendMode, distortion }) as EmitterModel;
  const drawn = (emitter: EmitterModel) => {
    const color = Float32Array.of(0.5, 0.25, 1, 0.5);
    premultiplyInto(emitter, color);
    return [...color];
  };

  it("weighs the colour by its alpha and makes the alpha whole under ADD and SUBTRACT", () => {
    expect(drawn(emitterOf(BLEND_MODE.add))).toEqual([0.25, 0.125, 0.5, 1]);
    expect(drawn(emitterOf(BLEND_MODE.subtract))).toEqual([0.25, 0.125, 0.5, 1]);
  });

  it("leaves the colour of every other mode as it is", () => {
    for (const mode of EVERY_MODE) {
      if (mode === BLEND_MODE.add || mode === BLEND_MODE.subtract) continue;
      expect(drawn(emitterOf(mode))).toEqual([0.5, 0.25, 1, 0.5]);
    }
  });

  it("leaves the colour of a distorting emitter as it is, whose alpha is the warp's mask", () => {
    expect(drawn(emitterOf(BLEND_MODE.add, {} as DistortionModel))).toEqual([0.5, 0.25, 1, 0.5]);
  });
});

describe("fragmentTests", () => {
  function stateOf(alphaRef: number, miscRenderFlags: number): EmitterModel {
    return { alphaRef, miscRenderFlags } as EmitterModel;
  }

  it("tests depth unless DISABLE_ZBUFFER is set, whatever else is", () => {
    expect(fragmentTests(stateOf(0, 0)).depthTest).toBe(true);
    expect(fragmentTests(stateOf(0, MISC_RENDER_FLAG.disableFow)).depthTest).toBe(true);
    expect(fragmentTests(stateOf(0, MISC_RENDER_FLAG.disableZBuffer)).depthTest).toBe(false);
    expect(fragmentTests(stateOf(0, 7)).depthTest).toBe(false);
  });

  it("carries the alpha cutoff through as it is", () => {
    expect(fragmentTests(stateOf(0.2, 0)).alphaRef).toBe(0.2);
    expect(fragmentTests(stateOf(0, 0)).alphaRef).toBe(0);
  });
});

describe("sortsBackToFront", () => {
  it("sorts the modes that read the target and leaves the order-independent ones alone", () => {
    expect(sortsBackToFront(BLEND_MODE.alpha)).toBe(true);
    expect(sortsBackToFront(BLEND_MODE.premultipliedAlpha)).toBe(true);

    expect(sortsBackToFront(BLEND_MODE.add)).toBe(false);
    expect(sortsBackToFront(BLEND_MODE.min)).toBe(false);
    expect(sortsBackToFront(BLEND_MODE.max)).toBe(false);
    expect(sortsBackToFront(BLEND_MODE.none)).toBe(false);
  });
});

/** One plain layer and nothing else: no mult, ramp, palette, erosion or distortion. */
const PLAIN_LAYERS: QuadLayers = {
  base: plainUvLayer(),
  mult: null,
  multTexture: null,
  mode: UV_MODE.default,
  colorTexture: null,
  palette: null,
  paletteTexture: null,
  erosion: null,
  erosionTexture: null,
  distortion: null,
  normalTexture: null,
  reflection: null,
  reflectionTexture: null,
  soft: null,
};

const PASSING = { alphaRef: 0, depthTest: true };

describe("the rim and the reflection", () => {
  const REFLECTION: ReflectionModel = {
    fresnel: 0.1,
    fresnelColor: [1, 0, 0, 0],
    reflectionFresnel: 0.6,
    reflectionFresnelColor: [1, 1, 1, 1],
    opacityDirect: 0.3,
    opacityGlancing: 0.2,
    map: {
      path: "assets/shared/particles/aatrox_cubemap.dds",
      asset: { kind: "gameChunk", wad: "Aatrox.wad.client", pathHash: "0" },
    },
  };
  const reflecting: QuadLayers = {
    ...PLAIN_LAYERS,
    reflection: REFLECTION,
    reflectionTexture: new CubeTexture(),
  };
  const mesh = (layers: QuadLayers) =>
    meshMaterial(BLEND_MODE.add, null, [0, 0], layers, PASSING, FrontSide);

  it("reaches a mesh by the drawn alpha and an attached mesh by the texel's", () => {
    expect(mesh(reflecting).defines.SHEEN).toBe(1);
    expect(mesh(reflecting).uniforms.fresnel.value).toEqual([1, 0, 0, 0.1]);
    expect(mesh(reflecting).uniforms.reflection.value).toEqual([0.6, 0.3, 0.2, 0]);

    const attached = attachedMaterial(BLEND_MODE.add, null, [0, 0], reflecting, PASSING, FrontSide);
    expect(attached.defines.SHEEN).toBe(2);
  });

  it("draws on no quad, whose shaders compile neither", () => {
    const quad = quadMaterial(BLEND_MODE.add, null, FLAT, BILLBOARD, reflecting, PASSING);
    expect(quad.defines.SHEEN).toBe(0);
    expect(quad.defines).not.toHaveProperty("REFLECTS");
  });

  it("reflects only where a cube map is named and has arrived", () => {
    expect(mesh(reflecting).defines).toHaveProperty("REFLECTS");
    expect(mesh({ ...reflecting, reflectionTexture: null }).defines).not.toHaveProperty("REFLECTS");
    expect(
      mesh({ ...reflecting, reflection: { ...REFLECTION, map: null } }).defines,
    ).not.toHaveProperty("REFLECTS");
  });
});

describe("the soft fade", () => {
  const faded: QuadLayers = {
    ...PLAIN_LAYERS,
    soft: { beginIn: 20, deltaIn: 10, beginOut: 0, deltaOut: 0 },
  };

  it("reaches a quad, a mesh and a ribbon with its packed lanes and the blend's control", () => {
    for (const material of [
      quadMaterial(BLEND_MODE.alpha, null, FLAT, BILLBOARD, faded, PASSING),
      meshMaterial(BLEND_MODE.alpha, null, [0, 0], faded, PASSING, FrontSide),
      ribbonMaterial(BLEND_MODE.alpha, null, [0, 0], faded, PASSING),
    ]) {
      expect(material.defines).toHaveProperty("SOFT");
      expect(material.uniforms.softParams.value).toEqual([20, 30, 0.1, 0]);
      expect(material.uniforms.softControl.value).toEqual([1, 0, 0, 1]);
    }
  });

  it("never reaches an attached mesh, whose skinned shader compiles none", () => {
    const attached = attachedMaterial(BLEND_MODE.add, null, [0, 0], faded, PASSING, FrontSide);
    expect(attached.defines).not.toHaveProperty("SOFT");
  });

  it("stays off for an emitter that fades nothing", () => {
    expect(
      ribbonMaterial(BLEND_MODE.add, null, [0, 0], PLAIN_LAYERS, PASSING).defines,
    ).not.toHaveProperty("SOFT");
  });
});

describe("depthBiasFactors", () => {
  it("reaches a mesh as its polygon offset, and none for a zero pair", () => {
    const biased = meshMaterial(BLEND_MODE.add, null, [2, 3], PLAIN_LAYERS, PASSING, FrontSide);
    expect(biased.polygonOffset).toBe(true);
    expect([biased.polygonOffsetFactor, biased.polygonOffsetUnits]).toEqual([2, 3]);

    const plain = meshMaterial(BLEND_MODE.add, null, [0, 0], PLAIN_LAYERS, PASSING, FrontSide);
    expect(plain.polygonOffset).toBe(false);
  });

  it("reaches a ribbon as its polygon offset, and none for a zero pair", () => {
    const biased = ribbonMaterial(BLEND_MODE.add, null, [-1, -4], PLAIN_LAYERS, PASSING);
    expect(biased.polygonOffset).toBe(true);
    expect([biased.polygonOffsetFactor, biased.polygonOffsetUnits]).toEqual([-1, -4]);

    expect(ribbonMaterial(BLEND_MODE.add, null, [0, 0], PLAIN_LAYERS, PASSING).polygonOffset).toBe(
      false,
    );
  });

  it("replaces an attached mesh's stand-in offset where the emitter authors one", () => {
    const biased = attachedMaterial(
      BLEND_MODE.add,
      null,
      [-2, -8],
      PLAIN_LAYERS,
      PASSING,
      FrontSide,
    );
    expect(biased.polygonOffset).toBe(true);
    expect([biased.polygonOffsetFactor, biased.polygonOffsetUnits]).toEqual([-2, -8]);
  });

  it("keeps an attached mesh in front of its character where the emitter authors none", () => {
    const plain = attachedMaterial(BLEND_MODE.add, null, [0, 0], PLAIN_LAYERS, PASSING, FrontSide);
    expect(plain.polygonOffset).toBe(true);
    expect([plain.polygonOffsetFactor, plain.polygonOffsetUnits]).toEqual([-1, -1]);
  });
});

describe("ribbonMaterial", () => {
  const flat = (...values: number[]) => ({ constant: values, keys: [], tables: [] });
  const RAMP = new Texture();
  const EROSION = {
    map: null,
    addressMode: 0,
    mixer: flat(0, 0, 0, 1),
    drive: flat(0),
    lingerDrive: null,
    driveSource: 0,
    featherIn: 0,
    featherOut: 0,
    sliceWidth: 1,
  } as ErosionModel;

  const definesOf = (layers: QuadLayers) =>
    ribbonMaterial(BLEND_MODE.add, null, [0, 0], layers, PASSING).defines;

  it("reads the colour ramp on the mult layer's uv under one, loaded or not", () => {
    const ramped = { ...PLAIN_LAYERS, colorTexture: RAMP };
    const multiplied = { ...ramped, mult: plainUvLayer(), multTexture: null };

    expect(definesOf(ramped)).toHaveProperty("HAS_RAMP");
    expect(definesOf(ramped)).not.toHaveProperty("RAMP_AT_MULT");
    expect(definesOf(multiplied)).toHaveProperty("HAS_RAMP");
    expect(definesOf(multiplied)).toHaveProperty("RAMP_AT_MULT");
    expect(definesOf(PLAIN_LAYERS)).not.toHaveProperty("HAS_RAMP");
  });

  it("drops the ramp under an erosion, and under a mult layer only where the alpha is locked", () => {
    const ramped = { ...PLAIN_LAYERS, colorTexture: RAMP };

    expect(definesOf({ ...ramped, erosion: EROSION })).not.toHaveProperty("HAS_RAMP");
    expect(definesOf({ ...ramped, mode: UV_MODE.lockAlpha })).toHaveProperty("HAS_RAMP");
    expect(
      definesOf({ ...ramped, mode: UV_MODE.lockAlpha, mult: plainUvLayer() }),
    ).not.toHaveProperty("HAS_RAMP");
  });

  it("draws the mult layer once its texture has arrived", () => {
    const multiplied = { ...PLAIN_LAYERS, mult: plainUvLayer() };

    expect(definesOf({ ...multiplied, multTexture: new Texture() })).toHaveProperty("HAS_MAP_MULT");
    expect(definesOf({ ...multiplied, multTexture: null })).not.toHaveProperty("HAS_MAP_MULT");
  });

  it("draws a palette naming a texture, at its selector's row", () => {
    const palette = {
      texture: null,
      count: 4,
      selector: flat(1),
      scrollU: flat(0),
      scrollV: flat(0),
      mix: flat(1, 0, 0, 0),
      addressMode: 0,
    } as PaletteModel;
    const drawn = ribbonMaterial(
      BLEND_MODE.add,
      null,
      [0, 0],
      { ...PLAIN_LAYERS, palette, paletteTexture: new Texture() },
      PASSING,
    );

    expect(drawn.defines).toHaveProperty("HAS_PALETTE");
    expect(drawn.uniforms.paletteRow.value).toBe(0.375);
    expect(drawn.uniforms.paletteMix.value).toEqual([1, 0, 0, 0]);

    const unloaded = ribbonMaterial(
      BLEND_MODE.add,
      null,
      [0, 0],
      { ...PLAIN_LAYERS, palette },
      PASSING,
    );
    expect(unloaded.defines).not.toHaveProperty("HAS_PALETTE");
  });
});

describe("ARBITRARY_UV", () => {
  /** The corner an arbitrary quad samples texel `uv` at, solving the table's two rows. */
  function cornerAt(u: number, v: number): [number, number] {
    const [[a, b, c], [d, e, f]] = ARBITRARY_UV;
    const det = a * e - b * d;
    return [((u - c) * e - b * (v - f)) / det, (a * (v - f) - (u - c) * d) / det];
  }

  /** Where `local` of a particle turned by `degrees` draws, as the viewport sees it. */
  function turned(degrees: number[], local: number[]): number[] {
    const drawn = new Float32Array(9);
    mirrorInto(standingInto(new Float32Array(degrees), 0, 0, new Float32Array(9)), 0, drawn, 0);
    return [0, 1, 2].map(
      (row) =>
        drawn[row * 3] * local[0] + drawn[row * 3 + 1] * local[1] + drawn[row * 3 + 2] * local[2],
    );
  }

  it("lays Riven_Base_R_Sword's glow over its blade rather than its mirror", () => {
    /* The blade of `exile_new_sword_fit_base_03.scb` bulges toward its own -Z, and the
       glow's silhouette in `sword_profile_glow_02` toward +u. */
    const blade = geometryOf(
      {
        positions: new Float32Array([0, 30, -18, 0, 30, 0, 0, 50, -10]),
        normals: null,
        uvs: null,
        skinIndices: null,
        skinWeights: null,
        indices: new Uint32Array([0, 1, 2]),
        ranges: [],
      },
      {
        asset: { kind: "gameChunk", wad: "Riven.wad.client", pathHash: "0" },
        path: null,
        submeshes: [],
        submeshesAlways: [],
        alignPitch: false,
        alignYaw: false,
        skinned: false,
      },
    ).getAttribute("position");
    const bulge = turned([0, 1, 0], [blade.getX(0), blade.getY(0), blade.getZ(0)]);

    /* `Glow_Back` stands at `birthRotation0 (0, -90, 89)`, its corner spanning the
       mirrored basis's first two columns. */
    const [x, y] = cornerAt(0.8, 0.5);
    const glow = turned([0, -90, 89], [x, y, 0]);

    expect(Math.sign(glow[2])).toBe(Math.sign(bulge[2]));
  });
});

describe("meshBuffers", () => {
  it("places the tint and the drive on the geometry it is given, as the attributes it returns", () => {
    const geometry = new BufferGeometry();
    const buffers = meshBuffers(geometry);

    expect(buffers.geometry).toBe(geometry);
    expect(geometry.getAttribute("instanceMatrix")).toBe(buffers.instanceMatrix);
    expect(buffers.instanceMatrix.itemSize).toBe(16);
    expect(geometry.getAttribute("tint")).toBe(buffers.tint);
    expect(geometry.getAttribute("erode")).toBe(buffers.erode);
    expect(geometry.getAttribute("uvTurn")).toBe(buffers.uvTurn);
    expect(geometry.getAttribute("uvShift")).toBe(buffers.uvShift);
    expect(geometry.getAttribute("uvTurnMult")).toBe(buffers.uvTurnMult);
    expect(geometry.getAttribute("uvShiftMult")).toBe(buffers.uvShiftMult);
    expect(buffers.tint.count).toBe(MESHES_PER_EMITTER);
    expect(buffers.tint.itemSize).toBe(4);
    expect(buffers.erode.itemSize).toBe(1);
    expect(buffers.uvTurn.itemSize).toBe(3);
    expect(buffers.uvShift.itemSize).toBe(4);
  });
});

describe("quadBuffers", () => {
  it("counts a position per corner, which three builds a quad's edges off", () => {
    expect(quadBuffers(4).geometry.getAttribute("position").count).toBe(4);
  });
});

describe("wireMaterial", () => {
  it("draws the solid's own shader and uniforms as edges, in one flat colour", () => {
    const solid = quadMaterial(BLEND_MODE.add, null, FLAT, BILLBOARD, PLAIN_LAYERS, PASSING);
    const wire = wireMaterial(solid, new Color(1, 0, 0), 1);

    expect(wire.wireframe).toBe(true);
    expect(wire.vertexShader).toBe(solid.vertexShader);
    expect(wire.uniforms.map).toBe(solid.uniforms.map);
    expect(wire.defines).toHaveProperty("WIREFRAME");
    expect(wire.depthWrite).toBe(false);
  });

  it("carries the edges' opacity as the colour's alpha, blended over what is drawn", () => {
    const solid = quadMaterial(BLEND_MODE.add, null, FLAT, BILLBOARD, PLAIN_LAYERS, PASSING);
    const wire = wireMaterial(solid, new Color(1, 0, 0), 0.35);

    expect(wire.uniforms.wireColor.value.w).toBe(0.35);
    expect(wire.transparent).toBe(true);
  });

  it("leaves the solid it draws beside as it was", () => {
    const solid = ribbonMaterial(BLEND_MODE.add, null, [0, 0], PLAIN_LAYERS, PASSING);
    wireMaterial(solid, new Color(1, 0, 0), 1);

    expect(solid.wireframe).toBe(false);
    expect(solid.uniforms).not.toHaveProperty("wireColor");
    expect(solid.defines).not.toHaveProperty("WIREFRAME");
  });

  it("carries a fading quad's SOFT define onto its edge twin", () => {
    const faded: QuadLayers = {
      ...PLAIN_LAYERS,
      soft: { beginIn: 20, deltaIn: 10, beginOut: 0, deltaOut: 0 },
    };
    const solid = quadMaterial(BLEND_MODE.add, null, FLAT, BILLBOARD, faded, PASSING);
    const wire = wireMaterial(solid, new Color(1, 0, 0), 1);

    expect(wire.defines).toHaveProperty("SOFT");
  });
});

describe("quadMaterial defines", () => {
  it("carries BILLBOARD, FALLOFF and PLANE for a billboard quad, and no RAY", () => {
    const quad = quadMaterial(BLEND_MODE.add, null, FLAT, BILLBOARD, PLAIN_LAYERS, PASSING);

    expect(quad.defines).toHaveProperty("BILLBOARD");
    expect(quad.defines).toHaveProperty("FALLOFF");
    expect(quad.defines.PLANE).toBe(0);
    expect(quad.defines).not.toHaveProperty("RAY");
  });

  it("carries RAY without BILLBOARD for a ray on SIMPLE_ORIENTATION.camera", () => {
    const ray: QuadOrientation = {
      billboard: false,
      ray: true,
      plane: SIMPLE_ORIENTATION.camera,
      unitQuad: false,
      pivotUp: false,
    };
    const quad = quadMaterial(BLEND_MODE.add, null, FLAT, ray, PLAIN_LAYERS, PASSING);

    expect(quad.defines).toHaveProperty("RAY");
    expect(quad.defines).not.toHaveProperty("BILLBOARD");
  });

  it("carries HAS_MAP once its texture has arrived", () => {
    const untextured = quadMaterial(BLEND_MODE.add, null, FLAT, BILLBOARD, PLAIN_LAYERS, PASSING);
    const textured = quadMaterial(
      BLEND_MODE.add,
      new Texture(),
      FLAT,
      BILLBOARD,
      PLAIN_LAYERS,
      PASSING,
    );

    expect(untextured.defines).not.toHaveProperty("HAS_MAP");
    expect(textured.defines).toHaveProperty("HAS_MAP");
  });
});

describe("layersOf", () => {
  const SAMPLERS: EmitterSamplers = {
    base: new Texture(),
    mult: new Texture(),
    color: new Texture(),
    palette: new Texture(),
    erosion: new Texture(),
    normal: new Texture(),
    reflection: new CubeTexture(),
  };
  const EMITTER = {
    uv: plainUvLayer(),
    multUv: plainUvLayer(),
    uvMode: UV_MODE.default,
    palette: null,
    erosion: null,
    distortion: null,
    reflection: {
      fresnel: 0.1,
      fresnelColor: [1, 0, 0, 0],
      reflectionFresnel: 0.6,
      reflectionFresnelColor: [1, 1, 1, 1],
      opacityDirect: 0.3,
      opacityGlancing: 0.2,
      map: null,
    } as ReflectionModel,
    soft: { beginIn: 20, deltaIn: 10, beginOut: 0, deltaOut: 0 },
    quadType: QUAD_TYPE.cameraQuad,
  } as EmitterModel;

  it("carries the ramp and the soft fade for a quad, a trail and a beam, and draws no sheen", () => {
    const layers = layersOf(EMITTER, SAMPLERS, { ramp: true, sheen: false, fade: true });

    expect(layers.colorTexture).toBe(SAMPLERS.color);
    expect(layers.reflection).toBeNull();
    expect(layers.reflectionTexture).toBeNull();
    expect(layers.soft).toBe(fadeOf(EMITTER));
  });

  it("carries the rim, the reflection and the soft fade for a mesh, and draws no ramp", () => {
    const layers = layersOf(EMITTER, SAMPLERS, { ramp: false, sheen: true, fade: true });

    expect(layers.colorTexture).toBeNull();
    expect(layers.reflection).toBe(EMITTER.reflection);
    expect(layers.reflectionTexture).toBe(SAMPLERS.reflection);
    expect(layers.soft).toBe(fadeOf(EMITTER));
  });

  it("carries the rim and the reflection for an attached mesh, without the ramp or the fade", () => {
    const layers = layersOf(EMITTER, SAMPLERS, { ramp: false, sheen: true, fade: false });

    expect(layers.colorTexture).toBeNull();
    expect(layers.reflection).toBe(EMITTER.reflection);
    expect(layers.reflectionTexture).toBe(SAMPLERS.reflection);
    expect(layers.soft).toBeNull();
  });

  describe("under LOCK_ALPHA", () => {
    const erosion = {} as ErosionModel;
    const layersFor = (quadType: QuadType, uvMode: UvMode) =>
      layersOf({ ...EMITTER, erosion, quadType, uvMode } as EmitterModel, SAMPLERS, {
        ramp: true,
        sheen: false,
        fade: true,
      });

    it("erodes no quad or ribbon, and draws its ramp instead", () => {
      for (const kind of [
        QUAD_TYPE.cameraQuad,
        QUAD_TYPE.arbitraryQuad,
        QUAD_TYPE.ray,
        QUAD_TYPE.cameraTrail,
        QUAD_TYPE.arbitraryTrail,
        QUAD_TYPE.beam,
      ]) {
        const layers = layersFor(kind, UV_MODE.lockAlpha);
        expect(layers.erosion).toBeNull();
        expect(colorDefines({ ...layers, mult: null })).toHaveProperty("HAS_RAMP");
      }
    });

    it("still erodes a mesh and an attached mesh", () => {
      expect(layersFor(QUAD_TYPE.mesh, UV_MODE.lockAlpha).erosion).toBe(erosion);
      expect(layersFor(QUAD_TYPE.attachedMesh, UV_MODE.lockAlpha).erosion).toBe(erosion);
    });

    it("leaves the erosion of a quad drawing the default uv mode alone", () => {
      expect(layersFor(QUAD_TYPE.cameraQuad, UV_MODE.default).erosion).toBe(erosion);
    });
  });
});

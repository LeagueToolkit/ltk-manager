import {
  Color,
  DoubleSide,
  type Material,
  NormalBlending,
  type RawShaderMaterial,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
} from "three";

import type { OutlineMaterial } from "@/lib/tauri";

import { whiteTexel } from "../../hexshade/neutralTextures";
import { type SubmeshProgram, writeProgramMember } from "../../hexshade/programMaterial";

/** The outline drawn around one submesh, as its skin's `OutlineCategorySubmeshes` names it. */
export interface SubmeshOutline<T = Texture> {
  readonly material: OutlineMaterial;
  /** `Outline_Mask`, and null to draw every texel. */
  readonly mask: T | null;
  /** The translated pass of the game's shader, and null to draw the stock outline. */
  readonly program: SubmeshProgram<T> | null;
}

/** The uniforms of a stock outline material, one per `Outline_*` parameter. */
export interface OutlineUniforms {
  readonly outlineColor: { value: Color };
  readonly outlineWidth: { value: number };
  readonly cameraDistance: { value: number };
  readonly depthOffset: { value: number };
  readonly alpha: { value: number };
  readonly mask: { value: Texture };
  readonly maskChannels: { value: [number, number, number, number] };
}

/** The defaults the shipped `Jade_CharacterOutline` def declares, for a value the read lacks. */
const DEFAULTS = {
  width: 0.25,
  cameraDistance: 600,
  depthOffset: 20,
  alpha: 1,
} as const;

/* `Jade_CharacterOutline_VS`: the skinned vertex moves `depthOffset` toward the camera and
   along its normal by a width that grows with the camera distance, so the outline keeps one
   width on screen. */
const VERTEX = /* glsl */ `
#include <common>
#include <skinning_pars_vertex>
uniform float outlineWidth;
uniform float cameraDistance;
uniform float depthOffset;
varying vec2 vUv;

void main() {
  #include <beginnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>

  vec4 world = modelMatrix * vec4( transformed, 1.0 );
  vec3 worldNormal = normalize( mat3( modelMatrix ) * objectNormal );
  vec3 toCamera = cameraPosition - world.xyz;
  float range = length( toCamera );
  world.xyz += toCamera / range * depthOffset
    + worldNormal * ( range / cameraDistance * outlineWidth );

  vUv = uv;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/* `Jade_CharacterOutline_PS`: the colour at the mask's weighted coverage. */
const FRAGMENT = /* glsl */ `
uniform vec3 outlineColor;
uniform float alpha;
uniform sampler2D mask;
uniform vec4 maskChannels;
varying vec2 vUv;

void main() {
  float coverage = clamp( dot( texture2D( mask, vUv ), maskChannels ) * alpha, 0.0, 1.0 );
  if ( coverage == 0.0 ) discard;

  gl_FragColor = vec4( outlineColor, coverage );
  #include <colorspace_fragment>
}
`;

/**
 * A stock material that draws a skinned submesh's outline as `Jade_CharacterOutline` does:
 * a shell of the submesh, both faces, alpha blended over the character.
 */
export function createOutlineMaterial(): ShaderMaterial {
  const uniforms: OutlineUniforms = {
    outlineColor: { value: new Color(0, 0, 0) },
    outlineWidth: { value: DEFAULTS.width },
    cameraDistance: { value: DEFAULTS.cameraDistance },
    depthOffset: { value: DEFAULTS.depthOffset },
    alpha: { value: DEFAULTS.alpha },
    mask: { value: whiteTexel() },
    maskChannels: { value: [1, 0, 0, 0] },
  };

  return new ShaderMaterial({
    uniforms: { ...uniforms },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: DoubleSide,
    transparent: true,
    blending: NormalBlending,
    depthWrite: true,
  });
}

/**
 * Writes `outline`'s parameters and `mask` into the uniforms of a material that
 * `createOutlineMaterial` made.
 *
 * `Outline_Color` is written as the game writes it to the back buffer, unconverted, so it is
 * read as sRGB.
 */
export function applyOutline(
  material: ShaderMaterial,
  outline: OutlineMaterial,
  mask: Texture | null,
): void {
  const uniforms = material.uniforms as unknown as OutlineUniforms;
  const [r, g, b] = outline.color;
  uniforms.outlineColor.value.setRGB(r ?? 0, g ?? 0, b ?? 0, SRGBColorSpace);
  uniforms.outlineWidth.value = outline.width ?? DEFAULTS.width;
  uniforms.cameraDistance.value = outline.cameraDistance ?? DEFAULTS.cameraDistance;
  uniforms.depthOffset.value = outline.depthOffset ?? DEFAULTS.depthOffset;
  uniforms.alpha.value = outline.alpha ?? DEFAULTS.alpha;
  uniforms.mask.value = mask ?? whiteTexel();
  const [x, y, z, w] = outline.maskChannels;
  uniforms.maskChannels.value = [x ?? 0, y ?? 0, z ?? 0, w ?? 0];
}

/** The `$Globals` member of `Jade_CharacterOutline` that the outline width divides by. */
const CAMERA_DISTANCE_MEMBER = "Outline_CameraDistanceMod";

/** An outline material with the `Outline_CameraDistanceMod` its outline states. */
export type RangedOutline =
  | { readonly kind: "stock"; readonly material: ShaderMaterial; readonly distance: number }
  | { readonly kind: "program"; readonly material: RawShaderMaterial; readonly distance: number };

/** The stock outline `material` with the camera distance its uniforms hold. */
export function rangedStock(material: ShaderMaterial): RangedOutline {
  const uniforms = material.uniforms as unknown as OutlineUniforms;
  return { kind: "stock", material, distance: uniforms.cameraDistance.value };
}

/**
 * The translated outline `material` with the camera distance of `program`'s pass. Returns null
 * if the pass names no `Outline_CameraDistanceMod`.
 */
export function rangedProgram(
  material: RawShaderMaterial,
  program: SubmeshProgram,
): RangedOutline | null {
  const distance = program.pass.params.find((param) => param.name === CAMERA_DISTANCE_MEMBER)
    ?.value[0];
  return distance == null ? null : { kind: "program", material, distance };
}

/**
 * Writes each outline's `Outline_CameraDistanceMod` as its own value times `factor`, the
 * camera's distance over the distance the outline is drawn as seen from.
 */
export function scaleOutlines(ranged: readonly RangedOutline[], factor: number): void {
  for (const outline of ranged) {
    const distance = outline.distance * factor;
    if (outline.kind === "program") {
      writeProgramMember(outline.material, CAMERA_DISTANCE_MEMBER, [distance]);
      continue;
    }
    (outline.material.uniforms as unknown as OutlineUniforms).cameraDistance.value = distance;
  }
}

/** The stock outline materials of one character, one per outline material. */
export class OutlineMaterials {
  private readonly made = new Map<string, ShaderMaterial>();

  /** The material `outline` draws with, made on its first use and updated on every use. */
  acquire(outline: SubmeshOutline): ShaderMaterial {
    let material = this.made.get(outline.material.hash);
    if (material === undefined) {
      material = createOutlineMaterial();
      this.made.set(outline.material.hash, material);
    }
    applyOutline(material, outline.material, outline.mask);
    return material;
  }

  /** Disposes every material that is not in `used`. */
  retain(used: ReadonlySet<Material>): void {
    for (const [hash, material] of this.made) {
      if (used.has(material)) continue;
      material.dispose();
      this.made.delete(hash);
    }
  }

  dispose(): void {
    this.retain(new Set());
  }
}

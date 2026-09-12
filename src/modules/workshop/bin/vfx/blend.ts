import {
  AddEquation,
  type Blending,
  type BlendingDstFactor,
  type BlendingEquation,
  type BlendingSrcFactor,
  CustomBlending,
  DstAlphaFactor,
  MaxEquation,
  MinEquation,
  NoBlending,
  OneFactor,
  OneMinusDstAlphaFactor,
  OneMinusSrcAlphaFactor,
  OneMinusSrcColorFactor,
  SrcAlphaFactor,
  ZeroFactor,
} from "three";

import { distorts } from "./drawKind";
import { BLEND_MODE, type BlendMode, MISC_RENDER_FLAG } from "./enums";
import type { EmitterModel } from "./model";

/** How one blend mode reaches the GPU. */
export interface BlendState {
  readonly blending: Blending;
  readonly blendSrc: BlendingSrcFactor;
  readonly blendDst: BlendingDstFactor;
  readonly blendEquation: BlendingEquation;
  /** The alpha lane, which two modes drive apart from the colour's. */
  readonly blendSrcAlpha: BlendingSrcFactor;
  readonly blendDstAlpha: BlendingDstFactor;
  readonly transparent: boolean;
  /** A blended quad writes no depth, so the quads behind it still draw. */
  readonly depthWrite: boolean;
}

/**
 * The GPU state of each `ParticleSystem::BLEND_MODE`.
 *
 * `add` takes the colour whole where `alphaAdd` scales it by the alpha, which is the
 * pair the two names read backwards.
 */
const BLEND_STATE: Record<BlendMode, BlendState> = {
  [BLEND_MODE.add]: custom(OneFactor, OneFactor, AddEquation),
  [BLEND_MODE.alpha]: custom(SrcAlphaFactor, OneMinusSrcAlphaFactor, AddEquation),
  [BLEND_MODE.subtract]: custom(ZeroFactor, OneMinusSrcColorFactor, AddEquation, {
    src: ZeroFactor,
    dst: OneMinusSrcAlphaFactor,
  }),
  [BLEND_MODE.none]: {
    blending: NoBlending,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendEquation: AddEquation,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneFactor,
    transparent: false,
    depthWrite: true,
  },
  [BLEND_MODE.alphaAdd]: custom(SrcAlphaFactor, OneFactor, AddEquation),
  [BLEND_MODE.premultipliedAlpha]: custom(OneFactor, OneMinusSrcAlphaFactor, AddEquation),
  [BLEND_MODE.min]: custom(OneFactor, OneFactor, MinEquation),
  [BLEND_MODE.max]: custom(OneFactor, OneFactor, MaxEquation),
  [BLEND_MODE.targetAlpha]: custom(OneMinusDstAlphaFactor, DstAlphaFactor, AddEquation, {
    src: OneFactor,
    dst: OneFactor,
  }),
};

/**
 * The state the emitter's fragments reach their target in.
 *
 * A distorting emitter writes offsets into a buffer of its own rather than colour into
 * the frame, so its blend mode never reaches the GPU. Decision 2.25 of
 * docs/plans/vfx-particle-renderer.md.
 */
export function drawState(mode: BlendMode, distorting: boolean): BlendState {
  return distorting ? DISTORTION_STATE : blendState(mode);
}

export function blendState(mode: BlendMode): BlendState {
  return BLEND_STATE[mode] ?? BLEND_STATE[BLEND_MODE.add];
}

/**
 * The modes whose quads have to be drawn back to front.
 *
 * An additive, a min and a max blend are order-independent, so only the modes that read
 * what is already in the target pay for the sort.
 */
export function sortsBackToFront(mode: BlendMode): boolean {
  return (
    mode === BLEND_MODE.alpha ||
    mode === BLEND_MODE.premultipliedAlpha ||
    mode === BLEND_MODE.targetAlpha ||
    mode === BLEND_MODE.subtract
  );
}

/**
 * How a warped fragment reaches the frame it was taken from.
 *
 * The fragment carries what it covers rather than a colour of its own, so it lays that
 * back over the frame under its own mask and leaves the depth alone.
 */
const DISTORTION_STATE: BlendState = custom(SrcAlphaFactor, OneMinusSrcAlphaFactor, AddEquation);

/**
 * The drawn colour as the vertex carries it: weighed by its alpha under `ADD` and `SUBTRACT`.
 *
 * Those two modes draw at a whole alpha. A distorting emitter keeps its alpha as the warp's
 * mask. Decision 2.49 of docs/plans/vfx-particle-renderer.md.
 */
export function premultiplyInto(emitter: EmitterModel, color: Float32Array): void {
  if (distorts(emitter)) return;
  if (emitter.blendMode !== BLEND_MODE.add && emitter.blendMode !== BLEND_MODE.subtract) return;
  for (let channel = 0; channel < 3; channel += 1) color[channel] *= color[3];
  color[3] = 1;
}

/** The two tests a fragment passes before it blends. */
export interface FragmentTests {
  /** The alpha a fragment is discarded below, and zero for a test compiled out. */
  readonly alphaRef: number;
  /** The fragment is tested against the depth buffer, which `DISABLE_ZBUFFER` turns off. */
  readonly depthTest: boolean;
}

/** The tests an emitter's fragments pass, off its own render-state bytes. */
export function fragmentTests(emitter: EmitterModel): FragmentTests {
  return {
    alphaRef: emitter.alphaRef,
    depthTest: (emitter.miscRenderFlags & MISC_RENDER_FLAG.disableZBuffer) === 0,
  };
}

function custom(
  blendSrc: BlendingSrcFactor,
  blendDst: BlendingDstFactor,
  blendEquation: BlendingEquation,
  alpha?: { src: BlendingSrcFactor; dst: BlendingDstFactor },
): BlendState {
  return {
    blending: CustomBlending,
    blendSrc,
    blendDst,
    blendEquation,
    blendSrcAlpha: alpha?.src ?? blendSrc,
    blendDstAlpha: alpha?.dst ?? blendDst,
    transparent: true,
    depthWrite: false,
  };
}

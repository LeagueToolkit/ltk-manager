import { useThree } from "@react-three/fiber";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  type BufferGeometry,
  type Camera,
  Mesh,
  NoColorSpace,
  type RawShaderMaterial,
  type WebGLRenderer,
} from "three";

import {
  api,
  type AppError,
  type AssetRef,
  type BinDocumentId,
  type MaterialProgram,
  type PassProgram,
} from "@/lib/tauri";
import {
  EngineEnvironment,
  programPasses,
  programTextureAssets,
  type ReadyProgram,
  type SubmeshProgram,
  useAssetTextures,
} from "@/modules/viewport";
import { usePreviewShaders } from "@/stores";
import { unwrapForQuery } from "@/utils/query";

import type { EmitterModel } from "../../engine/model/model";
import { SCENE_DEPTH } from "../utils/frame";
import { ATTACHED_DRAW, WORLD } from "../utils/particleDraws";
import {
  customParticleMaterial,
  drawsProgram,
  type ParticleDraw,
  type ParticlePair,
  type ParticlePath,
  particleProgramMaterial,
  particleShaderOf,
  particleTextures,
} from "../utils/particleProgram";
import type { EmitterSamplers } from "./useVfxTextures";

export const particleQueries = {
  /**
   * An engine particle pair translated for one define set, resolved through `document`'s
   * project, and through the install alone for a null document.
   */
  program: (document: BinDocumentId | null, pair: ParticlePair) =>
    queryOptions<PassProgram, AppError>({
      queryKey: ["particle-program", document, pair.shader, pair.defines],
      queryFn: async () =>
        unwrapForQuery(
          await api.bin.readParticleProgram(document, pair.shader, pair.defines, {
            lowQuality: false,
          }),
        ),
      staleTime: Infinity,
      retry: false,
    }),
  /**
   * An emitter's custom material with its passes translated, read from the file that
   * declares it, or from `document` where the system's bin declares it.
   */
  material: (document: BinDocumentId | null, hash: string | null, file: AssetRef | null) =>
    queryOptions<MaterialProgram | null, AppError>({
      queryKey: ["particle-material", document, hash, file],
      queryFn: async () => {
        const source =
          file !== null
            ? ({ kind: "file", asset: file, document } as const)
            : document !== null
              ? ({ kind: "document", document } as const)
              : null;
        if (hash === null || source === null) return null;
        const read = await api.bin.readMaterialPrograms(source, [hash], { lowQuality: false });
        return unwrapForQuery(read)[0] ?? null;
      },
      staleTime: Infinity,
      retry: false,
    }),
};

/** A particle program material ready to draw, and what writes its engine buffers before a draw. */
export interface ParticleProgram {
  readonly material: RawShaderMaterial;
  /** The `onBeforeRender` of the mesh drawing `material`. */
  readonly draw: (renderer: WebGLRenderer, scene: unknown, camera: Camera) => void;
}

/** One attached particle's program materials, one per pass, and the environment its slot writes. */
export interface SlotProgram {
  readonly materials: readonly RawShaderMaterial[];
  readonly environment: EngineEnvironment;
}

/** An engine pair's read with both stages translated. */
type ReadyPass = PassProgram & { readonly program: ReadyProgram };

/** Program textures load without colour decoding. The game's shader decodes them. */
const RAW_TEXTURES = { colorSpace: NoColorSpace } as const;

const NO_ASSETS = new Map();
const NO_MATERIALS: readonly RawShaderMaterial[] = [];
const NO_PROGRAMS: readonly ParticleProgram[] = [];
const NO_SLOTS: readonly SlotProgram[] = [];
const NO_PASSES: readonly SubmeshProgram[] = [];

/**
 * The Hexshade materials `emitter` draws with on `draw`'s path while the game's shaders are
 * on, one per pass in draw order, and none while the hand-written material draws in their
 * place.
 *
 * An emitter with a custom material draws each pass of it that translated. Any other draws
 * through the engine pair of its kind. The hand-written material draws while a program is
 * read, while its textures load, while it compiles, and wherever no program draws. A read
 * that fails is logged by the backend.
 */
export function useParticlePrograms(
  emitter: EmitterModel,
  samplers: EmitterSamplers,
  draw: ParticleDraw,
  geometry: BufferGeometry,
  document: BinDocumentId | null,
): readonly ParticleProgram[] {
  const shaders = usePreviewShaders();
  const custom = drawsCustom(emitter);
  const environment = useMemo(() => new EngineEnvironment("uniform"), []);
  useEffect(() => () => environment.dispose(), [environment]);
  useEffect(() => {
    environment.particle = { colorFactor: [1, 1, 1, 1], depthPushPull: emitter.depthPushPull };
  }, [environment, emitter.depthPushPull]);

  const read = useEngineRead(emitter, draw.path, document, shaders && !custom);
  const engine = useMemo(() => {
    const textures = read === null ? null : particleTextures(emitter, samplers);
    if (read === null || textures === null) return null;
    return particleProgramMaterial(
      read,
      emitter,
      samplers,
      textures,
      draw,
      environment,
      SCENE_DEPTH,
    );
  }, [read, emitter, samplers, draw, environment]);
  useEffect(() => () => engine?.dispose(), [engine]);

  const passes = useCustomPasses(emitter, document, shaders && custom);
  const customs = useMemo(
    () => passes.map((pass) => customParticleMaterial(pass, emitter, draw, environment)),
    [passes, emitter, draw, environment],
  );
  useEffect(() => () => disposeAll(customs), [customs]);

  const materials = useMemo(
    () => (custom ? customs : engine === null ? NO_MATERIALS : [engine]),
    [custom, customs, engine],
  );
  const compiled = useCompiled(materials, geometry);

  return useMemo(() => {
    if (!compiled) return NO_PROGRAMS;
    const world = draw.world ?? WORLD;
    return materials.map((material) => ({
      material,
      draw: (renderer: WebGLRenderer, _scene: unknown, view: Camera) => {
        environment.write(renderer, view, world, 0);
        environment.draw(material);
      },
    }));
  }, [compiled, materials, draw.world, environment]);
}

/**
 * The program materials of each slot of an attached emitter over the character's skin
 * `geometry`, once they compile, and none while the hand-written skin draws in their place.
 *
 * Each slot is a separate draw with a separate environment, which the slot's transform and
 * bones write. A slot draws each translated pass of the emitter's custom material, or the
 * engine pair of its kind.
 */
export function useAttachedPrograms(
  emitter: EmitterModel,
  samplers: EmitterSamplers,
  geometry: BufferGeometry | null,
  count: number,
  document: BinDocumentId | null,
): readonly SlotProgram[] {
  const shaders = usePreviewShaders() && geometry !== null;
  const custom = drawsCustom(emitter);
  const read = useEngineRead(emitter, "attached", document, shaders && !custom);
  const passes = useCustomPasses(emitter, document, shaders && custom);

  const slots = useMemo(() => {
    const textures = read === null ? null : particleTextures(emitter, samplers);
    const engine = read === null || textures === null ? null : { read, textures };
    if (custom ? passes.length === 0 : engine === null) return NO_SLOTS;

    return Array.from({ length: count }, (): SlotProgram => {
      const environment = new EngineEnvironment("uniform");
      environment.particle = { colorFactor: [1, 1, 1, 1], depthPushPull: emitter.depthPushPull };
      const materials =
        engine === null
          ? passes.map((pass) => customParticleMaterial(pass, emitter, ATTACHED_DRAW, environment))
          : [
              particleProgramMaterial(
                engine.read,
                emitter,
                samplers,
                engine.textures,
                ATTACHED_DRAW,
                environment,
                null,
              ),
            ];
      return { materials, environment };
    });
  }, [custom, read, passes, emitter, samplers, count]);
  useEffect(
    () => () => {
      for (const slot of slots) {
        disposeAll(slot.materials);
        slot.environment.dispose();
      }
    },
    [slots],
  );

  const materials = useMemo(() => slots.flatMap((slot) => slot.materials), [slots]);
  const compiled = useCompiled(materials, geometry);
  return compiled ? slots : NO_SLOTS;
}

/** The emitter names a custom material the read found, which draws in place of the engine pair. */
function drawsCustom(emitter: EmitterModel): boolean {
  return emitter.customMaterial !== null && !emitter.customMaterial.missing;
}

/** The engine pair `emitter` draws with on `path`, translated, and null where it draws none. */
function useEngineRead(
  emitter: EmitterModel,
  path: ParticlePath,
  document: BinDocumentId | null,
  enabled: boolean,
): ReadyPass | null {
  const pair = useMemo(() => particleShaderOf(emitter), [emitter]);
  const drawn = enabled && drawsProgram(emitter, pair, path);
  const read = useQuery({ ...particleQueries.program(document, pair), enabled: drawn }).data;

  return useMemo(() => {
    if (!drawn || read === undefined || read.program.kind !== "ready") return null;
    return { ...read, program: read.program };
  }, [drawn, read]);
}

/** Each translated pass of the emitter's custom material, in draw order, with its textures. */
function useCustomPasses(
  emitter: EmitterModel,
  document: BinDocumentId | null,
  enabled: boolean,
): readonly SubmeshProgram[] {
  const preview = enabled ? emitter.customMaterial : null;
  const read = useQuery({
    ...particleQueries.material(document, preview?.hash ?? null, preview?.source ?? null),
    enabled: preview !== null,
  }).data;
  const program = read ?? null;
  const assets = useMemo(
    () => (program === null ? NO_ASSETS : programTextureAssets([program])),
    [program],
  );
  const textures = useAssetTextures(assets, RAW_TEXTURES);

  return useMemo(() => {
    const passes = programPasses(program, textures);
    return passes.length === 0 ? NO_PASSES : passes;
  }, [program, textures]);
}

function disposeAll(materials: readonly RawShaderMaterial[]): void {
  for (const material of materials) material.dispose();
}

/**
 * Every one of `materials` has compiled against `geometry`.
 *
 * A translated pair links in tens of milliseconds, which would stall the frame that first
 * draws it.
 */
function useCompiled(
  materials: readonly RawShaderMaterial[],
  geometry: BufferGeometry | null,
): boolean {
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const [compiled, setCompiled] = useState<readonly RawShaderMaterial[]>(NO_MATERIALS);

  useEffect(() => {
    if (materials.length === 0 || geometry === null) return;
    let live = true;

    Promise.all(materials.map((material) => gl.compileAsync(new Mesh(geometry, material), camera)))
      .then(() => {
        if (live) setCompiled(materials);
      })
      .catch((error: unknown) => console.warn("A particle program did not compile", error));
    return () => {
      live = false;
    };
  }, [materials, gl, camera, geometry]);

  return materials.length > 0 && compiled === materials;
}

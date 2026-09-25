import type { RawShaderMaterial } from "three";

import type { ResolvedPass } from "@/lib/tauri";

import type { EngineEnvironment } from "./engineEnvironment";
import {
  applyPassState,
  bindProgramTextures,
  createProgramMaterial,
  type SubmeshProgram,
  writeProgramGlobals,
} from "./programMaterial";

/**
 * A parameter value a control holds before it reaches the bin, which the preview draws
 * every frame of a drag.
 */
export interface HeldValue {
  /** The material's path hash, whose programs take the value. */
  readonly material: string;
  /** The physical parameter the value writes into, the `$Globals` member's name. */
  readonly physical: string;
  /** The logical parameter's component mask, which places the value's components. */
  readonly fields: number;
  readonly value: readonly number[];
}

/**
 * `input` written into the components of `target` that `mask` selects, in order, as the
 * engine's `Material_SetLogicalParam` does and as `scatter` in `pass.rs` mirrors it.
 */
export function scatter(
  target: readonly number[],
  mask: number,
  input: readonly number[],
): number[] {
  const out = [...target];
  let next = 0;
  for (let bit = 0; bit < 4; bit += 1) {
    if ((mask & (1 << bit)) === 0) continue;
    out[bit] = input[next] ?? 0;
    next += 1;
  }
  return out;
}

/** `pass` with `held` scattered into its physical parameter, and `pass` itself where none applies. */
export function withHeld(
  pass: ResolvedPass,
  material: string,
  held: HeldValue | null,
): ResolvedPass {
  if (held === null || held.material !== material) return pass;
  if (!pass.params.some((param) => param.name === held.physical)) return pass;

  return {
    ...pass,
    params: pass.params.map((param) =>
      param.name === held.physical
        ? {
            ...param,
            value: scatter(
              param.value.map((component) => component ?? 0),
              held.fields,
              held.value,
            ) as ResolvedPass["params"][number]["value"],
          }
        : param,
    ),
  };
}

/**
 * What a built material is kept by: the material, the pass, its shader and the
 * permutation of each stage.
 */
export function programKey(program: SubmeshProgram): string {
  const { vertex, pixel } = program.program;
  return `${program.material}|${program.index}|${program.pass.shader ?? ""}|${vertex.id}|${pixel.id}`;
}

interface Built {
  readonly material: RawShaderMaterial;
  program: SubmeshProgram;
}

/**
 * The materials a scene's translated programs draw with, one per material and permutation.
 *
 * A read that answers the same permutation again, after a committed edit or a texture
 * landing, refreshes the material in place rather than building it again, so a slider's
 * release does not compile a shader or blank a frame. A held value is drawn by every
 * program of its material until it is let go.
 */
export class ProgramMaterials {
  private readonly built = new Map<string, Built>();
  private held: HeldValue | null = null;

  constructor(private readonly environment: EngineEnvironment) {}

  /** The material `program` draws with, made on its first read and refreshed after. */
  acquire(program: SubmeshProgram): RawShaderMaterial {
    const key = programKey(program);
    const found = this.built.get(key);
    if (found === undefined) {
      const material = createProgramMaterial(program, this.environment);
      this.built.set(key, { material, program });
      if (this.held?.material === program.material) this.write({ material, program });
      return material;
    }

    if (found.program !== program) {
      found.program = program;
      bindProgramTextures(found.material, program);
      applyPassState(found.material, program.pass.state);
      this.write(found);
    }
    return found.material;
  }

  /** Draw `held` in place of what its material's reads hold, or let the last one go. */
  hold(held: HeldValue | null): void {
    const previous = this.held;
    if (previous === held) return;
    this.held = held;

    const touched = new Set([previous?.material, held?.material]);
    for (const entry of this.built.values()) {
      if (touched.has(entry.program.material)) this.write(entry);
    }
  }

  /** Dispose every material `used` does not hold. */
  retain(used: ReadonlySet<RawShaderMaterial>): void {
    for (const [key, entry] of this.built) {
      if (used.has(entry.material)) continue;
      entry.material.dispose();
      this.built.delete(key);
    }
  }

  dispose(): void {
    for (const entry of this.built.values()) entry.material.dispose();
    this.built.clear();
  }

  private write({ material, program }: Built): void {
    writeProgramGlobals(material, program, withHeld(program.pass, program.material, this.held));
  }
}

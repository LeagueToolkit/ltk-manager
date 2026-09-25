/// <reference types="node" />
/*
 * Every shipped emitter's define set against the shader cache's TOCs, per V4 of
 * docs/plans/hexshade-vfx.md. Gated on `HEXSHADE_VFX_SWEEP`, a directory holding
 * `systems.jsonl` from the `vfx_systems` example of ltk-manager-core and `tocs.json` from
 * `particle_shaders --tocs` of ltk-manager-game.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { describe, expect, it } from "vitest";

import type { VfxSystem } from "@/lib/tauri";

import { readVfxSystem } from "../../../engine/parsing/readVfxSystem";
import { particleShaderOf } from "../particleProgram";

/** One stage's TOC: its base defines, and each subset of them it has a permutation for. */
interface StageToc {
  readonly base: readonly string[];
  readonly present: readonly (readonly string[])[];
}

type Tocs = Record<string, Record<"vertex" | "pixel", StageToc>>;

/** The define the preview always sets, which the studio adds to every pass. */
const ALWAYS = "DISABLE_FOW";

const SWEEP = process.env.HEXSHADE_VFX_SWEEP;

describe.skipIf(SWEEP === undefined)("the particle define sweep", () => {
  it("finds a permutation of both stages for every emitter's define set", async () => {
    const root = SWEEP ?? "";
    const tocs = JSON.parse(fs.readFileSync(path.join(root, "tocs.json"), "utf8")) as Tocs;
    const present = new Map(
      Object.entries(tocs).flatMap(([shader, stages]) =>
        Object.entries(stages).map(([stage, toc]) => [
          `${shader} ${stage}`,
          new Set(toc.present.map((names) => names.join(" "))),
        ]),
      ),
    );
    /* The dump is longer than the longest string the runtime allows. It is read a line at a time. */
    const lines = readline.createInterface({
      input: fs.createReadStream(path.join(root, "systems.jsonl")),
      crlfDelay: Infinity,
    });

    const misses = new Set<string>();
    const pairs = new Map<string, number>();
    const dropped = new Map<string, number>();
    let emitters = 0;
    let systems = 0;

    for await (const line of lines) {
      if (line.length === 0) continue;
      systems += 1;
      for (const emitter of readVfxSystem(JSON.parse(line) as VfxSystem).emitters) {
        const pair = particleShaderOf(emitter);
        const set = [...pair.defines, ALWAYS];
        emitters += 1;
        pairs.set(pair.shader, (pairs.get(pair.shader) ?? 0) + 1);

        const stages = tocs[pair.shader];
        if (stages === undefined) {
          misses.add(`${pair.shader}: no TOC`);
          continue;
        }
        for (const [stage, toc] of Object.entries(stages)) {
          const key = set
            .filter((define) => toc.base.includes(define))
            .sort()
            .join(" ");
          if (!present.get(`${pair.shader} ${stage}`)?.has(key)) {
            misses.add(`${pair.shader} ${stage}: [${key}]`);
          }
        }
        for (const define of pair.defines) {
          if (stages.vertex.base.includes(define) || stages.pixel.base.includes(define)) continue;
          const at = `${pair.shader} drops ${define}`;
          dropped.set(at, (dropped.get(at) ?? 0) + 1);
        }
      }
    }

    console.info(
      [
        `${systems} systems, ${emitters} emitters`,
        ...[...pairs].map(([shader, count]) => `  ${shader}: ${count}`),
        ...[...dropped].map(([at, count]) => `  ${at}: ${count}`),
      ].join("\n"),
    );
    expect([...misses]).toEqual([]);
  }, 600_000);
});

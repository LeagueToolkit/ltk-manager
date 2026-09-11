import { describe, expect, it } from "vitest";

import type { BinRow, BinRows, BinValue } from "@/lib/tauri";

import { nameHash } from "../binHash";
import { childCardOf, childFieldReads, childListReads } from "../emitterCards";
import type { ChildChoice } from "../emitterTypes";
import type { EmitterModel, SystemModel } from "../vfx";

const CHILD_ENTRY = "0x0badf00d";
const at = (name: string) => nameHash(name).slice(2);
const COMPLEX = at("complexEmitterDefinitionData");
const SIMPLE = at("simpleEmitterDefinitionData");
const SPARK = `${COMPLEX}[1]`;

function row(
  path: string,
  name: string,
  value: BinValue,
  node: BinRow["node"] = "property",
): BinRow {
  return {
    entry: CHILD_ENTRY,
    path,
    label: name,
    node,
    name,
    unnamed: false,
    kind: null,
    value,
    declared: null,
  };
}

const page = (rows: BinRow[]): BinRows => ({ rows, total: rows.length });
const embed = (len: number): BinValue => ({
  type: "struct",
  classHash: nameHash("VfxEmitterDefinitionData"),
  class: "VfxEmitterDefinitionData",
  len,
});

function emitter(over: Partial<EmitterModel>): EmitterModel {
  return { index: 0, simple: false, listIndex: 0, name: "ember", ...over } as EmitterModel;
}

const EMBER = emitter({ index: 0, listIndex: 0, name: "ember" });
const SPARK_MODEL = emitter({ index: 1, listIndex: 1, name: "spark" });

const SYSTEM: SystemModel = {
  entry: CHILD_ENTRY,
  name: "Particles/Burst_Child",
  emitters: [EMBER, SPARK_MODEL],
  transform: null,
  dragMotion: 0,
};

const CHILD: ChildChoice = { path: "3.0", parent: null, system: SYSTEM, emitter: SPARK_MODEL };

const LIST = page([
  row(`${COMPLEX}[0]`, "[0]", embed(1), "element"),
  row(SPARK, "[1]", embed(2), "element"),
]);

const FIELDS = page([
  row(`${SPARK}.${at("emitterName")}`, "emitterName", { type: "string", value: "spark" }),
  row(`${SPARK}.${at("rate")}`, "rate", { type: "float", value: 4 }),
]);

describe("a child emitter's read", () => {
  it("reads the list the emitter sits in, under the child system's own entry", () => {
    expect(childListReads(CHILD)).toEqual([{ key: `${CHILD_ENTRY}:${COMPLEX}`, rows: 2 }]);
  });

  it("reads the second list for a simple emitter", () => {
    const simple = { ...CHILD, emitter: emitter({ simple: true, listIndex: 0 }) };

    expect(childListReads(simple)).toEqual([{ key: `${CHILD_ENTRY}:${SIMPLE}`, rows: 1 }]);
  });

  it("reads nothing for no child, or for a child whose system names no entry", () => {
    expect(childListReads(null)).toEqual([]);
    expect(childListReads({ ...CHILD, system: { ...SYSTEM, entry: null } })).toEqual([]);
  });

  it("reads the emitter's own fields once its list has answered", () => {
    expect(childFieldReads(CHILD, undefined)).toEqual([]);
    expect(childFieldReads(CHILD, LIST)).toEqual([{ key: `${CHILD_ENTRY}:${SPARK}`, rows: 2 }]);
  });

  it("draws the emitter as a card once its fields have answered", () => {
    expect(childCardOf(CHILD, LIST, undefined)).toBeUndefined();

    const card = childCardOf(CHILD, LIST, FIELDS);

    expect(card?.key).toBe(`${CHILD_ENTRY}:${SPARK}`);
    expect(card?.index).toBe(1);
    expect(card?.simple).toBe(false);
    expect(card?.groups.flatMap((each) => each.rows.map((held) => held.name))).toEqual(["rate"]);
  });
});

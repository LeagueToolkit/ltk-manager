import { describe, expect, it } from "vitest";

import type { BinRow, BinValue } from "@/lib/tauri";

import { followed } from "../curveFollow";
import type { CurveTarget } from "../curveTarget";
import { groupRows } from "../emitterGroups";
import type { EmitterCardData } from "../emitterTypes";

const ENTRY = "0x11111111";
const FLOAT: BinValue = { type: "float", value: 1 };

function row(path: string, name: string): BinRow {
  return {
    entry: ENTRY,
    path,
    label: name,
    node: "property",
    name,
    unnamed: false,
    kind: null,
    value: FLOAT,
    declared: null,
  };
}

function card(index: number, name: string, fields: readonly string[]): EmitterCardData {
  const path = `list[${index}]`;
  const rows = fields.map((field) => row(`${path}.${field}`, field));
  return {
    row: row(path, name),
    key: `${ENTRY}:${path}`,
    index,
    simple: false,
    fields: (hash) => rows.find((each) => each.path.endsWith(hash)),
    groups: groupRows(rows),
  };
}

const BLEND = card(0, "BaseEnergyBlend", ["scale0", "rate"]);
const CORE = card(1, "BaseEnergyCore", ["scale0"]);
const FLARE = card(2, "BaseEnergyFlare", ["rate"]);

const aimed = (target: EmitterCardData, field: string): CurveTarget => ({
  row: row(`${target.row.path}.${field}`, field),
  chain: `${target.row.name} [${target.index}] . ${field}`,
  tab: "graph",
});

describe("followed", () => {
  it("aims the same field of the emitter selected next", () => {
    const next = followed(aimed(BLEND, "scale0"), null, BLEND, CORE);

    expect(next.target?.row.path).toBe("list[1].scale0");
    expect(next.target?.chain).toBe("BaseEnergyCore [1] . scale0");
    expect(next.held).toBeNull();
  });

  it("keeps the reading the pane is on rather than the one the first aim asked for", () => {
    expect(followed(aimed(BLEND, "scale0"), null, BLEND, CORE).target?.tab).toBeUndefined();
  });

  it("lets go of the target where the next emitter has no such field, and holds the field", () => {
    expect(followed(aimed(BLEND, "scale0"), null, BLEND, FLARE)).toEqual({
      target: null,
      held: ".scale0",
    });
  });

  it("aims a held field again at the first emitter that has it", () => {
    const next = followed(null, ".scale0", FLARE, CORE);

    expect(next.target?.row.path).toBe("list[1].scale0");
    expect(next.held).toBeNull();
  });

  it("follows a field into a child system's emitter, which sits under another entry", () => {
    const child: EmitterCardData = {
      ...FLARE,
      row: { ...FLARE.row, entry: "0x22222222" },
      key: "0x22222222:list[2]",
      groups: FLARE.groups.map((each) => ({
        ...each,
        rows: each.rows.map((held) => ({ ...held, entry: "0x22222222" })),
      })),
    };

    const next = followed(aimed(BLEND, "rate"), null, BLEND, child);

    expect(next.target?.row.entry).toBe("0x22222222");
    expect(next.target?.row.path).toBe("list[2].rate");
  });

  it("holds a target no emitter owns, and forgets any held field", () => {
    const system = { row: row("0xabcdef01", "soundOnCreate"), chain: "soundOnCreate" };

    expect(followed(system, ".scale0", BLEND, CORE)).toEqual({ target: system, held: null });
  });

  it("holds everything while the emitter stays the same or nothing is aimed", () => {
    const target = aimed(BLEND, "scale0");

    expect(followed(target, null, BLEND, BLEND).target).toBe(target);
    expect(followed(target, null, undefined, CORE).target).toBe(target);
    expect(followed(null, null, BLEND, CORE)).toEqual({ target: null, held: null });
  });
});

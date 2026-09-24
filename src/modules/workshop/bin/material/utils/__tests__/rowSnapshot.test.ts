import { describe, expect, it } from "vitest";

import type { LeafValue } from "@/lib/tauri";

import {
  changedFields,
  leafOf,
  revertFields,
  type RowSnapshot,
  sameSnapshot,
} from "../rowSnapshot";

const NAME = "0x00000001";
const VALUE = "0x00000002";

function entry(fields: Record<string, LeafValue>): RowSnapshot {
  return { present: true, fields: new Map(Object.entries(fields)) };
}

const name: LeafValue = { type: "string", value: "Roughness" };
const was: LeafValue = { type: "vector", values: [0.6, 0, 0, 0] };
const now: LeafValue = { type: "vector", values: [0.35, 0, 0, 0] };

describe("rowSnapshot", () => {
  it("reads a hash row as the text an edit writes", () => {
    expect(leafOf({ type: "hash", hash: "0xabcdef01", name: "x" })).toEqual({
      type: "hash",
      text: "0xabcdef01",
    });
    expect(leafOf({ type: "container", len: 1, itemKind: "u8" })).toBeNull();
  });

  it("treats an entry with the same leaves as the same state", () => {
    expect(sameSnapshot(entry({ [VALUE]: was }), entry({ [VALUE]: { ...was } }))).toBe(true);
    expect(sameSnapshot(entry({ [VALUE]: was }), entry({ [VALUE]: now }))).toBe(false);
  });

  it("tells an absent entry from an empty one", () => {
    expect(sameSnapshot({ present: false, fields: new Map() }, entry({}))).toBe(false);
  });

  it("writes back only the changed fields the baseline held, never the name", () => {
    const baseline = entry({ [NAME]: name, [VALUE]: was });

    expect(changedFields(baseline, entry({ [NAME]: name, [VALUE]: now }))).toEqual([VALUE]);
    expect(revertFields(baseline, entry({ [NAME]: name, [VALUE]: now }), NAME)).toEqual([
      [VALUE, was],
    ]);
    expect(revertFields(baseline, { present: false, fields: new Map() }, NAME)).toEqual([
      [VALUE, was],
    ]);
  });
});

import { expect, it } from "vitest";

import { assignSlots } from "../previewSlots";

const job = (key: string) => ({ key, node: key });
const keys = (slots: readonly ({ key: string } | null)[]) => slots.map((slot) => slot?.key ?? null);

it("fills free slots with the first stills wanted", () => {
  expect(keys(assignSlots([null, null], null, [job("a"), job("b"), job("c")], true))).toEqual([
    "a",
    "b",
  ]);
});

it("keeps a job in its slot when another finishes", () => {
  const current = [job("a"), job("b")];
  expect(keys(assignSlots(current, null, [job("b"), job("c")], true))).toEqual(["c", "b"]);
});

it("gives the live job a slot ahead of every still", () => {
  const current = [job("a"), job("b")];
  expect(keys(assignSlots(current, job("x"), [job("a"), job("b")], true))).toEqual(["a", "x"]);
});

it("starts no new still during a scroll and keeps the ones running", () => {
  const current = [job("a"), null];
  expect(keys(assignSlots(current, null, [job("b"), job("a")], false))).toEqual(["a", null]);
  expect(keys(assignSlots(current, job("x"), [job("b"), job("a")], false))).toEqual(["a", "x"]);
});

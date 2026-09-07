import { describe, expect, it } from "vitest";

import { PAGE_SIZE } from "../binRows";
import { READ_ROW_CAP, readBatches } from "../useBinRead";

const ENTRY = "0x2a1f3c7d";
const OTHER = "0x9b67e9f6";

function request(entry: string, path: string, rows: number) {
  return { key: `${entry}:${path}`, rows };
}

describe("readBatches", () => {
  it("puts one entry's paths in one call, in the order it reads them back", () => {
    const batches = readBatches([request(ENTRY, "0000000b", 2), request(ENTRY, "0000000a", 2)]);

    expect(batches).toEqual([{ entry: ENTRY, paths: ["0000000a", "0000000b"] }]);
  });

  it("asks for a key once however many rows want it", () => {
    const batches = readBatches([request(ENTRY, "0000000a", 2), request(ENTRY, "0000000a", 2)]);

    expect(batches).toEqual([{ entry: ENTRY, paths: ["0000000a"] }]);
  });

  it("splits a call at the entry, because one call reads one object", () => {
    const batches = readBatches([request(OTHER, "0000000a", 2), request(ENTRY, "0000000a", 2)]);

    expect(batches).toEqual([
      { entry: ENTRY, paths: ["0000000a"] },
      { entry: OTHER, paths: ["0000000a"] },
    ]);
  });

  it("splits a call at the row cap", () => {
    const wide = Array.from({ length: 5 }, (_, at) => request(ENTRY, `0000000${at}`, PAGE_SIZE));

    const batches = readBatches(wide);
    expect(batches).toHaveLength(2);
    expect(batches[0]?.paths).toHaveLength(READ_ROW_CAP / PAGE_SIZE);
    expect(batches[1]?.paths).toHaveLength(1);
  });

  /* A node longer than a page answers one page, so it never alone exceeds the cap. */
  it("keeps a node longer than a page in a call of its own rather than refusing it", () => {
    const batches = readBatches([request(ENTRY, "0000000a", 50_000)]);

    expect(batches).toEqual([{ entry: ENTRY, paths: ["0000000a"] }]);
  });

  it("asks for nothing where nothing is wanted", () => {
    expect(readBatches([])).toEqual([]);
  });
});

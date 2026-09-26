import type { Virtualizer } from "@tanstack/react-virtual";
import { describe, expect, it } from "vitest";

import { measureRow } from "../virtualRows";

function instance(sizes: number[]): Virtualizer<HTMLDivElement, Element> {
  return {
    options: { horizontal: false, estimateSize: () => 24 },
    indexFromElement: (element: Element) => Number(element.getAttribute("data-index")),
    measurementsCache: sizes.map((size, index) => ({ index, size })),
  } as unknown as Virtualizer<HTMLDivElement, Element>;
}

function entry(blockSize: number): ResizeObserverEntry {
  return { borderBoxSize: [{ blockSize, inlineSize: 100 }] } as unknown as ResizeObserverEntry;
}

function row(index: number, rects: number): Element {
  return {
    getAttribute: () => String(index),
    getClientRects: () => ({ length: rects }),
  } as unknown as Element;
}

describe("measureRow", () => {
  it("takes the observed height of a row on screen", () => {
    expect(measureRow(row(1, 1), entry(40), instance([24, 60]))).toBe(40);
  });

  it("keeps the last height of a row a hidden pane reports at zero", () => {
    expect(measureRow(row(1, 0), entry(0), instance([24, 60]))).toBe(60);
  });

  it("takes zero for a row on screen that is zero tall", () => {
    expect(measureRow(row(1, 1), entry(0), instance([24, 60]))).toBe(0);
  });

  it("falls back to the estimate for a hidden row never measured", () => {
    expect(measureRow(row(5, 0), entry(0), instance([24, 60]))).toBe(24);
  });
});

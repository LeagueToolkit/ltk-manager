import { describe, expect, it } from "vitest";

import { EXPLORER_ROW_HEIGHTS } from "@/stores";

import { ART_REQUEST_WIDTH, artBoxFor, nameTypeForRow, nearestRowHeight } from "../detailsRow";

describe("artBoxFor", () => {
  it("insets the art inside the row it sits in", () => {
    expect(artBoxFor(24)).toBe(20);
    expect(artBoxFor(64)).toBe(60);
  });

  it("leaves the art readable in the shortest row", () => {
    expect(artBoxFor(20)).toBe(16);
  });

  it("keeps every declared height under the one width a row asks for", () => {
    /* A taller row than the asset scheme is asked for would draw its thumbnail
       upscaled, and a seventh `w` is what the six-width budget exists to stop. */
    for (const height of EXPLORER_ROW_HEIGHTS) {
      expect(artBoxFor(height)).toBeLessThanOrEqual(ART_REQUEST_WIDTH);
    }
  });
});

describe("nameTypeForRow", () => {
  it("drops a tier in a row too short for the body size", () => {
    expect(nameTypeForRow(20).className).toBe("text-meta");
  });

  it("names itself in the row tier from the default height up", () => {
    expect(nameTypeForRow(24).className).toBe("text-row");
    expect(nameTypeForRow(64).className).toBe("text-row");
  });

  it("fits its own leading inside every declared height", () => {
    for (const height of EXPLORER_ROW_HEIGHTS) {
      expect(nameTypeForRow(height).line).toBeLessThanOrEqual(height);
    }
  });
});

describe("nearestRowHeight", () => {
  it("takes a declared height unchanged", () => {
    for (const height of EXPLORER_ROW_HEIGHTS) {
      expect(nearestRowHeight(height)).toBe(height);
    }
  });

  it("snaps a thumb between two stops to the nearer", () => {
    expect(nearestRowHeight(21)).toBe(20);
    expect(nearestRowHeight(23)).toBe(24);
    expect(nearestRowHeight(41)).toBe(36);
    expect(nearestRowHeight(45)).toBe(48);
  });

  it("holds a value past either end at the end it passed", () => {
    expect(nearestRowHeight(0)).toBe(20);
    expect(nearestRowHeight(500)).toBe(64);
  });
});

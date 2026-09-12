import { describe, expect, it } from "vitest";

import { charsIn, cutText, nameColumn, splitPath } from "../textCut";

describe("textCut", () => {
  it("leaves a name that fits alone", () => {
    expect(cutText("BaseEnergyBlend", 20)).toBe("BaseEnergyBlend");
    expect(cutText("BaseEnergyBlend", null)).toBe("BaseEnergyBlend");
  });

  it("cuts the middle of a name and keeps both ends", () => {
    expect(cutText("BaseEnergyFlares", 11)).toBe("BaseE…lares");
  });

  it("draws the ellipsis alone where one character fits", () => {
    expect(cutText("BaseEnergyBlend", 1)).toBe("…");
    expect(cutText("BaseEnergyBlend", 0)).toBe("");
  });
});

describe("charsIn", () => {
  it("counts the characters a box holds", () => {
    expect(charsIn(100, 7)).toBe(14);
  });

  it("answers null before anything is measured", () => {
    expect(charsIn(0, 7)).toBeNull();
    expect(charsIn(100, 0)).toBeNull();
  });
});

describe("splitPath", () => {
  it("splits the folder from the file name after the last slash", () => {
    expect(splitPath("…/b/file.tex")).toEqual({ folder: "…/b/", file: "file.tex" });
    expect(splitPath("file.tex")).toEqual({ folder: "", file: "file.tex" });
  });
});

describe("nameColumn", () => {
  it("fits the longest name and caps it", () => {
    expect(nameColumn(["ab", "abcdefghij"], 10, "40%")).toBe("min(calc(10ch + 10px), 40%)");
  });

  it("holds a floor for short names", () => {
    expect(nameColumn(["ab"], 0, "40%")).toBe("min(calc(8ch + 0px), 40%)");
    expect(nameColumn([], 0, "40%")).toBe("min(calc(8ch + 0px), 40%)");
  });
});

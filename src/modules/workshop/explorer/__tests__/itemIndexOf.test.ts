// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { itemIndexOf } from "../ExplorerSurface";

const SVG_NS = "http://www.w3.org/2000/svg";

let item: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  item = document.createElement("div");
  item.dataset.itemIndex = "7";
  document.body.append(item);
});

describe("itemIndexOf", () => {
  it("reads the item a click on its own box landed in", () => {
    expect(itemIndexOf(item)).toBe(7);
  });

  it("reads it through a plain child", () => {
    const name = document.createElement("span");
    item.append(name);

    expect(itemIndexOf(name)).toBe(7);
  });

  it("reads it through the glyph, which is an SVG and not an HTMLElement", () => {
    const svg = document.createElementNS(SVG_NS, "svg");
    const path = document.createElementNS(SVG_NS, "path");
    svg.append(path);
    item.append(svg);

    expect(path).not.toBeInstanceOf(HTMLElement);
    expect(itemIndexOf(svg)).toBe(7);
    expect(itemIndexOf(path)).toBe(7);
  });

  it("reads it through a thumbnail", () => {
    const img = document.createElement("img");
    item.append(img);

    expect(itemIndexOf(img)).toBe(7);
  });

  it("reads it through a cell, which is where a details row carries the index", () => {
    const cell = document.createElement("span");
    cell.setAttribute("role", "gridcell");
    item.append(cell);

    expect(itemIndexOf(cell)).toBe(7);
  });

  it("answers nothing for the surface's own background", () => {
    const background = document.createElement("div");
    document.body.append(background);

    expect(itemIndexOf(background)).toBeNull();
  });

  it("answers nothing for a target that is no element at all", () => {
    expect(itemIndexOf(null)).toBeNull();
    expect(itemIndexOf(document.createTextNode("x") as unknown as EventTarget)).toBeNull();
  });
});

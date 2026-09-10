import { describe, expect, it } from "vitest";

import { ancestorLocations, childLocation, crumbsOf, parentLocation } from "../location";

describe("parentLocation", () => {
  it("drops the last segment", () => {
    expect(parentLocation("assets/characters/smolder")).toBe("assets/characters");
  });

  it("answers the root for a segment at the root", () => {
    expect(parentLocation("assets")).toBe("");
  });

  it("answers the root for the root", () => {
    expect(parentLocation("")).toBe("");
  });
});

describe("childLocation", () => {
  it("joins a segment under a location", () => {
    expect(childLocation("assets", "characters")).toBe("assets/characters");
  });

  it("leaves no leading slash at the root", () => {
    expect(childLocation("", "assets")).toBe("assets");
  });
});

describe("crumbsOf", () => {
  it("names the source first, and every segment after it", () => {
    expect(crumbsOf("Game", "assets/characters/smolder")).toEqual([
      { path: "", label: "Game" },
      { path: "assets", label: "assets" },
      { path: "assets/characters", label: "characters" },
      { path: "assets/characters/smolder", label: "smolder" },
    ]);
  });

  it("draws the source alone at the root", () => {
    expect(crumbsOf("Game", "")).toEqual([{ path: "", label: "Game" }]);
  });

  it("gives every segment of a folded chain its own crumb", () => {
    expect(crumbsOf("Game", "a/b/c").map((crumb) => crumb.label)).toEqual(["Game", "a", "b", "c"]);
  });

  it("labels the unnamed group by the name its row carries", () => {
    expect(crumbsOf("Game", "?")).toEqual([
      { path: "", label: "Game" },
      { path: "?", label: "unknown" },
    ]);
  });
});

describe("ancestorLocations", () => {
  it("walks the root down to the location", () => {
    expect(ancestorLocations("assets/characters/smolder")).toEqual([
      "",
      "assets",
      "assets/characters",
      "assets/characters/smolder",
    ]);
  });

  it("gives the root alone for the root", () => {
    expect(ancestorLocations("")).toEqual([""]);
  });

  it("gives the root and the directory for one segment", () => {
    expect(ancestorLocations("assets")).toEqual(["", "assets"]);
  });

  it("ignores a trailing or doubled separator", () => {
    expect(ancestorLocations("assets//characters/")).toEqual(["", "assets", "assets/characters"]);
  });
});

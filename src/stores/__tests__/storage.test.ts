import { replacer, reviver } from "../storage";

describe("replacer", () => {
  it("serializes Set to tagged object", () => {
    const result = replacer("", new Set(["a", "b"]));
    expect(result).toEqual({ __type: "Set", value: ["a", "b"] });
  });

  it("serializes Map to tagged object with entries", () => {
    const result = replacer(
      "",
      new Map([
        ["k1", "v1"],
        ["k2", "v2"],
      ]),
    );
    expect(result).toEqual({
      __type: "Map",
      value: [
        ["k1", "v1"],
        ["k2", "v2"],
      ],
    });
  });

  it("passes through plain values unchanged", () => {
    expect(replacer("", 42)).toBe(42);
    expect(replacer("", "hello")).toBe("hello");
    expect(replacer("", null)).toBe(null);
    expect(replacer("", [1, 2])).toEqual([1, 2]);
  });
});

describe("reviver", () => {
  it("reconstructs Set from tagged object", () => {
    const result = reviver("", { __type: "Set", value: ["a", "b"] });
    expect(result).toEqual(new Set(["a", "b"]));
  });

  it("reconstructs Map from tagged object", () => {
    const result = reviver("", {
      __type: "Map",
      value: [
        ["k1", "v1"],
        ["k2", "v2"],
      ],
    });
    expect(result).toEqual(
      new Map([
        ["k1", "v1"],
        ["k2", "v2"],
      ]),
    );
  });

  it("passes through plain values unchanged", () => {
    expect(reviver("", 42)).toBe(42);
    expect(reviver("", "hello")).toBe("hello");
    expect(reviver("", { foo: "bar" })).toEqual({ foo: "bar" });
  });

  it("passes through objects without __type marker", () => {
    const obj = { value: [1, 2, 3] };
    expect(reviver("", obj)).toEqual(obj);
  });
});

describe("round-trip", () => {
  it("preserves Set through JSON stringify/parse", () => {
    const original = { items: new Set(["x", "y", "z"]) };
    const json = JSON.stringify(original, replacer);
    const restored = JSON.parse(json, reviver);
    expect(restored.items).toEqual(new Set(["x", "y", "z"]));
  });

  it("preserves Map through JSON stringify/parse", () => {
    const original = {
      lookup: new Map<string, number>([
        ["a", 1],
        ["b", 2],
      ]),
    };
    const json = JSON.stringify(original, replacer);
    const restored = JSON.parse(json, reviver);
    expect(restored.lookup).toEqual(
      new Map([
        ["a", 1],
        ["b", 2],
      ]),
    );
  });

  it("preserves nested structures", () => {
    const original = {
      tags: new Set(["skin", "hud"]),
      config: { name: "test", count: 5 },
    };
    const json = JSON.stringify(original, replacer);
    const restored = JSON.parse(json, reviver);
    expect(restored.tags).toEqual(new Set(["skin", "hud"]));
    expect(restored.config).toEqual({ name: "test", count: 5 });
  });
});

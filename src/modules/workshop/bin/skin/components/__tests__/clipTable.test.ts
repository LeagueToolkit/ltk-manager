import { describe, expect, it } from "vitest";

import type { GraphClip } from "@/lib/tauri";

import { clipKind, shownColumns } from "../ClipColumns";
import { matchingClips } from "../ClipTable";

function clip(name: string, hash: string, className = "AtomicClipData"): GraphClip {
  return {
    name,
    hash,
    class: className,
    animation: null,
    track: null,
    mask: null,
    syncGroup: null,
    tickDuration: null,
    events: [],
    children: [],
    parameters: [],
    interruptionGroups: [],
    flags: 0,
    ownEvents: false,
  };
}

describe("matchingClips", () => {
  const clips = [
    clip("Run", "0x3"),
    clip("0x00000001", "0x00000001"),
    clip("attack1", "0x2"),
    clip("Idle1", "0x4"),
  ];

  it("sorts by name without regard to case, the unnamed after the named", () => {
    expect(matchingClips(clips, "").map((each) => each.hash)).toEqual([
      "0x2",
      "0x4",
      "0x3",
      "0x00000001",
    ]);
  });

  it("keeps the rows whose name holds the filter, without regard to case", () => {
    expect(matchingClips(clips, " ATT ").map((each) => each.name)).toEqual(["attack1"]);
  });

  it("matches an unnamed clip on its hex", () => {
    expect(matchingClips(clips, "0x0000").map((each) => each.hash)).toEqual(["0x00000001"]);
  });

  it("matches a named clip on its hex", () => {
    expect(matchingClips(clips, "0X2").map((each) => each.name)).toEqual(["attack1"]);
  });
});

describe("shownColumns", () => {
  const keys = (clips: GraphClip[]) => shownColumns(clips).map((column) => column.key);

  it("leaves out the mask and sync group columns no clip holds a key for", () => {
    expect(keys([clip("Run", "0x1")])).toEqual(["name", "rate", "track", "events"]);
  });

  it("draws a column once one clip holds a key for it, rate before it", () => {
    const masked = { ...clip("Run", "0x1"), mask: { name: "Upper", hash: "0x5", declared: true } };

    expect(keys([clip("Idle", "0x2"), masked])).toEqual([
      "name",
      "rate",
      "track",
      "mask",
      "events",
    ]);
  });
});

describe("clipKind", () => {
  it("drops the suffix every kind carries", () => {
    expect(clipKind(clip("a", "0x1", "SelectorClipData"))).toBe("Selector");
    expect(clipKind(clip("a", "0x1"))).toBe("Atomic");
  });

  it("keeps a class no table names as its hex", () => {
    expect(clipKind(clip("a", "0x1", "0xdeadbeef"))).toBe("0xdeadbeef");
  });
});

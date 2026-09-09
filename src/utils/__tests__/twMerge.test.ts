import { describe, expect, it } from "vitest";

import { twMerge } from "../twMerge";

describe("twMerge", () => {
  it("keeps a type tier standing beside a text colour", () => {
    expect(twMerge("text-meta", "text-surface-300")).toBe("text-meta text-surface-300");
    expect(twMerge("text-fine", "text-accent-100")).toBe("text-fine text-accent-100");
  });

  it("still lets one tier replace another", () => {
    expect(twMerge("text-meta", "text-fine")).toBe("text-fine");
    expect(twMerge("text-row", "text-xs")).toBe("text-xs");
  });

  it("still lets one colour replace another", () => {
    expect(twMerge("text-surface-200", "text-accent-100")).toBe("text-accent-100");
  });

  it("leaves the alignment and the weight alone, which are neither", () => {
    expect(twMerge("text-center text-fine font-medium", "text-surface-200")).toBe(
      "text-center text-fine font-medium text-surface-200",
    );
  });
});

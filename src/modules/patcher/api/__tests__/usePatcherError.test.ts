// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";

import { m } from "@/i18n";
import type { AppError, OverlayErrorCategory } from "@/lib/tauri";

import { classifyPatcherError } from "../usePatcherError";

function overlayError(category: OverlayErrorCategory, detail = "build failed"): AppError {
  return { code: "OVERLAY", category, detail };
}

describe("classifyPatcherError", () => {
  it.each([
    ["GAME_DIR", m["error.OVERLAY.GAME_DIR.title"]()],
    ["MOD_CONTENT", m["error.OVERLAY.MOD_CONTENT.title"]()],
    ["WAD_LIMIT", m["error.OVERLAY.WAD_LIMIT.title"]()],
    ["CORRUPT", m["error.OVERLAY.CORRUPT.title"]()],
    ["BUG", m["error.OVERLAY.BUG.title"]()],
    ["FILE_IN_USE", m["error.OVERLAY.FILE_IN_USE.title"]()],
    ["OTHER", m["error.OVERLAY.title"]()],
  ] as [OverlayErrorCategory, string][])("titles a %s failure", (category, title) => {
    expect(classifyPatcherError(overlayError(category, "chunk mismatch"))).toEqual({
      stage: "BUILD",
      message: "chunk mismatch",
      title,
    });
  });

  it("leaves a categoryless build failure to the stage's own title", () => {
    expect(classifyPatcherError({ code: "UNKNOWN", detail: "x" })).toEqual({
      stage: "BUILD",
      message: "x",
    });
  });

  it("keeps an injection failure's stage and reason", () => {
    expect(
      classifyPatcherError({
        code: "PATCHER",
        error: { kind: "INJECTION_FAILED", stage: "HOST", message: "host died" },
      }),
    ).toEqual({ stage: "HOST", message: "host died" });
  });

  it("treats a patcher refusal as no failed start", () => {
    expect(classifyPatcherError({ code: "PATCHER", error: { kind: "BUSY" } })).toBeNull();
  });
});

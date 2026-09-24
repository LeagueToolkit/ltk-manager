import type { AppError, LauncherError, OverlayErrorCategory } from "@/lib/bindings";
import { m } from "@/paraglide/messages";

import {
  describeError,
  describeLaunchError,
  describePatcherError,
  describeWorkshopError,
  errorSummary,
} from "./errors";

describe("describeError", () => {
  it("titles a code that carries nothing", () => {
    expect(describeError({ code: "WORKSHOP_NOT_CONFIGURED" })).toEqual({
      title: m["error.WORKSHOP_NOT_CONFIGURED.title"](),
    });
  });

  it("adds the remedy where the code has one", () => {
    expect(describeError({ code: "LEAGUE_NOT_FOUND" })).toEqual({
      title: m["error.LEAGUE_NOT_FOUND.title"](),
      description: m["error.LEAGUE_NOT_FOUND.description"](),
    });
  });

  it("draws an outside error as detail under the code's title", () => {
    expect(describeError({ code: "IO", detail: "disk full" })).toEqual({
      title: m["error.IO.title"](),
      detail: "disk full",
    });
  });

  it("fills the id into the title", () => {
    expect(describeError({ code: "MOD_NOT_FOUND", modId: "abc" }).title).toBe(
      m["error.MOD_NOT_FOUND.title"]({ modId: "abc" }),
    );
    expect(describeError({ code: "INVALID_PATH", path: "C:/x" }).title).toBe(
      m["error.INVALID_PATH.title"]({ path: "C:/x" }),
    );
  });

  it("describes the schema versions", () => {
    expect(
      describeError({ code: "SCHEMA_VERSION_TOO_NEW", fileVersion: 4, maxSupported: 3 }),
    ).toEqual({
      title: m["error.SCHEMA_VERSION_TOO_NEW.title"](),
      description: m["error.SCHEMA_VERSION_TOO_NEW.description"]({
        fileVersion: 4,
        maxSupported: 3,
      }),
    });
  });

  it.each([
    ["GAME_DIR", m["error.OVERLAY.GAME_DIR.title"]()],
    ["MOD_CONTENT", m["error.OVERLAY.MOD_CONTENT.title"]()],
    ["WAD_LIMIT", m["error.OVERLAY.WAD_LIMIT.title"]()],
    ["CORRUPT", m["error.OVERLAY.CORRUPT.title"]()],
    ["BUG", m["error.OVERLAY.BUG.title"]()],
    ["FILE_IN_USE", m["error.OVERLAY.FILE_IN_USE.title"]()],
    ["OTHER", m["error.OVERLAY.title"]()],
  ] as [OverlayErrorCategory, string][])("titles a %s overlay failure", (category, title) => {
    expect(describeError({ code: "OVERLAY", category, detail: "chunk mismatch" })).toEqual({
      title,
      detail: "chunk mismatch",
    });
  });

  it("hands a launch failure to the launcher's describer", () => {
    const error: LauncherError = { kind: "UNSUPPORTED_PLATFORM" };
    expect(describeError({ code: "LAUNCHER", error })).toEqual(describeLaunchError(error));
  });

  it("hands a patcher failure to the patcher's describer", () => {
    expect(describeError({ code: "PATCHER", error: { kind: "BUSY" } })).toEqual(
      describePatcherError({ kind: "BUSY" }),
    );
  });
});

describe("describeLaunchError", () => {
  it.each([
    [{ kind: "RIOT_CLIENT_NOT_FOUND", installsPath: "C:/x.json" }, "RIOT_CLIENT_NOT_FOUND"],
    [{ kind: "RIOT_CLIENT_UNREACHABLE", reason: "HTTP 404" }, "RIOT_CLIENT_UNREACHABLE"],
    [{ kind: "SPAWN_FAILED", reason: "access denied" }, "SPAWN_FAILED"],
    [{ kind: "UNSUPPORTED_PLATFORM" }, "UNSUPPORTED_PLATFORM"],
  ] as const)("names the remedy for %o", (error, kind) => {
    const copy = describeLaunchError(error);
    expect(copy.title).toBe(m[`launcher.${kind}.title`]());
    expect(copy.description).toBe(m[`launcher.${kind}.description`]());
  });

  it("answers a refusal Riot explained", () => {
    expect(
      describeLaunchError({ kind: "REFUSED", riotErrorCode: "eula_not_accepted", message: "eula" }),
    ).toEqual({
      title: m["launcher.REFUSED.eula_not_accepted.title"](),
      description: m["launcher.REFUSED.eula_not_accepted.description"](),
    });
  });

  // Riot's own prose is better than anything generic for a refusal this
  // build has not seen, so it goes through unedited, as data.
  it("passes a refusal it does not know through as detail", () => {
    expect(
      describeLaunchError({
        kind: "REFUSED",
        riotErrorCode: "something_new",
        message: "The client said no.",
      }),
    ).toEqual({ title: m["launcher.REFUSED.title"](), detail: "The client said no." });
  });

  it("keeps an upstream failure's own words as detail", () => {
    expect(describeLaunchError({ kind: "OTHER", message: "something new upstream" })).toEqual({
      title: m.launcher_launch_failed_title(),
      detail: "something new upstream",
    });
  });
});

describe("describePatcherError", () => {
  it("titles a refusal", () => {
    expect(describePatcherError({ kind: "NOT_RUNNING" })).toEqual({
      title: m["patcher.NOT_RUNNING.title"](),
    });
  });

  it("titles an injection failure by its stage and keeps the reason", () => {
    expect(
      describePatcherError({ kind: "INJECTION_FAILED", stage: "HOST", message: "host died" }),
    ).toEqual({ title: m["patcher.INJECTION_FAILED.HOST.title"](), detail: "host died" });
    expect(
      describePatcherError({ kind: "INJECTION_FAILED", stage: "INJECTION", message: "no DLL" }),
    ).toEqual({ title: m["patcher.INJECTION_FAILED.INJECTION.title"](), detail: "no DLL" });
  });
});

describe("describeWorkshopError", () => {
  const conflict = (...conflicts: string[]) =>
    describeWorkshopError({ kind: "LAYER_FILE_CONFLICT", conflicts });

  it("names one conflicting file", () => {
    expect(conflict("a.bin").description).toBe("a.bin already exists in this layer.");
  });

  it("lists up to three", () => {
    expect(conflict("a.bin", "b.bin", "c.bin").description).toBe(
      "a.bin, b.bin, c.bin already exist in this layer.",
    );
  });

  it("counts the rest past three", () => {
    expect(conflict("a.bin", "b.bin", "c.bin", "d.bin", "e.bin").description).toBe(
      "a.bin, b.bin and 3 more already exist in this layer.",
    );
  });

  it("has only a title when nothing conflicts", () => {
    expect(conflict()).toEqual({ title: m["workshop.LAYER_FILE_CONFLICT.title"]() });
  });
});

describe("errorSummary", () => {
  it("prefers the outside detail", () => {
    expect(errorSummary({ code: "IO", detail: "disk full" })).toBe("disk full");
  });

  it("falls back to the description, then the title", () => {
    const tooNew: AppError = { code: "SCHEMA_VERSION_TOO_NEW", fileVersion: 4, maxSupported: 3 };
    expect(errorSummary(tooNew)).toBe(describeError(tooNew).description);
    expect(errorSummary({ code: "WORKSHOP_NOT_CONFIGURED" })).toBe(
      m["error.WORKSHOP_NOT_CONFIGURED.title"](),
    );
  });
});

import { describe, expect, it } from "vitest";

import { projectSlugError } from "../projectSlug";

describe("projectSlugError", () => {
  it("accepts lowercase letters, digits and hyphens", () => {
    expect(projectSlugError("my-awesome-mod-2")).toBeNull();
  });

  it("refuses an empty name", () => {
    expect(projectSlugError("")).toMatch(/required/);
  });

  it("refuses anything a directory name would not hold", () => {
    expect(projectSlugError("My Mod")).toMatch(/lowercase/);
    expect(projectSlugError("mod_name")).toMatch(/lowercase/);
  });

  /* A leading or trailing hyphen names a directory that reads as an option and
     sorts oddly, so the create dialog has always refused it. */
  it("refuses a hyphen at either end", () => {
    expect(projectSlugError("-mod")).toMatch(/hyphen/);
    expect(projectSlugError("mod-")).toMatch(/hyphen/);
  });
});

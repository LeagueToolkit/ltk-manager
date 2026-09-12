import { describe, expect, it } from "vitest";

import { lacksTemplateSection, withTemplateSections } from "../textFileKind";

describe("withTemplateSections", () => {
  it("writes the whole skeleton into an empty file", () => {
    expect(withTemplateSections("")).toBe("## About\n\n## Installing\n\n## Credits\n");
  });

  it("appends under the prose already there", () => {
    expect(withTemplateSections("# My Mod\n\nIt swaps a skin.\n")).toBe(
      "# My Mod\n\nIt swaps a skin.\n\n## About\n\n## Installing\n\n## Credits\n",
    );
  });

  it("leaves out a section the file already has", () => {
    const held = "# My Mod\n\n## About\n\nWhat it does.\n";

    expect(withTemplateSections(held)).toBe(
      "# My Mod\n\n## About\n\nWhat it does.\n\n## Installing\n\n## Credits\n",
    );
  });

  it("matches a heading by its text rather than its level", () => {
    expect(withTemplateSections("### credits\n")).toBe(
      "### credits\n\n## About\n\n## Installing\n",
    );
  });

  it("writes nothing into a file holding every section", () => {
    const held = "## About\n\n## Installing\n\n## Credits\n";

    expect(withTemplateSections(held)).toBe(held);
    expect(lacksTemplateSection(held)).toBe(false);
  });

  it("reads a file short of one section as lacking", () => {
    expect(lacksTemplateSection("## About\n")).toBe(true);
  });
});

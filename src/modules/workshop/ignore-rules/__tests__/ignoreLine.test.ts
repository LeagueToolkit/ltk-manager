import { describe, expect, it } from "vitest";

import {
  appendIgnoreLine,
  extensionIgnoreLine,
  fileIgnoreLine,
  folderIgnoreLine,
  isOwnLine,
  removeIgnoreLine,
} from "../ignoreLine";

describe("fileIgnoreLine", () => {
  it("anchors a file at its layer, counting from content/", () => {
    expect(fileIgnoreLine("base", "textures/skin0_src.psd")).toBe("/base/textures/skin0_src.psd");
  });

  it("escapes every segment character the matcher reads as syntax", () => {
    expect(fileIgnoreLine("base", "wip [draft]/#1 !final*.psd")).toBe(
      String.raw`/base/wip \[draft]/\#1 \!final\*.psd`,
    );
  });

  it("escapes a space the parser would otherwise trim", () => {
    expect(fileIgnoreLine("base", "notes .txt ")).toBe(String.raw`/base/notes .txt\ `);
  });
});

describe("folderIgnoreLine", () => {
  it("anchors a folder and marks it as one", () => {
    expect(folderIgnoreLine("base", "textures/wip")).toBe("/base/textures/wip/");
  });
});

describe("extensionIgnoreLine", () => {
  it("covers every layer, so it is not anchored", () => {
    expect(extensionIgnoreLine("skin0_src.psd")).toBe("*.psd");
  });

  it("takes the last extension of a name that carries several", () => {
    expect(extensionIgnoreLine("skin0.bin.bak")).toBe("*.bak");
  });

  it("has nothing to write for a name with no extension", () => {
    expect(extensionIgnoreLine("README")).toBeNull();
    expect(extensionIgnoreLine(".modignore")).toBeNull();
  });
});

describe("appendIgnoreLine", () => {
  it("ends a file that has no trailing newline before writing under it", () => {
    expect(appendIgnoreLine("*.psd", "*.tex")).toBe("*.psd\n*.tex\n");
  });

  it("writes the only line of a file that does not exist yet", () => {
    expect(appendIgnoreLine("", "*.psd")).toBe("*.psd\n");
  });
});

describe("removeIgnoreLine", () => {
  it("takes the line out and leaves the rest as it was", () => {
    expect(removeIgnoreLine("# sources\n*.psd\n*.tex\n", "*.psd")).toBe("# sources\n*.tex\n");
  });

  it("takes the last of two identical lines, which is the one that decides", () => {
    expect(removeIgnoreLine("*.psd\n*.tex\n*.psd\n", "*.psd")).toBe("*.psd\n*.tex\n");
  });

  it("leaves a file holding no such line alone", () => {
    expect(removeIgnoreLine("*.tex\n", "*.psd")).toBe("*.tex\n");
  });

  /* A quoted trailing space is part of the name, so trimming the line before
     comparing it would leave the row it names ignored forever. */
  it("takes out a line whose trailing space the backslash quotes", () => {
    const line = fileIgnoreLine("base", "notes.txt ");

    expect(removeIgnoreLine(appendIgnoreLine("*.psd\n", line), line)).toBe("*.psd\n");
  });
});

describe("isOwnLine", () => {
  const root = ".modignore";

  it("holds where the root file carries exactly the row's own line", () => {
    expect(
      isOwnLine({ pattern: "/base/splash.psd", source: root, line: 3 }, "base", {
        relativePath: "splash.psd",
        isDir: false,
      }),
    ).toBe(true);
  });

  it("fails where a broader pattern matched the row", () => {
    expect(
      isOwnLine({ pattern: "*.psd", source: root, line: 3 }, "base", {
        relativePath: "splash.psd",
        isDir: false,
      }),
    ).toBe(false);
  });

  it("fails where the rule came from a nested file", () => {
    expect(
      isOwnLine(
        { pattern: "/base/splash.psd", source: "content/base/.modignore", line: 1 },
        "base",
        {
          relativePath: "splash.psd",
          isDir: false,
        },
      ),
    ).toBe(false);
  });
});

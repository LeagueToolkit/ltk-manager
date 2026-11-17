import { describe, expect, it } from "vitest";

import { groupReportFiles } from "../reportGroups";

function file(path: string, bytes: number) {
  return { path, bytes, contents: "" };
}

describe("groupReportFiles", () => {
  it("sums the files of each group and keeps the fixed order", () => {
    const groups = groupReportFiles([
      file("game-log/r3dlog.txt", 400),
      file("library.json", 30),
      file("report.md", 10),
      file("manifest.json", 5),
      file("log/ltk-manager.log", 200),
      file("system.json", 20),
      file("settings.json", 1),
      file("patcher.json", 2),
    ]);

    expect(groups).toEqual([
      { id: "summary", bytes: 15, count: 0 },
      { id: "log", bytes: 200, count: 0 },
      { id: "system", bytes: 53, count: 0 },
      { id: "gameLog", bytes: 400, count: 0 },
    ]);
  });

  it("counts an incident once if it has a json file and a report text", () => {
    const groups = groupReportFiles([
      file("incidents/a.json", 100),
      file("incidents/a.md", 40),
      file("incidents/b.json", 100),
      file("incidents/b.md", 40),
    ]);

    expect(groups).toEqual([{ id: "incidents", bytes: 280, count: 2 }]);
  });

  it("counts the game records and shows them after the incidents", () => {
    const groups = groupReportFiles([
      file("games/2026-11-15T14-02-00.json", 300),
      file("games/2026-11-15T15-10-00.json", 200),
      file("incidents/a.json", 100),
    ]);

    expect(groups).toEqual([
      { id: "incidents", bytes: 100, count: 1 },
      { id: "games", bytes: 500, count: 2 },
    ]);
  });

  it("returns no group if the report holds no file", () => {
    expect(groupReportFiles([])).toEqual([]);
  });
});

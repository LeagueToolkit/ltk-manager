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
      { id: "summary", bytes: 15, incidents: 0 },
      { id: "log", bytes: 200, incidents: 0 },
      { id: "system", bytes: 53, incidents: 0 },
      { id: "gameLog", bytes: 400, incidents: 0 },
    ]);
  });

  it("counts an incident once if it has a json file and a report text", () => {
    const groups = groupReportFiles([
      file("incidents/a.json", 100),
      file("incidents/a.md", 40),
      file("incidents/b.json", 100),
      file("incidents/b.md", 40),
    ]);

    expect(groups).toEqual([{ id: "incidents", bytes: 280, incidents: 2 }]);
  });

  it("returns no group if the report holds no file", () => {
    expect(groupReportFiles([])).toEqual([]);
  });
});

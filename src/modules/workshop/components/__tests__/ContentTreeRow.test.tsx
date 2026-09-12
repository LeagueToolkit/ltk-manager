// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ContentEntry, IgnoreMatch } from "@/lib/tauri";

import type { DirNode, FileNode } from "../../utils/contentTree";
import { TreeRow } from "../ContentTreeRow";

function entry(relativePath: string, ignoredBy: IgnoreMatch | null): ContentEntry {
  return { relativePath, sizeBytes: 12n, kind: "unknown", objects: [], ignoredBy };
}

function fileRow(node: FileNode) {
  return (
    <TreeRow
      node={node}
      depth={0}
      isExpanded={false}
      isSelected={false}
      dirFileCount={0}
      onToggle={() => {}}
      onSelect={() => {}}
      height={24}
      rowIndex={0}
      tabIndex={-1}
    />
  );
}

describe("TreeRow", () => {
  it("names the rule that excluded a file, and where the rule lives", () => {
    const rule: IgnoreMatch = { pattern: "*.psd", source: ".modignore", line: 14 };
    render(fileRow({ type: "file", name: "splash.psd", entry: entry("splash.psd", rule) }));

    expect(screen.getByLabelText("Not packed: *.psd, .modignore line 14")).toBeInTheDocument();
  });

  it("names a nested file where that is what matched", () => {
    const rule: IgnoreMatch = {
      pattern: "*.png",
      source: "content/base/.modignore",
      line: 2,
    };
    render(fileRow({ type: "file", name: "skin0.png", entry: entry("skin0.png", rule) }));

    expect(
      screen.getByLabelText("Not packed: *.png, content/base/.modignore line 2"),
    ).toBeInTheDocument();
  });

  it("leaves a row that ships unmarked", () => {
    render(fileRow({ type: "file", name: "skin0.tex", entry: entry("skin0.tex", null) }));

    expect(screen.queryByLabelText(/Not packed/)).not.toBeInTheDocument();
  });

  it("marks a pruned folder the way it marks a file", () => {
    const node: DirNode = {
      type: "dir",
      name: "wip",
      path: "textures/wip",
      ignoredBy: { pattern: "wip/", source: ".modignore", line: 5 },
      children: [],
    };
    render(
      <TreeRow
        node={node}
        depth={0}
        isExpanded
        isSelected={false}
        dirFileCount={2}
        onToggle={() => {}}
        onSelect={() => {}}
        height={24}
        rowIndex={0}
        tabIndex={-1}
      />,
    );

    expect(screen.getByLabelText("Not packed: wip/, .modignore line 5")).toBeInTheDocument();
  });
});

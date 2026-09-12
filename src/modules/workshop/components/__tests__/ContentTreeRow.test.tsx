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

const row = () => screen.getByRole("treeitem");

describe("TreeRow", () => {
  it("dims a file a rule leaves out, and gives its size seat to the mark", () => {
    const rule: IgnoreMatch = { pattern: "*.psd", source: ".modignore", line: 14 };
    render(fileRow({ type: "file", name: "splash.psd", entry: entry("splash.psd", rule) }));

    expect(row().className).toContain("text-surface-400");
    expect(screen.getByLabelText("Not packed: *.psd .modignore, line 14")).toBeInTheDocument();
    expect(screen.queryByText("12 B")).not.toBeInTheDocument();
  });

  it("names a nested file where that is what matched", () => {
    const rule: IgnoreMatch = {
      pattern: "*.png",
      source: "content/base/.modignore",
      line: 2,
    };
    render(fileRow({ type: "file", name: "skin0.png", entry: entry("skin0.png", rule) }));

    expect(
      screen.getByLabelText("Not packed: *.png content/base/.modignore, line 2"),
    ).toBeInTheDocument();
  });

  it("leaves a row that ships unmarked, with its size", () => {
    render(fileRow({ type: "file", name: "skin0.tex", entry: entry("skin0.tex", null) }));

    expect(screen.queryByLabelText(/Not packed/)).not.toBeInTheDocument();
    expect(screen.getByText("12 B")).toBeInTheDocument();
  });

  it("marks a pruned folder and keeps the count of what it holds", () => {
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
        dirFileCount={12}
        onToggle={() => {}}
        onSelect={() => {}}
        height={24}
        rowIndex={0}
        tabIndex={-1}
      />,
    );

    expect(screen.getByLabelText("Not packed: wip/ .modignore, line 5")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });
});

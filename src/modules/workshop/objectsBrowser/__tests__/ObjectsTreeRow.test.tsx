// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { ObjectDeclaration, WorkshopProject } from "@/lib/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../components/ProjectContext";
import { ObjectsTreeRow } from "../ObjectsTreeRow";
import { type ObjectPrefixNode, type ObjectRowNode } from "../objectTree";

const CHUNK: ObjectDeclaration = {
  asset: { kind: "gameChunk", wad: "Champions/Aatrox.wad.client", pathHash: "00aa" },
  file: "data/characters/aatrox/skins/skin0.bin",
  classHash: "0x9b67e9f6",
  class: "SkinCharacterDataProperties",
};

const LAYER: ObjectDeclaration = {
  asset: { kind: "layer", project: "C:/mods/skin", layer: "base", path: "data/skin0.bin" },
  file: "data/skin0.bin",
  classHash: "0x9b67e9f6",
  class: "SkinCharacterDataProperties",
};

const PROJECT: WorkshopProject = {
  path: "C:/mods/skin",
  name: "skin",
  displayName: "Skin",
  version: "1.0.0",
  description: "",
  authors: [],
  tags: [],
  champions: [],
  maps: [],
  layers: [],
  thumbnailPath: null,
  lastModified: "2026-08-21T21:14:02Z",
};

function objectNode(overrides: Partial<ObjectRowNode> = {}): ObjectRowNode {
  return {
    type: "object",
    id: "characters/aatrox/skins/skin0",
    path: "characters/aatrox/skins/skin0",
    name: "skin0",
    objectHash: "0x2a1f3c7d",
    unnamed: false,
    declarations: [CHUNK],
    layers: [],
    count: 0,
    children: [],
    ...overrides,
  };
}

const PREFIX: ObjectPrefixNode = {
  type: "prefix",
  id: "characters",
  name: "characters",
  unnamed: false,
  count: 12480,
  children: [],
};

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());
  return (
    <QueryClientProvider client={client}>
      <ProjectProvider project={PROJECT}>{children}</ProjectProvider>
    </QueryClientProvider>
  );
}

function renderRow(node: ObjectRowNode | ObjectPrefixNode) {
  const onToggle = vi.fn();
  const onOpen = vi.fn();
  const onSelect = vi.fn();
  render(
    <Providers>
      <ObjectsTreeRow
        node={node}
        depth={1}
        isExpanded={false}
        isSelected={false}
        onToggle={onToggle}
        onSelect={onSelect}
        onOpen={onOpen}
        height={24}
        rowIndex={3}
        tabIndex={0}
      />
    </Providers>,
  );
  return { onToggle, onOpen, onSelect };
}

describe("ObjectsTreeRow", () => {
  it("opens a leaf object from its body and draws its class and its source", async () => {
    const user = userEvent.setup();
    const { onOpen, onToggle } = renderRow(objectNode());

    const row = screen.getByRole("treeitem");
    expect(row).toHaveTextContent("skin0");
    expect(row).toHaveTextContent("SkinCharacterDataProperties");
    expect(row).toHaveTextContent("skin0.bin");
    expect(row).not.toHaveTextContent("Aatrox/…/skin0.bin");
    expect(screen.getByTitle("Aatrox/…/skin0.bin")).toHaveTextContent("skin0.bin");
    expect(row).not.toHaveAttribute("aria-expanded");

    await user.click(screen.getByText("skin0"));
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ name: "skin0" }), "default");
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("opens a node that is both from its body and toggles it from its caret alone", async () => {
    const user = userEvent.setup();
    const both = objectNode({ count: 3 });
    const { onOpen, onToggle } = renderRow(both);

    const row = screen.getByRole("treeitem");
    expect(row).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByText("skin0"));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();

    await user.click(screen.getByRole("presentation"));
    expect(onToggle).toHaveBeenCalledWith(both);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("opens beside with Ctrl held and pins on a double click", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderRow(objectNode());

    await user.keyboard("{Control>}");
    await user.click(screen.getByText("skin0"));
    await user.keyboard("{/Control}");
    expect(onOpen).toHaveBeenLastCalledWith(expect.anything(), "beside");

    await user.dblClick(screen.getByText("skin0"));
    expect(onOpen).toHaveBeenLastCalledWith(expect.anything(), "permanent");
  });

  it("reads several declarations as a file count and a layer's as its mark, and stays a leaf", () => {
    renderRow(
      objectNode({ declarations: [CHUNK, LAYER], layers: [{ name: "base", title: "Base" }] }),
    );

    const row = screen.getByRole("treeitem");
    expect(row).toHaveTextContent("2 files");
    expect(row).toHaveTextContent("Base");
    expect(row).not.toHaveAttribute("aria-expanded");
  });

  it("lists the declaring files from the count without opening the row", async () => {
    const user = userEvent.setup();
    const { onOpen } = renderRow(
      objectNode({ declarations: [CHUNK, LAYER], layers: [{ name: "base", title: "Base" }] }),
    );

    await user.click(screen.getByRole("button", { name: "2 files" }));
    const list = await screen.findByRole("dialog", { name: "2 files" });

    expect(onOpen).not.toHaveBeenCalled();
    const files = within(list).getAllByRole("button");
    expect(files).toHaveLength(2);
    expect(files[0]).toHaveTextContent("data/characters/aatrox/skins/skin0.bin");
    expect(files[0]).toHaveTextContent("Aatrox");
    expect(files[1]).toHaveTextContent("data/skin0.bin");
    expect(files[1]).toHaveTextContent("Base");
  });

  it("toggles a prefix from anywhere on its row and shows its count", async () => {
    const user = userEvent.setup();
    const { onOpen, onToggle } = renderRow(PREFIX);

    const row = screen.getByRole("treeitem");
    expect(row).toHaveTextContent("characters");
    expect(row).toHaveTextContent("12,480");

    await user.click(row);
    expect(onToggle).toHaveBeenCalledWith(PREFIX);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

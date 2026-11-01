// @vitest-environment happy-dom

import { render, screen } from "@testing-library/react";
import { type ReactNode, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useContentVisible } from "@/hooks";

import { DocumentStage } from "../components/DocumentStage";
import { DocumentToolbar } from "../components/DocumentToolbar";
import { EditorSurface } from "../components/EditorSurface";
import { type LayoutNode, type LeafNode, SplitLayout } from "../layout";
import type { EditorDocumentBase, EditorDocumentProps, EditorRegistry } from "../types";

interface Note extends EditorDocumentBase {
  kind: "note";
}

const mounted = vi.fn();
const unmounted = vi.fn();

function NoteBody({ document, active }: EditorDocumentProps<Note>) {
  const visible = useContentVisible();

  useEffect(() => {
    mounted(document.id);
    return () => unmounted(document.id);
  }, [document.id]);

  return (
    <>
      <DocumentToolbar active={active}>
        <span data-testid={`toolbar-${document.id}`} />
      </DocumentToolbar>
      <span data-testid={`body-${document.id}`} data-visible={String(visible)} />
    </>
  );
}

const REGISTRY: EditorRegistry<Note> = {
  note: {
    icon: () => null,
    label: (document) => ({ title: document.id }),
    component: NoteBody,
  },
};

function leafOf(id: string, tabs: string[]): LeafNode {
  return { kind: "leaf", id, tabs, activeTab: tabs[0] ?? null };
}

function splitOf(...children: LayoutNode[]): LayoutNode {
  return { kind: "split", id: "split-1", dir: "row", children };
}

function PassThrough({ children }: { leafId: string; children: ReactNode }) {
  return children;
}

function Tree({ tree, maximized }: { tree: LayoutNode; maximized?: string }) {
  const leaves = tree.kind === "leaf" ? [tree] : (tree.children as LeafNode[]);
  const placements = leaves.flatMap((leaf) =>
    leaf.tabs.map((id) => ({
      document: { id, kind: "note" as const },
      leafId: leaf.id,
      active: id === leaf.activeTab,
    })),
  );

  return (
    <DocumentStage placements={placements} registry={REGISTRY} leafScope={PassThrough}>
      <SplitLayout
        node={tree}
        onLayoutChanged={() => {}}
        maximizedLeafId={maximized}
        renderLeaf={(leaf) => (
          <div data-testid={leaf.id}>
            <EditorSurface
              leafId={leaf.id}
              documents={leaf.tabs.map((id) => ({ id, kind: "note" as const }))}
              activeId={leaf.activeTab}
              registry={REGISTRY}
              dirtyIds={new Set()}
              pinnedIds={[]}
              onActivate={() => {}}
              onClose={() => {}}
            />
          </div>
        )}
      />
    </DocumentStage>
  );
}

describe("DocumentStage", () => {
  beforeEach(() => {
    mounted.mockClear();
    unmounted.mockClear();
  });

  it("keeps a document mounted when the group beside it closes", () => {
    const left = leafOf("leaf-1", ["viewport"]);
    const { rerender } = render(<Tree tree={splitOf(left, leafOf("leaf-2", ["other"]))} />);
    const body = screen.getByTestId("body-viewport");

    rerender(<Tree tree={left} />);

    expect(screen.getByTestId("body-viewport")).toBe(body);
    expect(unmounted).not.toHaveBeenCalledWith("viewport");
    expect(mounted.mock.calls.filter(([id]) => id === "viewport")).toHaveLength(1);
    expect(screen.getByTestId("leaf-1")).toContainElement(body);
  });

  it("keeps a document mounted when a split opens around it", () => {
    const left = leafOf("leaf-1", ["viewport"]);
    const { rerender } = render(<Tree tree={left} />);

    rerender(<Tree tree={splitOf(left, leafOf("leaf-2", ["other"]))} />);

    expect(unmounted).not.toHaveBeenCalled();
    expect(mounted.mock.calls.filter(([id]) => id === "viewport")).toHaveLength(1);
  });

  it("keeps a document mounted and moves its toolbar when it changes group", () => {
    const { rerender } = render(
      <Tree tree={splitOf(leafOf("leaf-1", ["viewport", "a"]), leafOf("leaf-2", ["other"]))} />,
    );

    rerender(
      <Tree tree={splitOf(leafOf("leaf-1", ["a"]), leafOf("leaf-2", ["viewport", "other"]))} />,
    );

    expect(unmounted).not.toHaveBeenCalled();
    expect(screen.getByTestId("leaf-2")).toContainElement(screen.getByTestId("body-viewport"));
    expect(screen.getByTestId("leaf-2")).toContainElement(screen.getByTestId("toolbar-viewport"));
  });

  it("keeps the documents of other groups mounted and hidden while one is maximized", () => {
    const tree = splitOf(leafOf("leaf-1", ["viewport"]), leafOf("leaf-2", ["other"]));
    const { rerender } = render(<Tree tree={tree} />);
    const body = screen.getByTestId("body-other");

    rerender(<Tree tree={tree} maximized="leaf-1" />);

    expect(unmounted).not.toHaveBeenCalled();
    expect(body).not.toBeInTheDocument();
    expect(body).toHaveAttribute("data-visible", "false");

    rerender(<Tree tree={tree} />);

    expect(screen.getByTestId("body-other")).toBe(body);
    expect(body).toHaveAttribute("data-visible", "true");
  });

  it("unmounts a document only when its tab closes", () => {
    const { rerender } = render(<Tree tree={leafOf("leaf-1", ["viewport", "other"])} />);

    rerender(<Tree tree={leafOf("leaf-1", ["viewport"])} />);

    expect(unmounted).toHaveBeenCalledTimes(1);
    expect(unmounted).toHaveBeenCalledWith("other");
  });
});

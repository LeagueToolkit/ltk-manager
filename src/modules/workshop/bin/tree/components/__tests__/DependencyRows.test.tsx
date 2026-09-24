// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ContextMenu, ToastProvider } from "@/components";
import type { Dependency, LinkChange } from "@/lib/tauri";
import { editCall, landed, sentEdit } from "@/test/binEdit";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../../../projects/state/ProjectContext";
import { type DeclaredRows, DeclaredRowsContext } from "../../../documents/hooks/useDeclared";
import { BinEditContext, useBinEditor } from "../../hooks/useBinEdit";
import { DependencyEditingContext } from "../../state/dependencyEditing";
import {
  type AddLine,
  DEPENDENCIES_KEY,
  DEPENDENCY_ADD_KEY,
  dependencyKey,
  flattenRows,
  type VisibleRow,
} from "../../utils/binRows";
import { DependencyMenu } from "../DependencyMenu";
import { DependencyAddLine, type DependencyLine, DependencyRow } from "../DependencyRows";
import { DOCUMENT, NO_FOCUS, ASSET, PROJECT } from "./binEditFixtures";

const PACKED_PATH = "data/aatrox_skins_root_skins_skin0_skins_skin1_skins_skin2.bin";
const PACKED: Dependency = {
  path: PACKED_PATH,
  packed: "data/aatrox❮_skins{_root,_skin{0→2}}❯.bin",
};
const PLAIN: Dependency = { path: "DATA/Characters/Teemo/Teemo.bin", packed: null };

function line(dependency: Dependency, index = 0, count = 2): DependencyLine {
  return { kind: "dependency", key: dependencyKey(index), depth: 1, index, dependency, count };
}

function declaredRows(links: ReadonlyMap<string, LinkChange>): DeclaredRows {
  return {
    layer: "base",
    marks: new Map(),
    diagnostics: new Map(),
    objects: new Map(),
    links,
    editable: true,
  };
}

function Editable({ children }: { children: ReactNode }) {
  const edit = useBinEditor(DOCUMENT, ASSET, true, NO_FOCUS);
  return <BinEditContext value={edit}>{children}</BinEditContext>;
}

const startEditing = vi.fn<(index: number | null) => void>();

function Providers({
  declared = null,
  children,
}: {
  declared?: DeclaredRows | null;
  children: ReactNode;
}) {
  const [client] = useState(() => createTestQueryClient());
  return (
    <QueryClientProvider client={client}>
      <ProjectProvider project={PROJECT}>
        <ToastProvider>
          <DeclaredRowsContext value={declared}>
            <DependencyEditingContext value={{ index: null, start: startEditing }}>
              <Editable>{children}</Editable>
            </DependencyEditingContext>
          </DeclaredRowsContext>
        </ToastProvider>
      </ProjectProvider>
    </QueryClientProvider>
  );
}

function Menu({ at, declared }: { at: VisibleRow; declared?: DeclaredRows | null }) {
  return (
    <Providers declared={declared}>
      <ContextMenu.Root>
        <ContextMenu.Trigger>
          <span>the row</span>
        </ContextMenu.Trigger>
        <DependencyMenu line={at} />
      </ContextMenu.Root>
    </Providers>
  );
}

async function openMenu() {
  const user = userEvent.setup();
  await user.pointer({ keys: "[MouseRight]", target: screen.getByText("the row") });
  return user;
}

beforeEach(() => {
  startEditing.mockClear();
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string, args?: Record<string, unknown>) => {
    const dependency = sentEdit(command, args, "dependency");
    if (dependency?.edit.kind === "insert") return landed({ kind: "index", index: 2 });
    if (dependency !== null) return landed();
    return Promise.resolve({ ok: true, value: null });
  });
});

describe("the pinned dependencies row", () => {
  it("folds its dependencies until it opens, and an editable tree closes them with an add line", () => {
    const list = [PLAIN, PACKED];
    const pinned = { list, document: DOCUMENT };

    const folded = flattenRows([], new Set(), () => undefined, null, null, pinned);
    expect(folded.map((each) => each.kind)).toEqual(["dependencies"]);
    expect(folded[0]).toMatchObject({ count: 2, expanded: false });

    const open = new Set([DEPENDENCIES_KEY]);
    const readOnly = flattenRows([], open, () => undefined, null, null, pinned);
    expect(readOnly.map((each) => each.key)).toEqual([
      DEPENDENCIES_KEY,
      dependencyKey(0),
      dependencyKey(1),
    ]);

    const adds = { document: DOCUMENT, rootEntry: null };
    const editable = flattenRows([], open, () => undefined, null, adds, pinned);
    expect(editable.at(-1)).toMatchObject({
      kind: "add",
      key: DEPENDENCY_ADD_KEY,
      target: { kind: "dependency" },
    });
  });
});

describe("a dependency row", () => {
  it("reads the brex spelling and names the path itself", () => {
    render(
      <Providers>
        <DependencyRow line={line(PACKED, 1)} />
      </Providers>,
    );

    expect(screen.getByTitle(PACKED_PATH)).toHaveTextContent(PACKED.packed!);
    expect(screen.getByRole("treeitem", { name: PACKED_PATH })).toBeInTheDocument();
  });

  it("removes itself from its hover action", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <DependencyRow line={line(PLAIN)} />
      </Providers>,
    );

    await user.click(screen.getByRole("button", { name: "Remove dependency" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        ...editCall(DOCUMENT, { kind: "dependency", edit: { kind: "remove", index: 0 } }),
      ),
    );
  });

  it("draws one the chosen layer removes struck through, with Restore", async () => {
    const user = userEvent.setup();
    const removed = declaredRows(new Map([[PLAIN.path.toLowerCase(), "removed"]]));
    render(
      <Providers declared={removed}>
        <DependencyRow line={line(PLAIN)} />
      </Providers>,
    );

    expect(screen.getByText(PLAIN.path)).toHaveClass("line-through");
    expect(screen.queryByRole("button", { name: "Remove dependency" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Restore dependency" }));

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        ...editCall(DOCUMENT, { kind: "dependency", edit: { kind: "restore", path: PLAIN.path } }),
      ),
    );
  });
});

describe("the dependency menu", () => {
  it("offers Open, Copy path, Edit path and Remove, and copies the path rather than its brex", async () => {
    render(<Menu at={line(PACKED, 0)} />);
    const user = await openMenu();
    const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    /* The setup installs a clipboard of its own, so the spy goes in after it. */
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

    for (const name of ["Open file", "Copy path", "Edit path", "Move down", "Remove dependency"]) {
      expect(await screen.findByRole("menuitem", { name })).toBeInTheDocument();
    }
    await user.click(screen.getByRole("menuitem", { name: "Copy path" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(PACKED_PATH));
  });

  it("starts editing the row it was opened on", async () => {
    render(<Menu at={line(PLAIN, 1)} />);
    const user = await openMenu();

    await user.click(await screen.findByRole("menuitem", { name: "Edit path" }));

    expect(startEditing).toHaveBeenCalledWith(1);
  });

  it("refuses a rename and a move in a declared document, with the reason", async () => {
    render(<Menu at={line(PLAIN, 0)} declared={declaredRows(new Map())} />);
    await openMenu();

    const edit = await screen.findByRole("menuitem", { name: "Edit path" });
    expect(edit).toHaveAttribute("aria-disabled", "true");
    expect(edit.getAttribute("title")).toMatch(/does not reorder or rename/);
    expect(screen.getByRole("menuitem", { name: "Remove dependency" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });
});

describe("the dependency add line", () => {
  const addLine: AddLine = {
    kind: "add",
    key: DEPENDENCY_ADD_KEY,
    document: DOCUMENT,
    entry: "",
    path: "",
    depth: 1,
    target: { kind: "dependency" },
    index: null,
  };

  it("adds what is typed at the end and clears for the next", async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <DependencyAddLine line={addLine} autoFocus={false} />
      </Providers>,
    );
    const field = screen.getByRole("textbox", { name: "Add dependency" });

    await user.click(field);
    await user.paste(PACKED.packed!);
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(mockInvoke).toHaveBeenCalledWith(
        ...editCall(DOCUMENT, {
          kind: "dependency",
          edit: { kind: "insert", index: null, text: PACKED.packed! },
        }),
      ),
    );
    await waitFor(() => expect(field).toHaveValue(""));
  });

  it("keeps a refused path with the reason under it", async () => {
    mockInvoke.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        error: {
          code: "BIN_EDIT_REJECTED",
          address: "dependencies",
          rejection: { reason: "malformedBrex" },
        },
      }),
    );
    const user = userEvent.setup();
    render(
      <Providers>
        <DependencyAddLine line={addLine} autoFocus={false} />
      </Providers>,
    );
    const field = screen.getByRole("textbox", { name: "Add dependency" });

    await user.type(field, "data/❮broken{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The brex spelling does not expand to one path.",
    );
    expect(field).toHaveValue("data/❮broken");
    expect(field).toHaveAttribute("aria-invalid", "true");
  });
});

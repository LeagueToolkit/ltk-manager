// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { ObjectNodeEntry } from "@/lib/tauri";
import { createTestQueryClient } from "@/test/utils";

import { nameHash } from "../../../bin/shared/utils/binHash";
import { objectDocumentId } from "../../../documents/utils/contentDocument";
import { objectKeys } from "../../api/keys";
import { objectListingNodes } from "../../utils/objectTree";
import { siblingSystem, useSystemSteps } from "../useSystemSteps";

const state = vi.hoisted(() => ({ open: vi.fn() }));

vi.mock("../useLayerDeclarations", () => ({ useLayerDeclarations: () => new Map() }));
vi.mock("../useOpenObjectNode", async (original) => ({
  ...(await original<typeof import("../useOpenObjectNode")>()),
  useOpenObjectNode: () => state.open,
}));

function entry(name: string, className = "VfxSystemDefinitionData"): ObjectNodeEntry {
  return {
    objectHash: `0x0000000${name.charCodeAt(0).toString(16).slice(-1)}`,
    path: `Effects/${name}`,
    name,
    count: 0,
    declarations: [
      {
        asset: { kind: "gameChunk", wad: "test.wad.client", pathHash: "00aa" },
        file: "test.bin",
        class: className,
        classHash: nameHash(className),
      },
    ],
  };
}

const FOLDER = [
  entry("Alpha"),
  entry("Bravo", "SkinCharacterDataProperties"),
  entry("Charlie"),
  entry("Delta"),
];
const nodes = objectListingNodes({ prefixes: [], objects: FOLDER }, new Map());

it("steps over other kinds of object to the next particle system, and stops at the ends", () => {
  expect(siblingSystem(nodes, FOLDER[0]!.objectHash, 1)?.name).toBe("Charlie");
  expect(siblingSystem(nodes, FOLDER[2]!.objectHash, -1)?.name).toBe("Alpha");
  expect(siblingSystem(nodes, FOLDER[0]!.objectHash, -1)).toBeNull();
  expect(siblingSystem(nodes, FOLDER[3]!.objectHash, 1)).toBeNull();
  expect(siblingSystem(nodes, "0xffffffff", 1)).toBeNull();
});

function Tab({ name }: { name: string }) {
  const system = FOLDER.find((candidate) => candidate.name === name)!;
  const steps = useSystemSteps({
    enabled: true,
    documentId: objectDocumentId(system.declarations[0]!.asset, system.objectHash),
    objectHash: system.objectHash.toUpperCase(),
    objectPath: system.path,
    active: true,
  });

  return (
    <div ref={steps.root} tabIndex={-1} onKeyDown={steps.onKeyDown}>
      <span>toolbar</span>
      <div role="group" tabIndex={-1} className="run box">
        {name}
      </div>
      <input aria-label="field" />
      <span role="button" tabIndex={0} onKeyDown={(event) => event.preventDefault()}>
        taken
      </span>
    </div>
  );
}

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const created = createTestQueryClient();
    created.setQueryData(objectKeys.dir("Effects"), {
      status: "ready",
      prefixes: [],
      objects: FOLDER,
    });
    return created;
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  state.open.mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

it("opens the next particle system of the folder the way a click does", async () => {
  render(<Tab name="Alpha" />, { wrapper: Providers });

  fireEvent.keyDown(screen.getByText("Alpha"), { key: "ArrowDown", altKey: true });
  await flush();
  expect(state.open).toHaveBeenCalledWith(expect.objectContaining({ name: "Charlie" }), "default");
});

it("does nothing at the end of the folder", async () => {
  render(<Tab name="Delta" />, { wrapper: Providers });

  fireEvent.keyDown(screen.getByText("Delta"), { key: "ArrowDown", altKey: true });
  await flush();
  expect(state.open).not.toHaveBeenCalled();
});

it("leaves the keys to a text field and to a control that took them", async () => {
  render(<Tab name="Alpha" />, { wrapper: Providers });

  fireEvent.keyDown(screen.getByLabelText("field"), { key: "ArrowDown", altKey: true });
  fireEvent.keyDown(screen.getByText("taken"), { key: "ArrowDown", altKey: true });
  fireEvent.keyDown(screen.getByText("Alpha"), { key: "ArrowDown", altKey: true, shiftKey: true });
  await flush();
  expect(state.open).not.toHaveBeenCalled();
});

it("moves focus into the tab a step opens, onto the element that matches the one it left", async () => {
  const { rerender } = render(<Tab key="Alpha" name="Alpha" />, { wrapper: Providers });
  const box = screen.getByText("Alpha");
  box.focus();

  fireEvent.keyDown(box, { key: "ArrowDown", altKey: true });
  await flush();
  rerender(<Tab key="Charlie" name="Charlie" />);
  await act(async () => {
    await new Promise((resolve) => requestAnimationFrame(resolve));
  });

  expect(screen.getByText("Charlie")).toHaveFocus();
});

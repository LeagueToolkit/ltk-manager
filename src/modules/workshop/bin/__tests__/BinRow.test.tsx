// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type ReactNode, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "@/components";
import type { BinRow, ClassSchema, WorkshopProject } from "@/lib/tauri";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient } from "@/test/utils";

import { ProjectProvider } from "../../components/ProjectContext";
import { nameHash } from "../binHash";
import { BinRowLine } from "../BinRow";
import type { RowLine } from "../binRows";
import { ValueMarksContext } from "../useValueMarks";
import type { ValueMark } from "../valueRows";

const ENTRY = "0x2a1f3c7d";
const SKIN_CLASS = "0x9b67e9f6";

/** Past the hover delay a card opens after. */
const HOVER = { timeout: 2000 };

function row(overrides: Partial<BinRow>): BinRow {
  return {
    entry: ENTRY,
    path: "0000000a",
    label: "name",
    node: "property",
    name: "name",
    unnamed: false,
    kind: "string",
    value: { type: "string", value: "text" },
    declared: null,
    ...overrides,
  };
}

function line(row: BinRow, owner: string | null = SKIN_CLASS): RowLine {
  return {
    kind: "row",
    key: `${row.entry}:${row.path}`,
    row,
    depth: 1,
    expanded: false,
    loading: false,
    owner,
  };
}

const SCHEMA: ClassSchema = {
  name: "SkinCharacterDataProperties",
  build: 8104348,
  patch: "16.17",
  fields: [
    {
      hash: "0x0000000a",
      name: "championSkinName",
      declared: { kind: "string", key: null, value: null },
      revisions: [
        {
          from: 5229820,
          to: 8049184,
          shape: { kind: "hash", key: null, value: null },
        },
        {
          from: 8104348,
          to: null,
          shape: { kind: "string", key: null, value: null },
        },
      ],
    },
    {
      hash: "0x0000000b",
      name: "iconCircle",
      declared: { kind: "option", key: null, value: "file" },
      revisions: [
        {
          from: 5229820,
          to: null,
          shape: { kind: "option", key: null, value: "file" },
        },
      ],
    },
  ],
};

/* The class card offers Find all references, which opens a document of the project the
   card is mounted in. */
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

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => createTestQueryClient());
  return (
    <QueryClientProvider client={client}>
      <ProjectProvider project={PROJECT}>
        <ToastProvider>{children}</ToastProvider>
      </ProjectProvider>
    </QueryClientProvider>
  );
}

function renderLine(visible: RowLine, onToggle: (key: string) => void = () => {}) {
  return render(<BinRowLine line={visible} focused={false} onToggle={onToggle} />, {
    wrapper: Providers,
  });
}

beforeEach(() => {
  mockInvoke.mockReset();
  mockInvoke.mockImplementation((command: string) => {
    if (command === "class_schema") return Promise.resolve({ ok: true, value: SCHEMA });
    return Promise.reject(new Error(`unexpected command ${command}`));
  });
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
});

describe("the value widgets", () => {
  it("keeps a 64-bit integer's digits, which a JS number would round away", () => {
    renderLine(
      line(
        row({
          kind: "u64",
          value: { type: "integer", text: "18446744073709551615" },
        }),
      ),
    );

    expect(screen.getByDisplayValue("18446744073709551615")).toHaveAttribute("readonly");
  });

  it("draws a string in a field of its own", () => {
    renderLine(line(row({ value: { type: "string", value: "Justicar Aatrox" } })));

    expect(screen.getByDisplayValue("Justicar Aatrox")).toBeInTheDocument();
  });

  it("gives a vector one field per axis, each named by it", () => {
    renderLine(line(row({ kind: "vec3", value: { type: "vector", values: [1, -0.5, 0] } })));

    expect(screen.getByRole("textbox", { name: "x" })).toHaveValue("1");
    expect(screen.getByRole("textbox", { name: "y" })).toHaveValue("-0.5");
    expect(screen.getByRole("textbox", { name: "z" })).toHaveValue("0");
  });

  it("draws a bool as a checkbox nothing can toggle", () => {
    renderLine(line(row({ kind: "bool", value: { type: "bool", value: true } })));

    const box = screen.getByRole("checkbox");
    expect(box).toBeChecked();
    expect(box).toHaveAttribute("aria-readonly", "true");
  });

  it("leaves the row's click alone when a field is clicked", async () => {
    const onToggle = vi.fn();
    renderLine(
      line(
        row({
          kind: "embed",
          value: {
            type: "struct",
            classHash: SKIN_CLASS,
            class: "Part",
            len: 1,
          },
        }),
      ),
      onToggle,
    );

    await userEvent.click(screen.getByText("Part"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("takes no tab stop, so a document of rows is not a tab order", () => {
    renderLine(line(row({ value: { type: "string", value: "Justicar Aatrox" } })));

    expect(screen.getByDisplayValue("Justicar Aatrox")).toHaveAttribute("tabindex", "-1");
  });
});

describe("the tag", () => {
  it("follows every property and element row, composed from what the value holds", () => {
    renderLine(
      line(
        row({
          name: "armorMaterial",
          kind: "list",
          value: { type: "container", len: 8, itemKind: "embed" },
        }),
      ),
    );
    expect(screen.getByText("list[embed]")).toBeInTheDocument();
  });

  it("is absent from an element, whose declaring property already names the kind", () => {
    renderLine(
      line(
        row({
          node: "element",
          path: "0000000a[0]",
          name: "[0]",
          kind: "map",
          value: { type: "map", len: 2, keyKind: "hash", valueKind: "string" },
        }),
        null,
      ),
    );
    expect(screen.queryByText("map[hash,string]")).toBeNull();
  });

  it("gives an element that holds a struct its class beside the index", () => {
    renderLine(
      line(
        row({
          node: "element",
          path: "0000000a[0]",
          name: "[0]",
          kind: "embed",
          value: {
            type: "struct",
            classHash: SKIN_CLASS,
            class: "Part",
            len: 3,
          },
        }),
        null,
      ),
    );
    expect(screen.getByText("[0]")).toBeInTheDocument();
    expect(screen.getByText("Part")).toBeInTheDocument();
    expect(screen.queryByText("3 properties")).not.toBeInTheDocument();
  });

  it("is absent from an object row", () => {
    renderLine(
      line(
        row({
          node: "object",
          path: "",
          name: "Characters/Aatrox",
          kind: null,
          value: {
            type: "struct",
            classHash: SKIN_CLASS,
            class: "CharacterRecord",
            len: 2,
          },
        }),
        null,
      ),
    );
    expect(screen.queryByText("pointer")).toBeNull();
    expect(screen.queryByRole("img", { name: "Type mismatch" })).toBeNull();
  });
});

describe("the mismatch mark", () => {
  it("marks a row whose file kind differs from the declared one, and names the declared kind", async () => {
    renderLine(
      line(
        row({
          name: "iconCircle",
          kind: "string",
          declared: {
            shape: { kind: "option", key: null, value: "file" },
            mismatch: true,
          },
        }),
      ),
    );

    await userEvent.hover(screen.getByRole("img", { name: "Type mismatch" }));
    const declared = await screen.findByText("option[file]", {}, HOVER);
    expect(declared.parentElement).toHaveTextContent(/^Declared\s*option\[file\]$/);
  });

  it("leaves the tag itself without a tooltip, which the card already answers", async () => {
    renderLine(
      line(
        row({
          name: "iconCircle",
          kind: "string",
          declared: {
            shape: { kind: "string", key: null, value: null },
            mismatch: false,
          },
        }),
      ),
    );

    await userEvent.hover(screen.getByText("string"));
    await expect(screen.findByText("Declared", {}, HOVER)).rejects.toThrow();
  });

  it("leaves a row the schema agrees with unmarked", () => {
    renderLine(
      line(
        row({
          declared: {
            shape: { kind: "string", key: null, value: null },
            mismatch: false,
          },
        }),
      ),
    );
    expect(screen.queryByRole("img", { name: "Type mismatch" })).toBeNull();
  });
});

describe("the class card", () => {
  const embed = row({
    name: "skinMeshProperties",
    kind: "embed",
    value: {
      type: "struct",
      classHash: SKIN_CLASS,
      class: "SkinCharacterDataProperties",
      len: 2,
    },
  });

  it("opens on hover with the build it read, and sends the fields to the wiki", async () => {
    renderLine(line(embed));

    await userEvent.hover(screen.getByText("SkinCharacterDataProperties"));
    const card = await screen.findByRole("tooltip", { name: "SkinCharacterDataProperties" }, HOVER);

    expect(await within(card).findByText("patch 16.17")).toBeInTheDocument();
    expect(within(card).queryByText("championSkinName")).toBeNull();
    expect(within(card).getByRole("link", { name: /meta wiki/ })).toHaveAttribute(
      "href",
      "https://meta-wiki.leaguetoolkit.dev/classes/skincharacterdataproperties/",
    );
    expect(mockInvoke).toHaveBeenCalledWith("class_schema", {
      classHash: SKIN_CLASS,
    });
  });

  it("offers no wiki link for a class no table names, which the wiki cannot address", async () => {
    mockInvoke.mockImplementation(() => Promise.resolve({ ok: true, value: null }));
    renderLine(
      line(
        row({
          kind: "pointer",
          value: {
            type: "struct",
            classHash: "0x0000beef",
            class: null,
            len: 1,
          },
        }),
      ),
    );

    await userEvent.hover(screen.getByText("0x0000beef"));
    const card = await screen.findByRole("tooltip", { name: "0x0000beef" }, HOVER);

    expect(within(card).queryByRole("link")).toBeNull();
  });

  it("carries no action, and leaves the click to the row it sits in", async () => {
    const onToggle = vi.fn();
    renderLine(line(embed), onToggle);

    await userEvent.click(screen.getByText("SkinCharacterDataProperties"));
    expect(onToggle).toHaveBeenCalledWith(`${ENTRY}:0000000a`);
    expect(screen.queryByRole("button", { name: "Copy name" })).toBeNull();
  });

  it("names a class the tables miss by its hash, and says the schema has no line for it", async () => {
    mockInvoke.mockImplementation(() => Promise.resolve({ ok: true, value: null }));
    renderLine(
      line(
        row({
          kind: "pointer",
          value: {
            type: "struct",
            classHash: "0x0000beef",
            class: null,
            len: 1,
          },
        }),
      ),
    );

    await userEvent.hover(screen.getByText("0x0000beef"));
    const card = await screen.findByRole("tooltip", { name: "0x0000beef" }, HOVER);

    expect(await within(card).findByText("Not in the schema")).toBeInTheDocument();
  });
});

describe("the field card", () => {
  const expandable = row({
    name: "championSkinName",
    kind: "embed",
    value: { type: "struct", classHash: SKIN_CLASS, class: "Part", len: 1 },
    declared: {
      shape: { kind: "string", key: null, value: null },
      mismatch: false,
    },
  });

  it("opens on hover with the declared kind and the revisions", async () => {
    renderLine(line(expandable));

    await userEvent.hover(screen.getByText("championSkinName"));
    const card = await screen.findByRole("tooltip", { name: "championSkinName" }, HOVER);

    expect(await within(card).findByText("5229820 – 8049184")).toBeInTheDocument();
    expect(within(card).getByText("since 8104348")).toBeInTheDocument();
    expect(within(card).getByText("Declared")).toBeInTheDocument();
    expect(within(card).getByText("0x0000000a")).toBeInTheDocument();
  });

  it("carries no action, and leaves the click to the row it sits in", async () => {
    const onToggle = vi.fn();
    renderLine(line(expandable), onToggle);

    await userEvent.click(screen.getByText("championSkinName"));
    expect(onToggle).toHaveBeenCalledWith(`${ENTRY}:0000000a`);
    expect(screen.queryByRole("button", { name: "Copy name" })).toBeNull();
  });

  it("says a field the schema has no line for is not declared", async () => {
    renderLine(line(row({ name: "0x9c4e1b02", unnamed: true, path: "9c4e1b02" })));

    await userEvent.hover(screen.getByText("0x9c4e1b02"));
    const card = await screen.findByRole("tooltip", { name: "0x9c4e1b02" }, HOVER);

    expect(within(card).getByText("Not declared at this build")).toBeInTheDocument();
  });
});

describe("a value family's row", () => {
  const KEY = `${ENTRY}:0000000a`;

  function renderMarked(mark: ValueMark) {
    const marked = line(
      row({
        kind: "embed",
        value: {
          type: "struct",
          classHash: nameHash("ValueColor"),
          class: "ValueColor",
          len: 2,
        },
      }),
    );
    return render(
      <ValueMarksContext value={new Map([[KEY, mark]])}>
        <BinRowLine line={marked} focused={false} onToggle={() => {}} />
      </ValueMarksContext>,
      { wrapper: Providers },
    );
  }

  it("draws the swatch and the strip on the collapsed row of a colour with dynamics", () => {
    renderMarked({
      family: "color",
      constant: { type: "vector", values: [1, 0.5, 0, 1] },
      keys: [
        { time: 0, values: [1, 0, 0, 1] },
        { time: 1, values: [0, 0, 1, 1] },
      ],
      tables: [],
      curve: true,
    });

    expect(screen.getByText("ValueColor")).toBeInTheDocument();
    expect(screen.getByLabelText("2 colour stops")).toBeInTheDocument();
  });

  it("draws the strip alone for a colour whose file writes no constant", () => {
    renderMarked({
      family: "color",
      constant: null,
      keys: [
        { time: 0, values: [1, 0, 0, 1] },
        { time: 1, values: [0, 0, 1, 1] },
      ],
      tables: [],
      curve: true,
    });

    expect(screen.getByLabelText("2 colour stops")).toBeInTheDocument();
  });

  it("draws no strip for a colour with no dynamics", () => {
    renderMarked({
      family: "color",
      constant: { type: "vector", values: [1, 1, 1, 1] },
      keys: [],
      tables: [],
      curve: false,
    });

    expect(screen.queryByLabelText(/colour stop/)).toBeNull();
  });

  it("draws a float's and a vector's constant in the field a leaf row draws", () => {
    renderMarked({
      family: "scalar",
      constant: { type: "float", value: 2.5 },
      keys: [],
      tables: [],
      curve: false,
    });
    expect(screen.getByDisplayValue("2.5")).toHaveAttribute("readonly");

    renderMarked({
      family: "vector",
      constant: { type: "vector", values: [0, 1.5, 0] },
      keys: [],
      tables: [],
      curve: false,
    });
    expect(screen.getByDisplayValue("1.5")).toHaveAttribute("readonly");
  });

  it("draws a random range as its two bounds, where the tables have been read", () => {
    renderMarked({
      family: "scalar",
      constant: { type: "float", value: 1.5 },
      keys: [],
      tables: [
        {
          channel: 0,
          single: 1,
          keys: [
            { time: 0, values: [0.8] },
            { time: 1, values: [1.2] },
          ],
        },
      ],
      curve: true,
    });

    expect(screen.getByDisplayValue("1.2")).toHaveAttribute("readonly");
    expect(screen.getByDisplayValue("1.8")).toHaveAttribute("readonly");
    expect(screen.queryByDisplayValue("1.5")).toBeNull();
  });

  it("draws nothing extra before the read lands", () => {
    renderMarked({ family: "color", constant: null, keys: [], tables: [], curve: false });

    expect(screen.queryByLabelText(/colour stop/)).toBeNull();
  });
});

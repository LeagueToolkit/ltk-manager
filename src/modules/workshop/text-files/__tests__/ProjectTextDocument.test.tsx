// @vitest-environment happy-dom

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { WorkshopProject } from "@/lib/tauri";
import { DocumentToolbarSlotContext } from "@/modules/editor";
import { mockInvoke } from "@/test/mocks/tauri";
import { renderWithProviders } from "@/test/utils";

import { ProjectProvider } from "../../components/ProjectContext";
import { projectTextDocument } from "../../documents";
import { ProjectTextDocument } from "../ProjectTextDocument";

const PROJECT_PATH = "C:/mods/my-mod";

const world = {
  text: "# My Mod\n" as string | null,
  readable: true,
  changed: false,
};

function file() {
  return {
    path: `${PROJECT_PATH}/README.md`,
    text: world.text,
    readable: world.readable,
    revision: world.text === null ? null : { modifiedMs: 1, size: world.text.length },
  };
}

function answer(command: string): unknown {
  switch (command) {
    case "get_project_text":
      return { ok: true, value: file() };
    case "save_project_text":
      if (world.changed) {
        return {
          ok: false,
          error: {
            code: "WORKSHOP",
            error: { kind: "TEXT_FILE_CHANGED", path: `${PROJECT_PATH}/README.md` },
          },
        };
      }
      return { ok: true, value: file() };
    default:
      return { ok: true, value: null };
  }
}

function calls(command: string) {
  return mockInvoke.mock.calls.filter(([name]) => name === command);
}

function project(): WorkshopProject {
  return {
    path: PROJECT_PATH,
    name: "my-mod",
    displayName: "My Mod",
    version: "1.0.0",
    description: "",
    authors: [],
    tags: [],
    champions: [],
    maps: [],
    layers: [],
    thumbnailPath: null,
    lastModified: "2026-09-12T00:00:00Z",
  };
}

/* The toolbar draws into the surface's own slot, so the test supplies one. */
function Harness() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  return (
    <ProjectProvider project={project()}>
      <div ref={setSlot} />
      <DocumentToolbarSlotContext value={slot}>
        <ProjectTextDocument document={projectTextDocument("readme")} active />
      </DocumentToolbarSlotContext>
    </ProjectProvider>
  );
}

function draw() {
  return renderWithProviders(<Harness />);
}

describe("ProjectTextDocument", () => {
  beforeEach(() => {
    world.text = "# My Mod\n";
    world.readable = true;
    world.changed = false;
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((command: string) => Promise.resolve(answer(command)));
  });

  it("renders the file's own text", async () => {
    draw();

    expect(await screen.findByRole("textbox", { name: "Readme text" })).toHaveValue("# My Mod\n");
  });

  it("saves an edit on its own", async () => {
    const user = userEvent.setup();
    draw();

    await user.type(await screen.findByRole("textbox", { name: "Readme text" }), "\nWhat it does.");

    await waitFor(() => expect(calls("save_project_text")).toHaveLength(1));
    expect(calls("save_project_text")[0]?.[1]).toMatchObject({
      projectPath: PROJECT_PATH,
      file: "readme",
      text: "# My Mod\n\nWhat it does.",
      expected: { modifiedMs: 1, size: 9 },
    });
  });

  it("offers to write a readme the project does not have", async () => {
    world.text = null;
    const user = userEvent.setup();
    draw();

    await user.click(await screen.findByRole("button", { name: "Write one" }));

    await waitFor(() => expect(calls("save_project_text")).toHaveLength(1));
    expect(calls("save_project_text")[0]?.[1]).toMatchObject({ text: "# My Mod\n" });
  });

  it("refuses to edit a file that is not text", async () => {
    world.readable = false;
    world.text = null;
    draw();

    expect(await screen.findByText("This file is not text")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Readme text" })).not.toBeInTheDocument();
  });

  it("asks what to do when the file changed underneath", async () => {
    world.changed = true;
    const user = userEvent.setup();
    draw();

    await user.type(await screen.findByRole("textbox", { name: "Readme text" }), "x");

    expect(await screen.findByRole("button", { name: "Keep mine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();

    /* One attempt, and no loop: the creator's answer is what asks again. */
    await waitFor(() => expect(calls("save_project_text")).toHaveLength(1));
  });

  it("writes over the file when the creator keeps their own", async () => {
    world.changed = true;
    const user = userEvent.setup();
    draw();

    await user.type(await screen.findByRole("textbox", { name: "Readme text" }), "x");

    const keepMine = await screen.findByRole("button", { name: "Keep mine" });
    world.changed = false;
    await user.click(keepMine);

    await waitFor(() => expect(calls("save_project_text")).toHaveLength(2));
    expect(calls("save_project_text")[1]?.[1]).toMatchObject({ expected: null });
  });

  it("appends the template sections the file lacks", async () => {
    const user = userEvent.setup();
    draw();

    await user.click(await screen.findByRole("button", { name: "Insert template" }));

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Readme text" })).toHaveValue(
        "# My Mod\n\n## About\n\n## Installing\n\n## Credits\n",
      ),
    );
  });

  it("renders the markdown beside the buffer", async () => {
    world.text = "# My Mod\n\nIt swaps a skin.\n";
    draw();

    await screen.findByRole("textbox", { name: "Readme text" });
    expect(await screen.findByRole("heading", { name: "My Mod" })).toBeInTheDocument();
    expect(screen.getByText("It swaps a skin.")).toBeInTheDocument();
  });
});

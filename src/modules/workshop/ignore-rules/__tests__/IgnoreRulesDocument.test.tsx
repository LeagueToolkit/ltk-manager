// @vitest-environment happy-dom

import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { WorkshopProject } from "@/lib/tauri";
import { DocumentToolbarSlotContext } from "@/modules/editor";
import { mockInvoke } from "@/test/mocks/tauri";
import { createTestQueryClient, renderWithProviders } from "@/test/utils";

import { workshopKeys } from "../../api";
import { ProjectProvider } from "../../components/ProjectContext";
import { ignoreRulesDocument } from "../../documents";
import { IgnoreRulesDocument } from "../IgnoreRulesDocument";

const PROJECT_PATH = "C:/mods/my-mod";
const RECOMMENDED = "# .modignore\n*.psd\n*.fbx\n";

const world = {
  text: "*.psd\n" as string | null,
  refusal: null as { line: number; message: string } | null,
};

function answer(command: string): unknown {
  switch (command) {
    case "get_project_ignore_rules":
      return {
        ok: true,
        value: {
          path: `${PROJECT_PATH}/.modignore`,
          text: world.text,
          missingRecommended: world.text === null ? ["*.psd", "*.fbx"] : ["*.fbx"],
        },
      };
    case "save_project_ignore_rules":
      if (world.refusal) {
        return {
          ok: false,
          error: {
            code: "WORKSHOP",
            error: { kind: "IGNORE_RULE_PATTERN", ...world.refusal },
          },
        };
      }
      return {
        ok: true,
        value: {
          path: `${PROJECT_PATH}/.modignore`,
          text: world.text,
          missingRecommended: [],
        },
      };
    case "add_recommended_ignore_rules":
      return {
        ok: true,
        value: {
          path: `${PROJECT_PATH}/.modignore`,
          text: RECOMMENDED,
          missingRecommended: [],
        },
      };
    case "recommended_ignore_rules":
      return { ok: true, value: RECOMMENDED };
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

/* The toolbar draws into the surface's own slot, so the test supplies one and
   the chrome the document contributes is on screen. */
function Harness() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  return (
    <ProjectProvider project={project()}>
      <div ref={setSlot} />
      <DocumentToolbarSlotContext value={slot}>
        <IgnoreRulesDocument document={ignoreRulesDocument()} active />
      </DocumentToolbarSlotContext>
    </ProjectProvider>
  );
}

function draw() {
  return renderWithProviders(<Harness />);
}

/** The same document over a client the caller can watch. */
function drawWatched() {
  const client = createTestQueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe("IgnoreRulesDocument", () => {
  beforeEach(() => {
    vi.useRealTimers();
    world.text = "*.psd\n";
    world.refusal = null;
    mockInvoke.mockReset();
    mockInvoke.mockImplementation((command: string) => Promise.resolve(answer(command)));
  });

  it("renders the file's own rules", async () => {
    draw();

    const buffer = await screen.findByRole("textbox", { name: "Ignore rules" });
    expect(buffer).toHaveValue("*.psd\n");
  });

  it("saves an edit on its own", async () => {
    const user = userEvent.setup();
    draw();

    const buffer = await screen.findByRole("textbox", { name: "Ignore rules" });
    await user.type(buffer, "*.fbx");

    await waitFor(() => expect(calls("save_project_ignore_rules")).toHaveLength(1));
    expect(calls("save_project_ignore_rules")[0]?.[1]).toMatchObject({
      projectPath: PROJECT_PATH,
      text: "*.psd\n*.fbx",
    });
  });

  /* The tree draws what the rules exclude, so a save is a fact about it. */
  it("invalidates the content tree when a save lands", async () => {
    const user = userEvent.setup();
    const { invalidate } = drawWatched();

    const buffer = await screen.findByRole("textbox", { name: "Ignore rules" });
    await user.type(buffer, "*.fbx");

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: workshopKeys.contentTree(PROJECT_PATH),
      }),
    );
  });

  it("marks the line a refused pattern sits on and stops saving", async () => {
    world.refusal = { line: 2, message: "error parsing glob 'a{b'" };
    const user = userEvent.setup();
    draw();

    const buffer = await screen.findByRole("textbox", { name: "Ignore rules" });
    /* `{{` is how userEvent's keyboard spells one literal brace. */
    await user.type(buffer, "a{{b");

    await waitFor(() => expect(screen.getByText(/error parsing glob/)).toBeInTheDocument());
    expect(screen.getByText("Fix the rule to save")).toBeInTheDocument();

    /* One attempt, and no loop: the next edit is what asks again. */
    await waitFor(() => expect(calls("save_project_ignore_rules")).toHaveLength(1));
  });

  it("offers the whole default when the project has no file", async () => {
    world.text = null;
    const user = userEvent.setup();
    draw();

    await user.click(await screen.findByRole("button", { name: "Write the recommended rules" }));

    await waitFor(() => expect(calls("add_recommended_ignore_rules")).toHaveLength(1));
  });

  it("offers only the missing entries when the file is short of some", async () => {
    const user = userEvent.setup();
    draw();

    await user.click(await screen.findByRole("button", { name: "Add 1 missing recommended rule" }));

    await waitFor(() => expect(calls("add_recommended_ignore_rules")).toHaveLength(1));
  });
});

// @vitest-environment happy-dom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { useContentVisible } from "@/hooks";
import type { WorkshopProject } from "@/lib/tauri";
import { HostedContent, PortalSlot, usePortalHosts } from "@/modules/editor";

import { ProjectProvider } from "../../../../projects/state/ProjectContext";
import { useWorkshopEditorStore } from "../../../../shell/state/workshopEditor";
import type { AbilityRecipe } from "../../../spells/utils/abilityRecipe";
import type { ViewContext } from "../ClassCells";
import { FramePreview, SkinShell } from "../ClassFrames";

function Preview({ name }: { name: string }) {
  const visible = useContentVisible();
  const [identity] = useState(() => crypto.randomUUID());
  return (
    <output data-testid={name} data-visible={visible}>
      {identity}
    </output>
  );
}
vi.mock("../../../skin/components/SkinPreview", () => ({
  SkinPreview: () => <Preview name="character" />,
}));
vi.mock("../../../spells/components/AbilityPreview", () => ({
  default: () => <Preview name="spell" />,
}));
vi.mock("../../../skin/components/ClipsSection", () => ({
  ClipsHost: () => <button>Choose idle clip</button>,
}));
vi.mock("../../../skin/components/ClipTable", () => ({ ClipTabs: () => null }));
vi.mock("../../../material/components/MaterialPane", () => ({ MaterialPane: () => null }));
vi.mock("../ClassSections", () => ({ Sections: () => <button>Inspect character</button> }));
vi.mock("../../../spells/components/SpellsPane", () => ({
  SpellsPane: ({
    onAbilityPreview,
  }: {
    onAbilityPreview: (recipe: AbilityRecipe | null) => void;
  }) => (
    <>
      <button onClick={() => onAbilityPreview(RECIPE)}>Open spell</button>
      <button onClick={() => onAbilityPreview(null)}>Leave spell</button>
    </>
  ),
}));
const RECIPE: AbilityRecipe = {
  version: 1,
  id: "q",
  name: "Q",
  character: "Galio",
  clip: null,
  bone: "",
  release: 0.25,
  castEffect: null,
  projectileEffect: null,
  flightDuration: 0.5,
  impactEffect: null,
  impactDuration: 0.5,
  target: [500, 0, 0],
};
const PROJECT: WorkshopProject = {
  path: "X:/preview",
  name: "preview",
  displayName: "Preview",
  version: "1",
  description: "",
  authors: [],
  tags: [],
  champions: [],
  maps: [],
  layers: [],
  thumbnailPath: null,
  lastModified: "",
  location: "workshop",
  lastOpened: null,
  id: "id-preview",
};
const VIEW: ViewContext = {
  document: 1,
  asset: { kind: "file", path: "skin.bin" },
  classHash: "0x1",
  entry: "0x2",
  frame: "shell",
  objectName: () => "Characters/Galio/Skins/Skin0",
  onNotOpen: () => {},
};
afterEach(cleanup);

/* The preview is hosted above the shell and adopted by its pane, as ClassView does it. */
function HostedSkinShell() {
  const host = usePortalHosts()("preview");
  return (
    <>
      <SkinShell
        placed={[]}
        pages={new Map()}
        entry="0xskin"
        view={VIEW}
        preview={<PortalSlot host={host} />}
      />
      <HostedContent host={host}>
        <FramePreview kind="skin" view={VIEW} entry="0xskin" drawable={false} />
      </HostedContent>
    </>
  );
}

it("switches preview ownership between spells, clips and a separate inspector without remounting", async () => {
  useWorkshopEditorStore.setState({ byProject: {} });
  render(
    <ProjectProvider project={PROJECT}>
      <HostedSkinShell />
    </ProjectProvider>,
  );
  const user = userEvent.setup();
  const character = screen.getByTestId("character");
  expect(character).toHaveAttribute("data-visible", "true");
  await user.click(screen.getByRole("tab", { name: "Spells" }));
  await user.click(screen.getByRole("button", { name: "Open spell" }));
  const spell = await screen.findByTestId("spell");
  await waitFor(() => expect(spell).toHaveAttribute("data-visible", "true"));
  const identity = spell.textContent;
  expect(character).toHaveAttribute("data-visible", "false");
  await user.click(screen.getByRole("tab", { name: "Clips" }));
  expect(character).toHaveAttribute("data-visible", "true");
  expect(spell).toHaveAttribute("data-visible", "false");
  await user.click(screen.getByRole("tab", { name: "Spells" }));
  expect(spell).toHaveAttribute("data-visible", "true");
  await user.click(screen.getByRole("button", { name: "Inspect character" }));
  expect(character).toHaveAttribute("data-visible", "true");
  expect(spell).toHaveAttribute("data-visible", "false");
  await user.click(screen.getByRole("tab", { name: "Spells" }));
  expect(spell).toHaveAttribute("data-visible", "true");
  expect(spell.textContent).toBe(identity);
  await user.click(screen.getByRole("tab", { name: "Inspector" }));
  expect(character).toHaveAttribute("data-visible", "true");
  await user.click(screen.getByRole("tab", { name: "Spells" }));
  await user.click(screen.getByRole("button", { name: "Leave spell" }));
  expect(character).toHaveAttribute("data-visible", "true");
  expect(screen.queryByTestId("spell")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Open spell" }));
  await screen.findByTestId("spell");
  await user.click(screen.getByRole("button", { name: "Close Spells" }));
  expect(character).toHaveAttribute("data-visible", "true");
});

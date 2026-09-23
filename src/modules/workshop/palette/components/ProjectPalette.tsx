import { useCallback, useMemo } from "react";

import { m } from "@/i18n";

import {
  type ContentDocument,
  objectDocument,
  previewDocument,
} from "../../documents/utils/contentDocument";
import { useProjectContext } from "../../projects/state/ProjectContext";
import {
  useOpenDocumentAs,
  useRecentDocumentIds,
  useRevealInTree,
  useRevealRow,
  useSelectedLayerName,
} from "../../state";
import { useGameRows } from "../hooks/useGameRows";
import { useObjectRows } from "../hooks/useObjectRows";
import { usePaletteSearch } from "../hooks/usePaletteSearch";
import { useProjectCandidates } from "../hooks/useProjectCandidates";
import { useRowRows } from "../hooks/useRowRows";
import { barPlaceholder } from "../utils/barMode";
import { parseQuery, PROJECT_SOURCES } from "../utils/sources";
import type { OpenIntent, PaletteRowData, PaletteTarget } from "../utils/types";
import { useOpenProject } from "./projectRows";
import { type PaletteBranchProps, ResultsPalette } from "./ResultsPalette";

/** The bar's palette under a project: its tabs, its files, its strings, the game and its objects. */
export function ProjectPalette(props: PaletteBranchProps) {
  const { query, scope, onClose } = props;

  const parsed = useMemo(() => parseQuery(query, scope), [query, scope]);
  const candidates = useProjectCandidates();
  const selectedLayer = useSelectedLayerName();
  const recent = useRecentDocumentIds();

  /* The sources that cross IPC, so each is asked for on its own and folded in
     wherever its group sits. */
  const wantsGame = !parsed.help && (parsed.scope === null || parsed.scope === "game");
  const game = useGameRows(parsed.term, wantsGame);
  const wantsObjects = !parsed.help && (parsed.scope === null || parsed.scope === "objects");
  const objects = useObjectRows(parsed.term, query, wantsObjects);
  /* Scoped alone: every keystroke of an unscoped query would search the open tab too. */
  const rows = useRowRows(parsed.term, !parsed.help && parsed.scope === "rows");
  const ranked = useMemo(() => ({ game, objects, rows }), [game, objects, rows]);

  const project = useProjectContext();
  const labels = useMemo(
    () => ({ projectObjects: m.workshop_objects_project_label({ project: project.displayName }) }),
    [project.displayName],
  );

  const groups = usePaletteSearch({
    parsed,
    sources: PROJECT_SOURCES,
    candidates,
    ranked,
    labels,
    selectedLayer,
    recent,
  });

  const run = useRunTarget(onClose);

  return (
    <ResultsPalette
      {...props}
      parsed={parsed}
      groups={groups}
      placeholder={barPlaceholder("palette", true, scope)}
      run={run}
    />
  );
}

/** A target that opens a tab, which is every one but a command, a prefix and a row. */
type OpeningTarget = Extract<
  PaletteTarget,
  { kind: "document" | "layerFile" | "gameChunk" | "object" | "layerObject" }
>;

/**
 * The tab a row opens, built at the moment it is chosen.
 *
 * A file of a layer and a chunk of the game each name their asset rather than
 * carrying a built document, because a project of a few thousand files and an
 * install of eight hundred thousand build one row apiece. An object opens as a
 * tab of its own over the file that declares it (ADR-0028).
 */
function documentFor(target: OpeningTarget, projectPath: string): ContentDocument {
  if (target.kind === "document") return target.document;
  if (target.kind === "gameChunk") {
    return previewDocument(
      { kind: "gameChunk", wad: target.wad, pathHash: target.pathHash },
      target.path.length > 0 ? target.path : undefined,
    );
  }
  if (target.kind === "object") {
    return objectDocument(
      { kind: "gameChunk", wad: target.wad, pathHash: target.pathHash },
      target.objectHash,
      target.objectPath,
      target.path.length > 0 ? target.path : target.pathHash,
      target.objectClass,
    );
  }
  const asset = {
    kind: "layer",
    project: projectPath,
    layer: target.layerName,
    path: target.path,
  } as const;
  if (target.kind === "layerObject") {
    return objectDocument(
      asset,
      target.objectHash,
      target.objectPath,
      target.path,
      target.objectClass,
    );
  }
  return previewDocument(asset);
}

/** Turns the chosen row into the open, or the mutation, that it stands for. */
function useRunTarget(close: () => void) {
  const project = useProjectContext();
  const open = useOpenDocumentAs();
  const openProject = useOpenProject();
  const reveal = useRevealInTree();
  const revealRow = useRevealRow();

  return useCallback(
    ({ target }: PaletteRowData, intent: OpenIntent) => {
      /* Both keep the palette open, and the results palette runs them itself. */
      if (target.kind === "prefix" || target.kind === "query") return;

      close();

      if (target.kind === "command") {
        target.command.run();
        return;
      }

      /* The one row that leaves this editor rather than opening into it, which
         is what the crumb's own source is for. */
      if (target.kind === "project") {
        openProject(target.id);
        return;
      }

      if (target.kind === "row") {
        revealRow(target.documentId, target.key);
        return;
      }

      open(documentFor(target, project.path), intent);

      /* Only a file of the project has a tree standing open beside the editor
         to scroll. The game browser opens on its own. */
      if (target.kind === "layerFile" || target.kind === "layerObject") {
        reveal(target.layerName, target.path);
      }
    },
    [close, open, openProject, project.path, reveal, revealRow],
  );
}

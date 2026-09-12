import {
  EyeSlashIcon,
  FileArchiveIcon,
  FilesIcon,
  MagnifyingGlassIcon,
  TranslateIcon,
  TreeStructureIcon,
  WarningDiamondIcon,
} from "@phosphor-icons/react";
import { useMemo } from "react";

import { ContextMenu, LeagueIcon, PlayerTitleIcon } from "@/components";
import { m } from "@/i18n";
import type { WorkshopProject } from "@/lib/tauri";
import type { EditorRegistry } from "@/modules/editor";

import { ObjectDocument } from "../bin/ObjectDocument";
import { LayerGlyph } from "../components/LayerGlyph";
import { ObjectGlyph } from "../components/ObjectGlyph";
import { useProjectContext } from "../components/ProjectContext";
import {
  archiveTarget,
  chunkTarget,
  ExtractMenuItems,
  fileKindFromPath,
  GameDocument,
  GameWadDocument,
  GameWadsDocument,
  useExtractActions,
  wadBasename,
} from "../gameBrowser";
import { IgnoreRulesDocument } from "../ignore-rules";
import { ObjectsDocument, useRevealInObjects } from "../objectsBrowser";
import { assetPath, PreviewDocument } from "../preview";
import { ProblemsDocument } from "../problems";
import { objectReferences, ReferencesDocument, useFindReferences } from "../references";
import { describeFileKind } from "../utils/fileKindIcon";
import {
  type ContentDocument,
  type ContentDocumentOf,
  declaringFileContext,
  layerTitle,
  objectTitle,
} from "./contentDocument";
import { DetailsDocument } from "./DetailsDocument";
import { FilesDocument } from "./FilesDocument";
import { StringsDocument } from "./StringsDocument";

/**
 * The editors the content surface can open, tab labels included.
 *
 * Takes the project rather than reading it, because a label is answered for
 * whichever project holds the document. The navigation history spans the
 * workshop, so a stop is titled by the project it sits in and not by the one on
 * screen - `layerTitle` against the wrong project names the wrong layer.
 */
export function contentEditors(project: WorkshopProject): EditorRegistry<ContentDocument> {
  return {
    details: {
      icon: () => <PlayerTitleIcon className="h-4 w-4 shrink-0 text-doc-details-text" />,
      label: () => ({ title: "Mod details", path: project.path }),
      component: DetailsDocument,
    },
    files: {
      icon: (document) => <LayerGlyph layerName={document.layerName} className="h-4 w-4" />,
      label: (document) => ({
        title: layerTitle(project, document.layerName),
        path: `${project.path}/content/${document.layerName}`,
      }),
      component: FilesDocument,
    },
    strings: {
      icon: () => <TranslateIcon className="h-4 w-4 shrink-0 text-doc-strings-text" />,
      label: (document) => ({
        title: document.locale,
        context: layerTitle(project, document.layerName),
      }),
      component: StringsDocument,
    },
    "ignore-rules": {
      icon: () => <EyeSlashIcon className="h-4 w-4 shrink-0 text-doc-ignore-text" />,
      label: (document) => ({
        title: m.workshop_ignore_title(),
        context: document.at,
        path: document.at ?? project.path,
      }),
      component: IgnoreRulesDocument,
    },
    problems: {
      icon: () => <WarningDiamondIcon className="h-4 w-4 shrink-0 text-doc-problems-text" />,
      label: () => ({ title: "Problems", path: project.path }),
      component: ProblemsDocument,
    },
    game: {
      icon: () => <LeagueIcon className="h-4 w-4 shrink-0 text-doc-game-text" />,
      label: () => ({ title: "Game index" }),
      component: GameDocument,
    },
    "game-wads": {
      icon: () => <FilesIcon className="h-4 w-4 shrink-0 text-doc-game-text" />,
      label: () => ({ title: "Game WADs" }),
      component: GameWadsDocument,
    },
    "game-wad": {
      icon: () => <FileArchiveIcon className="h-4 w-4 shrink-0 text-doc-game-text" />,
      label: (document) => ({
        title: wadBasename(document.wadName),
        path: document.wadName,
      }),
      component: GameWadDocument,
      tabMenu: (document) => <GameWadTabMenu wadName={document.wadName} />,
    },
    objects: {
      icon: () => <TreeStructureIcon className="h-4 w-4 shrink-0 text-doc-game-text" />,
      label: () => ({ title: m.workshop_objects_title() }),
      component: ObjectsDocument,
    },
    references: {
      icon: () => <MagnifyingGlassIcon className="h-4 w-4 shrink-0 text-doc-game-text" />,
      label: () => ({ title: m.workshop_references_title(), path: project.path }),
      component: ReferencesDocument,
    },
    preview: {
      icon: (document) => <PreviewGlyph title={document.title} />,
      label: (document) => ({
        title: document.title,
        context: document.context,
        /* A tab restored from a file written before the field existed derives
             one, which costs the resolved chunk path and nothing else. */
        path: document.path ?? assetPath(document.asset),
      }),
      component: PreviewDocument,
      tabMenu: (document) => {
        /* A layer file and a loose file are on disk already, so only a game
             chunk has anywhere to go. */
        if (document.asset.kind !== "gameChunk") return null;
        return <PreviewTabMenu document={document} />;
      },
    },
    object: {
      icon: (document) => (
        <ObjectGlyph
          objectClass={document.objectClass}
          className="h-4 w-4 shrink-0 text-surface-400"
        />
      ),
      label: (document) => ({
        title: objectTitle(document.objectPath),
        context: declaringFileContext(document.asset, document.file),
        path: document.objectPath,
      }),
      component: ObjectDocument,
      tabMenu: (document) => (
        <ObjectTabMenu objectHash={document.objectHash} objectPath={document.objectPath} />
      ),
    },
  };
}

interface ObjectTabMenuProps {
  /** `0x` and eight hex digits. */
  objectHash: string;
  objectPath: string;
}

/** Find references and Reveal in Objects, per "The object tab" in docs/ux/BIN_EDITOR.md. */
function ObjectTabMenu({ objectHash, objectPath }: ObjectTabMenuProps) {
  const reveal = useRevealInObjects();
  const find = useFindReferences();

  return (
    <>
      <ContextMenu.Item
        icon={<MagnifyingGlassIcon className="h-4 w-4" />}
        onClick={() => find(objectReferences(objectHash, objectPath))}
      >
        {m.workshop_references_find_object_action()}
      </ContextMenu.Item>
      <ContextMenu.Item
        icon={<TreeStructureIcon className="h-4 w-4" />}
        onClick={() => reveal(objectPath)}
      >
        {m.workshop_objects_reveal_action()}
      </ContextMenu.Item>
    </>
  );
}

/** The registry of the project the caller is mounted inside. */
export function useContentEditors(): EditorRegistry<ContentDocument> {
  const project = useProjectContext();
  return useMemo(() => contentEditors(project), [project]);
}

function GameWadTabMenu({ wadName }: { wadName: string }) {
  const { run } = useExtractActions();

  return (
    <ExtractMenuItems onRun={(how) => run(how, [archiveTarget(wadName)], wadBasename(wadName))} />
  );
}

/* The same three the tree offers, on the tab of the chunk already open. */
function PreviewTabMenu({ document }: { document: ContentDocumentOf<"preview"> }) {
  const { run } = useExtractActions();
  const target = chunkTarget(document.asset, document.path);
  if (!target) return null;

  return <ExtractMenuItems onRun={(how) => run(how, [target], document.title)} />;
}

/** The tree row's own glyph, so a preview tab reads like the row that opened it. */
function PreviewGlyph({ title }: { title: string }) {
  const descriptor = describeFileKind(fileKindFromPath(title));
  const Icon = descriptor.icon;

  return (
    <span className="shrink-0" style={{ color: `var(${descriptor.tintToken})` }}>
      <Icon className="h-4 w-4" strokeWidth={1.75} />
    </span>
  );
}

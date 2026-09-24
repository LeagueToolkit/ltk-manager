import {
  BracketsCurlyIcon,
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
import type { EditorDocumentDefinition, EditorRegistry } from "@/modules/editor";

import { ObjectDocument } from "../../bin/documents/components/ObjectDocument";
import { FilesDocument } from "../../content/components/FilesDocument";
import { useRevealInLayerFiles } from "../../content/hooks/useRevealInLayerFiles";
import { DeclarationsDocument } from "../../declarations/components/DeclarationsDocument";
import {
  archiveTarget,
  chunkPath,
  chunkTarget,
  ExtractMenuItems,
  fileKindFromPath,
  GameDocument,
  GameWadDocument,
  GameWadsDocument,
  useExtractActions,
  useRevealInGameFiles,
  wadBasename,
} from "../../gameBrowser";
import { IgnoreRulesDocument } from "../../ignore-rules";
import { LayerGlyph } from "../../layers/components/LayerGlyph";
import { ObjectsDocument, useRevealInObjects } from "../../objectsBrowser";
import { assetPath, PreviewDocument } from "../../preview";
import { ProblemsDocument } from "../../problems";
import { DetailsDocument } from "../../projects/details/components/DetailsDocument";
import { useProjectContext } from "../../projects/state/ProjectContext";
import { objectReferences, ReferencesDocument, useFindReferences } from "../../references";
import { ObjectGlyph } from "../../shared/components/ObjectGlyph";
import { describeFileKind } from "../../shared/utils/fileKindIcon";
import { StringsDocument } from "../../string-overrides/components/StringsDocument";
import { ProjectTextDocument, textFileKind } from "../../text-files";
import {
  type ContentDocument,
  type ContentDocumentOf,
  declaringFileContext,
  documentLayerName,
  layerTitle,
  objectTitle,
} from "../utils/contentDocument";

/**
 * The editors the content surface can open, tab labels included.
 *
 * Takes the project rather than reading it, because a label is answered for
 * whichever project holds the document. The navigation history spans the
 * workshop, so a stop is titled by the project it sits in and not by the one on
 * screen - `layerTitle` against the wrong project names the wrong layer.
 */
/* DS-KIND-HUE: a root text file is a kind of its own, not a status. */
function glyphClass(file: ContentDocumentOf<"text">["file"]): string {
  const hue = file === "readme" ? "text-doc-readme-text" : "text-doc-license-text";
  return `h-4 w-4 shrink-0 ${hue}`;
}

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
        layer: layerTitle(project, document.layerName),
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
    declarations: {
      icon: () => <BracketsCurlyIcon className="h-4 w-4 shrink-0 text-doc-declarations-text" />,
      label: (document) => ({
        title: m.workshop_declarations_title(),
        layer: layerTitle(project, document.layerName),
        path: `${project.path}/content/${document.layerName}`,
      }),
      component: DeclarationsDocument,
    },
    text: {
      icon: (document) => textFileKind(document.file).icon(glyphClass(document.file)),
      label: (document) => ({
        title: textFileKind(document.file).title(),
        path: project.path,
      }),
      component: ProjectTextDocument,
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
      label: (document) => {
        const layerName = documentLayerName(document);
        const layer = layerName === null ? undefined : layerTitle(project, layerName);

        return {
          title: document.title,
          /* An archive stays a context, which stands whatever else is open. */
          context: layer === undefined ? document.context : undefined,
          layer,
          /* A tab restored from a file written before the field existed derives
             one, which costs the resolved chunk path and nothing else. */
          path: document.path ?? assetPath(document.asset),
        };
      },
      component: PreviewDocument,
      tabMenu: (document) => {
        /* A file picked off disk belongs to no browser of this editor, and the
           strip's own items are the whole menu it gets. */
        if (document.asset.kind === "file") return null;
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

/**
 * The definition holding one document's kind, for a caller with the union in hand.
 *
 * The registry narrows to one kind per key, which a lookup by a union's own
 * kind cannot express. The key comes off the document, and the two agree.
 */
export function documentDefinition(
  editors: EditorRegistry<ContentDocument>,
  document: ContentDocument,
): EditorDocumentDefinition<ContentDocument> | null {
  const definition = editors[document.kind] as unknown as
    | EditorDocumentDefinition<ContentDocument>
    | undefined;
  return definition ?? null;
}

function GameWadTabMenu({ wadName }: { wadName: string }) {
  const { run } = useExtractActions();

  return (
    <ExtractMenuItems onRun={(how) => run(how, [archiveTarget(wadName)], wadBasename(wadName))} />
  );
}

/* Reveal in Files, and the same three ways out the tree offers on the chunk
   already open. */
function PreviewTabMenu({ document }: { document: ContentDocumentOf<"preview"> }) {
  const { run } = useExtractActions();
  const target = chunkTarget(document.asset, document.path);

  return (
    <>
      <RevealInFilesItem document={document} />
      {target && <ExtractMenuItems onRun={(how) => run(how, [target], document.title)} />}
    </>
  );
}

/** The browser the file came from, focused on its row, per "Reveal in Files". */
function RevealInFilesItem({ document }: { document: ContentDocumentOf<"preview"> }) {
  const revealInLayer = useRevealInLayerFiles();
  const revealInGame = useRevealInGameFiles();
  const asset = document.asset;

  function reveal() {
    if (asset.kind === "layer") {
      revealInLayer(asset.layer, asset.path);
      return;
    }
    if (asset.kind !== "gameChunk") return;
    revealInGame(asset.pathHash, chunkPath(asset, document.path));
  }

  return (
    <ContextMenu.Item icon={<FilesIcon className="h-4 w-4" />} onClick={reveal}>
      {m.workshop_files_reveal_action()}
    </ContextMenu.Item>
  );
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

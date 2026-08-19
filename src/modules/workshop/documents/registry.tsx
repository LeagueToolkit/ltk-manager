import { FileArchiveIcon, FilesIcon, TranslateIcon } from "@phosphor-icons/react";
import { useMemo } from "react";

import { LeagueIcon, PlayerTitleIcon } from "@/components";
import type { EditorRegistry } from "@/modules/editor";

import { LayerGlyph } from "../components/LayerGlyph";
import { useProjectContext } from "../components/ProjectContext";
import { GameDocument, GameWadDocument, GameWadsDocument, wadBasename } from "../gameBrowser";
import { type ContentDocument, layerTitle } from "./contentDocument";
import { DetailsDocument } from "./DetailsDocument";
import { FilesDocument } from "./FilesDocument";
import { StringsDocument } from "./StringsDocument";

/** The editors the content surface can open, tab labels included. */
export function useContentEditors(): EditorRegistry<ContentDocument> {
  const project = useProjectContext();

  return useMemo(
    () => ({
      details: {
        icon: () => <PlayerTitleIcon className="h-4 w-4 shrink-0 text-doc-details-text" />,
        label: () => ({ title: "Mod details" }),
        component: DetailsDocument,
      },
      files: {
        icon: (document) => <LayerGlyph layerName={document.layerName} className="h-4 w-4" />,
        label: (document) => ({ title: layerTitle(project, document.layerName) }),
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
        label: (document) => ({ title: wadBasename(document.wadName) }),
        component: GameWadDocument,
      },
    }),
    [project],
  );
}

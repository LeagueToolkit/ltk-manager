import {
  BookOpenTextIcon,
  CubeIcon,
  EyeSlashIcon,
  GitBranchIcon,
  MagnifyingGlassIcon,
  StackIcon,
  WarningDiamondIcon,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { LeagueIcon, PlayerTitleIcon } from "@/components";
import { m } from "@/i18n";
import type { SidebarViewId } from "@/stores";

import {
  type ContentDocument,
  detailsDocument,
  DETAILS_DOCUMENT_ID,
  ignoreRulesDocument,
  IGNORE_RULES_DOCUMENT_ID,
  projectTextDocument,
  README_DOCUMENT_ID,
} from "../documents";

/** One view the rail offers, and the panel beside it fills with. */
export interface RailView {
  id: SidebarViewId;
  /** The panel's title, and the rail button's tooltip and accessible name. */
  title: string;
  icon: ReactNode;
}

/** One document the rail's lower group opens, which belongs to the whole project. */
export interface RailDocument {
  documentId: string;
  label: string;
  icon: ReactNode;
  document: () => ContentDocument;
}

/**
 * The views the rail stacks, top to bottom.
 *
 * A function rather than a constant, because a title is a message call and the
 * locale it reads belongs to the render.
 */
export function railViews(): readonly RailView[] {
  return [
    {
      id: "explorer",
      title: m.workshop_sidebar_explorer_title(),
      icon: <StackIcon className="h-5 w-5" />,
    },
    {
      id: "search",
      title: m.workshop_sidebar_search_title(),
      icon: <MagnifyingGlassIcon weight="bold" className="h-5 w-5" />,
    },
    {
      id: "problems",
      title: m.workshop_sidebar_problems_title(),
      icon: <WarningDiamondIcon className="h-5 w-5" />,
    },
    {
      id: "objects",
      title: m.workshop_objects_title(),
      icon: <CubeIcon className="h-5 w-5" />,
    },
    {
      id: "game",
      title: m.workshop_sidebar_game_title(),
      icon: <LeagueIcon className="h-5 w-5" />,
    },
    {
      id: "source",
      title: m.workshop_sidebar_source_title(),
      icon: <GitBranchIcon className="h-5 w-5" />,
    },
  ];
}

/** The project's own documents, which the rail keeps under the views. */
export function railDocuments(): readonly RailDocument[] {
  return [
    {
      documentId: DETAILS_DOCUMENT_ID,
      label: m.workshop_sidebar_details_action(),
      icon: <PlayerTitleIcon className="h-6 w-6" />,
      document: detailsDocument,
    },
    {
      documentId: README_DOCUMENT_ID,
      label: m.workshop_readme_title(),
      icon: <BookOpenTextIcon className="h-5 w-5" />,
      document: () => projectTextDocument("readme"),
    },
    {
      documentId: IGNORE_RULES_DOCUMENT_ID,
      label: m.workshop_ignore_title(),
      icon: <EyeSlashIcon weight="bold" className="h-5 w-5" />,
      document: ignoreRulesDocument,
    },
  ];
}

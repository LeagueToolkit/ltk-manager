import { BookOpenTextIcon, ScrollIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { m } from "@/i18n";
import type { ProjectTextFile } from "@/lib/tauri";

/** What one root text file is, everywhere the editor draws it. */
export interface TextFileKind {
  /** The tab's title, and the name the empty state calls the file. */
  title: () => string;
  /** What the file is called on disk when the project has none yet. */
  fileName: string;
  /** Whether the document offers a rendered half beside the buffer. */
  markdown: boolean;
  icon: (className: string) => ReactNode;
}

const KINDS: Record<ProjectTextFile, TextFileKind> = {
  readme: {
    title: () => m.workshop_readme_title(),
    fileName: "README.md",
    markdown: true,
    icon: (className) => <BookOpenTextIcon className={className} />,
  },
  /* No route opens it yet. The kind is what a license surface starts from. */
  license: {
    title: () => m.workshop_license_title(),
    fileName: "LICENSE",
    markdown: false,
    icon: (className) => <ScrollIcon className={className} />,
  },
};

/** How the editor draws `file`. */
export function textFileKind(file: ProjectTextFile): TextFileKind {
  return KINDS[file];
}

/** The sections Insert template offers, in the order it writes them. */
export const TEMPLATE_SECTIONS = ["About", "Installing", "Credits"] as const;

/**
 * `text` with the template sections it does not already have, appended.
 *
 * A heading is matched on its text rather than its level, so a creator who
 * wrote `### Credits` is not given a second one.
 */
export function withTemplateSections(text: string): string {
  const held = new Set(headings(text).map((heading) => heading.toLowerCase()));
  const missing = TEMPLATE_SECTIONS.filter((section) => !held.has(section.toLowerCase()));
  if (missing.length === 0) return text;

  const sections = missing.map((section) => `## ${section}\n`).join("\n");
  const body = text.replace(/\s*$/, "");
  return body.length === 0 ? sections : `${body}\n\n${sections}`;
}

/** Whether `text` is short of any template section. */
export function lacksTemplateSection(text: string): boolean {
  return withTemplateSections(text) !== text;
}

/** Every ATX heading's text, in the order they appear. */
function headings(text: string): string[] {
  return text
    .split("\n")
    .map((line) => /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line)?.[1])
    .filter((heading): heading is string => heading !== undefined);
}

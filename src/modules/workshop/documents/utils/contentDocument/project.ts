import type { ProjectTextFile, WorkshopProject } from "@/lib/tauri";
import type { EditorDocumentBase } from "@/modules/editor";

interface DetailsDoc extends EditorDocumentBase {
  kind: "details";
}

/** The project has one set of details, so its document needs nothing to key on. */
export const DETAILS_DOCUMENT_ID = "details";

export function detailsDocument(): DetailsDoc {
  return { id: DETAILS_DOCUMENT_ID, kind: "details" };
}

interface TextFileDoc extends EditorDocumentBase {
  kind: "text";
  /** Which of the project's root text files this is. */
  file: ProjectTextFile;
}

/** The project's readme, the one root text file a route opens today. */
export const README_DOCUMENT_ID = "text:readme";

/**
 * One of the project's root text files.
 *
 * A project holds one of each, so the file is what keys the document and a
 * second one costs a caller rather than a kind.
 */
export function projectTextDocument(file: ProjectTextFile): TextFileDoc {
  return { id: `text:${file}`, kind: "text", file };
}

interface ProblemsDoc extends EditorDocumentBase {
  kind: "problems";
}

/** A run covers the whole project, so its document needs nothing to key on. */
export const PROBLEMS_DOCUMENT_ID = "problems";

export function problemsDocument(): ProblemsDoc {
  return { id: PROBLEMS_DOCUMENT_ID, kind: "problems" };
}

interface IgnoreRulesDoc extends EditorDocumentBase {
  kind: "ignore-rules";
  /** The file's project-relative path, absent for the project's root rules. */
  at?: string;
}

/** The project's root `.modignore`, the one file every project has. */
export const IGNORE_RULES_DOCUMENT_ID = "ignore-rules";

/** The rules at project-relative `at`, or the project's root file for none. */
export function ignoreRulesDocument(at?: string): IgnoreRulesDoc {
  if (at === undefined) return { id: IGNORE_RULES_DOCUMENT_ID, kind: "ignore-rules" };
  return { id: `${IGNORE_RULES_DOCUMENT_ID}:${at}`, kind: "ignore-rules", at };
}

interface FilesDoc extends EditorDocumentBase {
  kind: "files";
  layerName: string;
}

export function filesDocument(layerName: string): FilesDoc {
  return { id: `files:${layerName}`, kind: "files", layerName };
}

interface StringsDoc extends EditorDocumentBase {
  kind: "strings";
  layerName: string;
  locale: string;
}

export function stringsDocument(layerName: string, locale: string): StringsDoc {
  return { id: `strings:${layerName}:${locale}`, kind: "strings", layerName, locale };
}

/** One layer's game data declarations manifest. */
interface DeclarationsDoc extends EditorDocumentBase {
  kind: "declarations";
  layerName: string;
}

/** A layer holds one manifest, so the layer is what keys its document. */
export function declarationsDocument(layerName: string): DeclarationsDoc {
  return { id: `declarations:${layerName}`, kind: "declarations", layerName };
}

/** What a layer is called on screen, falling back to the name on disk. */
export function layerTitle(project: WorkshopProject, layerName: string): string {
  const layer = project.layers.find((candidate) => candidate.name === layerName);
  return layer?.displayName ?? layerName;
}

/** A document over the project itself or one of its layers. */
export type ProjectDoc =
  | DetailsDoc
  | TextFileDoc
  | ProblemsDoc
  | IgnoreRulesDoc
  | FilesDoc
  | StringsDoc
  | DeclarationsDoc;

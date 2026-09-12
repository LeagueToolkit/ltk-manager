import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { AppError, ProjectTextFile } from "@/lib/tauri";
import { useTextDocumentEditor } from "@/modules/editor";

import { projectQueries, projectTextMutations } from "../api";
import { useProjectContext } from "../components/ProjectContext";
import { withTemplateSections } from "./textFileKind";

/** A save the file itself turned down, which only the creator can settle. */
export type TextRefusal = "changed";

/** Whether `error` is the file reporting that it moved under the buffer. */
function changedOf(error: AppError): TextRefusal | null {
  if (error.code !== "WORKSHOP") return null;
  if (error.error.kind !== "TEXT_FILE_CHANGED") return null;
  return "changed";
}

/**
 * One of the project's root text files as an editable buffer.
 *
 * The file is read once and written back on a debounce. A file that changed on
 * disk since it was read refuses the save rather than overwriting it, which is
 * `conflict`, and the creator answers with `reload` or `keepMine`. Bytes that
 * are not UTF-8 make the buffer read-only, because a save would rewrite what
 * the packer carries verbatim.
 */
export function useProjectTextEditor(file: ProjectTextFile) {
  const project = useProjectContext();
  const client = useQueryClient();

  const read = useQuery(projectQueries.projectText(project.path, file));
  const save = useMutation(projectTextMutations.save(client));

  const revision = read.data?.revision ?? null;
  const readable = read.data?.readable ?? true;

  const editor = useTextDocumentEditor<AppError, TextRefusal>({
    saved: read.data && readable ? read.data.text : undefined,
    file: `${project.path}:${file}`,
    save: (text) => save.mutateAsync({ projectPath: project.path, file, text, expected: revision }),
    refusalOf: changedOf,
  });

  return {
    /** Whether the project has a file at all. The empty state turns on this. */
    exists: (read.data?.text ?? null) !== null,
    /** Whether the bytes decoded. A file that did not cannot be edited. */
    readable,
    path: read.data?.path ?? null,
    text: editor.text,
    setText: editor.setText,
    isLoading: read.isLoading,
    saveState: editor.saveState,
    saveNow: editor.saveNow,
    /** The file moved under the buffer, and nothing is written until it is answered. */
    conflict: editor.refusal !== null,

    /** Take what is on disk, dropping the buffer. */
    reload: () => {
      editor.setText(null);
      void read.refetch();
    },

    /** Write the buffer over whatever is on disk now. */
    keepMine: () => {
      const mine = editor.text;
      save.mutate(
        { projectPath: project.path, file, text: mine, expected: null },
        { onSuccess: () => editor.setText(null) },
      );
    },

    /** Append the template sections the file lacks. */
    insertTemplate: () => editor.setText(withTemplateSections(editor.text)),

    /** Write the file a project does not have yet, from its display name. */
    start: () => editor.setText(`# ${project.displayName}\n`),
  };
}
